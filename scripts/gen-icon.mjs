// Generates the Dockly app icon (512x512 PNG) with zero dependencies.
// Draws a rounded-square indigo-violet gradient tile with a white dock glyph.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const S = 512;
const px = Buffer.alloc(S * S * 4);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (d) => clamp(0.5 - d, 0, 1);

// SDF helpers
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}

const RADIUS = 120;
const C = S / 2;
const HW = S / 2 - 4;
const HH = S / 2 - 4;

// dock geometry (macOS-style bar with dots)
const dockBar = { cx: C, cy: 392, hw: 176, hh: 52, r: 26 };
const dots = [
  { cx: C - 84, cy: 392, r: 17 },
  { cx: C - 28, cy: 392, r: 17 },
  { cx: C + 28, cy: 392, r: 17 },
  { cx: C + 84, cy: 392, r: 17 },
];

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;

    // Rounded-square tile with AA
    const tileA = smooth(sdRoundRect(x + 0.5, y + 0.5, C, C, HW, HH, RADIUS));
    if (tileA <= 0.003) continue;

    // vertical gradient indigo -> violet, with top-left light sheen
    const t = y / S;
    let r = 99 + 20 * t;
    let g = 102 + 16 * t;
    let b = 241 - 34 * t;
    // subtle sheen
    const sheen = clamp(1 - Math.hypot(x - C * 0.55, y - C * 0.45) / (S * 0.9), 0, 1) * 22;
    r = clamp(r + sheen, 0, 255);
    g = clamp(g + sheen, 0, 255);
    b = clamp(b + sheen, 0, 255);

    // inner subtle border (dark at bottom edge)
    const edge = smooth(sdRoundRect(x + 0.5, y + 0.5, C, C, HW - 2, HH - 2, RADIUS - 2));
    const rim = (1 - edge) * tileA * 0.35;

    // dock glyph: white bar
    let a = tileA;
    let cr = r, cg = g, cb = b;
    const barA = smooth(sdRoundRect(x + 0.5, y + 0.5, dockBar.cx, dockBar.cy, dockBar.hw, dockBar.hh, dockBar.r)) * tileA;
    if (barA > 0.003) {
      cr = 255; cg = 255; cb = 255;
      a = Math.max(a, barA);
    }
    for (const d of dots) {
      const dotA = smooth(sdCircle(x + 0.5, y + 0.5, d.cx, d.cy, d.r)) * tileA;
      if (dotA > 0.003) {
        cr = 255; cg = 255; cb = 255;
        a = Math.max(a, dotA);
      }
    }

    px[i] = Math.round(cr);
    px[i + 1] = Math.round(cg);
    px[i + 2] = Math.round(cb);
    px[i + 3] = Math.round(a * 255);
  }
}

// PNG encode
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon written:', out, png.length, 'bytes');
