// Generates the Emberwake icons (favicon.ico, PNG app icons) from the flame mark.
// Usage (from the emberwake folder): node tools/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [20, 13, 11];
const OUTER = [255, 122, 61];
const INNER = [255, 209, 102];

// Teardrop flame: round base, tapered tip that leans slightly left.
function inFlame(x, y, tipY, cy, r) {
  if (Math.hypot(x - 32, y - cy) <= r) return true;
  if (y < tipY || y > cy) return false;
  const k = (y - tipY) / (cy - tipY);
  const lean = -4 * (1 - k) * (1 - k);
  return Math.abs(x - 32 - lean) <= r * Math.pow(k, 1.25);
}

function sample(x, y, full) {
  if (!full) {
    const rr = 14;
    const qx = Math.max(Math.abs(x - 32) - (32 - rr), 0), qy = Math.max(Math.abs(y - 32) - (32 - rr), 0);
    if (Math.hypot(qx, qy) > rr) return null;
  }
  // full = maskable: shrink the mark into the safe zone
  const s = full ? 0.78 : 1, X = 32 + (x - 32) / s, Y = 33 + (y - 33) / s;
  if (inFlame(X, Y, 23, 45, 8)) return INNER;
  if (inFlame(X, Y, 7, 40, 15)) return OUTER;
  return BG;
}

function render(size, full) {
  const ss = 4, px = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
      const c = sample(((i + (si + 0.5) / ss) / size) * 64, ((j + (sj + 0.5) / ss) / size) * 64, full);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (j * size + i) * 4;
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
    px[o + 3] = Math.round((a / (ss * ss)) * 255);
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, full = false) {
  const px = render(size, full);
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) Buffer.from(px.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const imgs = sizes.map((s) => png(s));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => {
    const e = Buffer.alloc(16); e[0] = s; e[1] = s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(offset, 12); offset += imgs[i].length; return e;
  });
  return Buffer.concat([head, ...dir, ...imgs]);
}

writeFileSync('favicon.ico', ico([16, 32, 48]));
writeFileSync('assets/icons/apple-touch-icon.png', png(180, true));
writeFileSync('assets/icons/icon-192.png', png(192));
writeFileSync('assets/icons/icon-512.png', png(512));
writeFileSync('assets/icons/maskable-512.png', png(512, true));
console.log('icons written');

// ------------------------------------------------- Android app icons + splash
import { existsSync, readdirSync, readFileSync } from 'node:fs';

// Draws the flame centered in a w×h image. `mark` is the flame's size in px,
// `bg` fills the whole image (null = transparent), `rounded` clips to the app-icon square.
function renderScene(w, h, mark, bg, rounded) {
  const ss = 3, px = new Uint8Array(w * h * 4);
  const s = mark / 64;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sj = 0; sj < ss; sj++) for (let si = 0; si < ss; si++) {
      const fx = i + (si + 0.5) / ss, fy = j + (sj + 0.5) / ss;
      const X = 32 + (fx - w / 2) / s, Y = 32 + (fy - h / 2) / s;
      let c = null;
      if (rounded) c = sample(X, Y, false);
      else if (inFlame(X, Y, 23, 45, 8)) c = INNER;
      else if (inFlame(X, Y, 7, 40, 15)) c = OUTER;
      else if (bg) c = bg;
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const o = (j * w + i) * 4;
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; }
    px[o + 3] = Math.round((a / (ss * ss)) * 255);
  }
  return encodePng(w, h, px);
}

function encodePng(w, h, px) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const RES = 'android/app/src/main/res';
if (existsSync(RES)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const icon = Math.round(48 * k), fg = Math.round(108 * k);
    writeFileSync(`${RES}/mipmap-${d}/ic_launcher.png`, renderScene(icon, icon, icon, null, true));
    writeFileSync(`${RES}/mipmap-${d}/ic_launcher_round.png`, renderScene(icon, icon, icon, null, true));
    writeFileSync(`${RES}/mipmap-${d}/ic_launcher_foreground.png`, renderScene(fg, fg, fg * 0.62, null, false));
  }
  for (const dir of readdirSync(RES).filter((n) => n.startsWith('drawable'))) {
    const f = `${RES}/${dir}/splash.png`;
    if (!existsSync(f)) continue;
    const buf = readFileSync(f);
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    writeFileSync(f, renderScene(w, h, Math.min(w, h) * 0.32, [11, 8, 7], false));
  }
  console.log('android icons and splash screens written');
}
