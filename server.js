/**
 * Emberwake server: serves the website and game, and runs multiplayer rooms
 * over WebSocket (/ws). No dependencies, just Node.js 18+.
 *
 *   node server.js            → http://localhost:8080
 *   PORT=3000 node server.js
 *
 * Friends on the same Wi-Fi can join at http://<this-computer's-IP>:8080.
 * Deploy the same file to any Node host (Render, Fly.io, a VPS) for online play.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { EventEmitter } = require('node:events');
const Sim = require('./shared/sim.js');

const PORT = Number(process.env.PORT || process.argv[2]) || 8080;
const ROOT = __dirname;
const TICK = 1 / 30;
const MAX_PLAYERS = 4;

// ------------------------------------------------------------ static files
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
};
const PRIVATE = new Set(['server.js', 'package.json', 'package-lock.json', 'tools', 'desktop', 'node_modules', 'dist', 'android', 'www', 'capacitor.config.json']);

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
  if (pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ port: server.address().port, lan: lanAddresses(), rooms: rooms.size }));
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = path.normalize(path.join(ROOT, pathname));
  const top = path.relative(ROOT, file).split(path.sep)[0];
  if (!file.startsWith(ROOT) || PRIVATE.has(top) || top.startsWith('.')) { res.writeHead(404).end('Not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      // Code and pages are re-checked on every load so updates show up at once.
      'Cache-Control': top === 'assets' || top === 'downloads' ? 'public, max-age=3600' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ------------------------------------------------------- minimal WebSocket
class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.alive = true;
    this.closed = false;
    sock.setNoDelay(true);
    sock.on('data', (d) => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _data(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = b0 & 0x80, op = b0 & 0x0f, masked = b1 & 0x80;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; if (this.buf.readUInt32BE(2)) return this.close(1009); len = this.buf.readUInt32BE(6); off = 10; }
      if (len > 16 * 1024) return this.close(1009);
      if (!masked) return this.close(1002);
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);

      if (op === 0x8) return this.close();
      if (op === 0x9) { this._frame(0xa, data); continue; }
      if (op === 0xa) { this.alive = true; continue; }
      if (op === 0x1 || op === 0x2) this.frag = { op, parts: [] };
      if (!this.frag) continue;
      this.frag.parts.push(data);
      if (fin) {
        const msg = Buffer.concat(this.frag.parts);
        const isText = this.frag.op === 0x1;
        this.frag = null;
        if (isText) this.emit('message', msg.toString('utf8'));
      }
    }
  }
  _frame(op, data) {
    if (this.closed) return;
    const len = data.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(len, 6); }
    this.sock.write(Buffer.concat([head, data]));
  }
  get congested() { return this.sock.writableLength > 512 * 1024; }
  send(obj) { this._frame(0x1, Buffer.from(JSON.stringify(obj))); }
  ping() { this._frame(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (this.closed) return;
    const b = Buffer.alloc(2); b.writeUInt16BE(code);
    this._frame(0x8, b);
    this.sock.end();
    this._closed();
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.sock.destroy();
    this.emit('close');
  }
}

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    sock.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  onClient(new Socket(sock));
});

// -------------------------------------------------------------------- rooms
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
let nextClient = 1;

function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}

const cleanName = (n) => String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';

function roomInfo(room) {
  return {
    t: 'room', code: room.code, mode: room.mode, host: room.host, status: room.status,
    players: room.members.map((m) => ({ id: m.id, name: m.name, ready: m.ready })),
  };
}
const broadcast = (room, msg) => room.members.forEach((m) => m.ws.send(msg));

function onClient(ws) {
  const me = { id: 'c' + nextClient++, name: 'Player', ws, room: null, ready: false, input: blankInput() };
  ws.send({ t: 'welcome', id: me.id });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    handle(me, msg);
  });
  ws.on('close', () => leave(me));
}

function blankInput() { return { mx: 0, my: 0, ax: 0, ay: 0, fire: false, dash: false, pick: -1 }; }
const num = (v) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

function handle(me, msg) {
  const room = me.room;
  switch (msg.t) {
    case 'hello':
      me.name = cleanName(msg.name);
      break;
    case 'create': {
      if (room) leave(me);
      const r = { code: newCode(), mode: msg.mode === 'versus' ? 'versus' : 'coop', host: me.id, status: 'lobby', members: [], game: null, loop: null };
      rooms.set(r.code, r);
      join(me, r);
      break;
    }
    case 'join': {
      const r = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!r) return me.ws.send({ t: 'error', msg: 'No room with that code.' });
      if (r.members.length >= MAX_PLAYERS) return me.ws.send({ t: 'error', msg: 'That room is full (4 players).' });
      if (r.status !== 'lobby') return me.ws.send({ t: 'error', msg: 'That game has already started. Wait for it to end.' });
      if (room) leave(me);
      join(me, r);
      break;
    }
    case 'ready':
      if (!room || room.status !== 'lobby') return;
      me.ready = !!msg.v;
      broadcast(room, roomInfo(room));
      break;
    case 'mode':
      if (!room || room.host !== me.id || room.status !== 'lobby') return;
      room.mode = msg.mode === 'versus' ? 'versus' : 'coop';
      broadcast(room, roomInfo(room));
      break;
    case 'start': {
      if (!room || room.host !== me.id || room.status !== 'lobby') return;
      if (room.members.some((m) => !m.ready && m.id !== room.host)) return me.ws.send({ t: 'error', msg: 'Everyone needs to be ready.' });
      if (room.mode === 'versus' && room.members.length < 2) return me.ws.send({ t: 'error', msg: 'Versus needs at least 2 players.' });
      startGame(room);
      break;
    }
    case 'input': {
      if (!room || room.status !== 'playing') return;
      const i = me.input;
      i.mx = num(msg.mx); i.my = num(msg.my); i.ax = num(msg.ax); i.ay = num(msg.ay);
      i.fire = !!msg.fire;
      if (msg.dash) i.dash = true; // latched until the next tick consumes it
      if (Number.isInteger(msg.pick) && msg.pick >= 0 && msg.pick < 3) i.pick = msg.pick;
      break;
    }
    case 'leave':
      leave(me);
      break;
  }
}

function join(me, room) {
  me.room = room;
  me.ready = false;
  me.input = blankInput();
  room.members.push(me);
  broadcast(room, roomInfo(room));
}

function leave(me) {
  const room = me.room;
  if (!room) return;
  me.room = null;
  room.members = room.members.filter((m) => m !== me);
  if (room.game) Sim.removePlayer(room.game, me.id);
  if (!room.members.length) {
    clearInterval(room.loop);
    rooms.delete(room.code);
    return;
  }
  if (room.host === me.id) room.host = room.members[0].id;
  broadcast(room, roomInfo(room));
}

function startGame(room) {
  room.status = 'playing';
  room.game = Sim.create({ mode: room.mode, seed: crypto.randomInt(1, 2 ** 31), players: room.members.map((m) => ({ id: m.id, name: m.name })) });
  room.members.forEach((m) => { m.input = blankInput(); });
  broadcast(room, roomInfo(room));
  broadcast(room, { t: 'start', mode: room.mode });

  let overFor = 0;
  room.loop = setInterval(() => {
    const g = room.game;
    const inputs = {};
    for (const m of room.members) inputs[m.id] = m.input;
    Sim.step(g, inputs, TICK);
    for (const m of room.members) { m.input.dash = false; m.input.pick = -1; }

    const msg = { t: 'snap', s: Sim.snapshot(g), e: Sim.drainEvents(g) };
    for (const m of room.members) if (!m.ws.congested) m.ws.send(msg);

    if (g.phase === 'over' && (overFor += TICK) > 1) {
      clearInterval(room.loop);
      room.loop = null;
      room.game = null;
      room.status = 'lobby';
      room.members.forEach((m) => { m.ready = false; });
      broadcast(room, roomInfo(room));
    }
  }, TICK * 1000);
}

// Drop connections that stop answering pings.
setInterval(() => {
  for (const room of rooms.values()) {
    for (const m of room.members) {
      if (!m.ws.alive) { m.ws.close(); continue; }
      m.ws.alive = false;
      m.ws.ping();
    }
  }
}, 20000);

// Start listening. Returns the port actually used (falls back to a free port
// if the requested one is taken, which matters for the desktop app).
function start(port = PORT) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && port !== 0) { server.removeListener('error', onError); resolve(start(0)); }
      else reject(err);
    };
    server.once('error', onError);
    server.listen(port, () => { server.removeListener('error', onError); resolve(server.address().port); });
  });
}

module.exports = { start, lanAddresses };

if (require.main === module) {
  start().then((port) => {
    console.log(`\n  Emberwake is running.\n\n  On this computer:   http://localhost:${port}`);
    for (const ip of lanAddresses()) console.log(`  On your network:    http://${ip}:${port}`);
    console.log('\n  Press Ctrl+C to stop.\n');
  });
}
