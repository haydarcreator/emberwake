/**
 * Online / LAN client. Talks to server.js over WebSocket, buffers snapshots
 * and renders ~100 ms in the past so movement stays smooth between updates.
 */
(function () {
  const DELAY = 100;

  function lerpList(a, b, f, ix, iy) {
    const prev = new Map(a.map((e) => [e[0], e]));
    return b.map((e) => {
      const p = prev.get(e[0]);
      if (!p) return e;
      const out = e.slice();
      out[ix] = p[ix] + (e[ix] - p[ix]) * f;
      out[iy] = p[iy] + (e[iy] - p[iy]) * f;
      return out;
    });
  }

  function lerpSnap(a, b, f) {
    const prevP = new Map(a.players.map((p) => [p.id, p]));
    return Object.assign({}, b, {
      players: b.players.map((p) => {
        const q = prevP.get(p.id);
        if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 200) return p;
        return Object.assign({}, p, { x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f });
      }),
      enemies: lerpList(a.enemies, b.enemies, f, 2, 3),
      bullets: lerpList(a.bullets, b.bullets, f, 1, 2),
    });
  }

  class Net {
    constructor() {
      this.ws = null;
      this.id = null;
      this.room = null;
      this.snaps = [];
      this.events = [];
      this.handlers = {};
      this.lastSend = 0;
    }

    on(type, fn) { this.handlers[type] = fn; }
    emit(type, data) { if (this.handlers[type]) this.handlers[type](data); }

    get connected() { return this.ws && this.ws.readyState === 1; }

    connect(name, url) {
      if (this.connected) { this.send({ t: 'hello', name }); return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        if (location.protocol === 'file:' && !url) return reject(new Error('file'));
        const target = url || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
        let ws;
        try { ws = new WebSocket(target); } catch (e) { return reject(e); }
        this.ws = ws;
        const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
        ws.onopen = () => { clearTimeout(timer); this.send({ t: 'hello', name }); resolve(); };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('unreachable')); };
        ws.onclose = () => {
          if (this.ws !== ws) return;
          this.ws = null; this.room = null; this.snaps = [];
          this.emit('close');
        };
        ws.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'welcome') this.id = m.id;
          else if (m.t === 'room') { this.room = m; this.emit('room', m); }
          else if (m.t === 'start') { this.snaps = []; this.events = []; this.emit('start', m); }
          else if (m.t === 'snap') {
            this.snaps.push({ at: performance.now(), s: m.s });
            if (this.snaps.length > 30) this.snaps.shift();
            if (m.e && m.e.length) this.events.push(...m.e);
          } else if (m.t === 'error') this.emit('error', m.msg);
        };
      });
    }

    send(obj) { if (this.connected) this.ws.send(JSON.stringify(obj)); }

    disconnect() {
      const ws = this.ws;
      this.ws = null; this.room = null;
      if (ws) ws.close();
    }

    takeEvents() {
      const e = this.events;
      this.events = [];
      return e;
    }

    latest() { return this.snaps.length ? this.snaps[this.snaps.length - 1].s : null; }

    view() {
      const b = this.snaps;
      if (!b.length) return null;
      const rt = performance.now() - DELAY;
      while (b.length > 2 && b[1].at <= rt) b.shift();
      if (b.length < 2 || rt <= b[0].at) return b[0].s;
      if (rt >= b[1].at) return b[1].s;
      return lerpSnap(b[0].s, b[1].s, (rt - b[0].at) / (b[1].at - b[0].at));
    }

    // Inputs go out at ~30 Hz. Presses (dash, upgrade pick) are kept until sent.
    sendInput(inp, now) {
      this.pendingDash = this.pendingDash || inp.dash;
      if (inp.pick >= 0) this.pendingPick = inp.pick;
      if (now - this.lastSend < 33) return;
      this.lastSend = now;
      this.send({
        t: 'input',
        mx: +inp.mx.toFixed(2), my: +inp.my.toFixed(2), ax: +inp.ax.toFixed(3), ay: +inp.ay.toFixed(3),
        fire: inp.fire, dash: !!this.pendingDash, pick: this.pendingPick != null ? this.pendingPick : -1,
      });
      this.pendingDash = false;
      this.pendingPick = null;
    }
  }

  window.EmberNet = Net;
})();
