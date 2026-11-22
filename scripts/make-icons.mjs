// Generates the PNG icons in public/ without any image dependency.
// Usage: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const BG = [0x1b, 0x5e, 0x8c];
const FG = [0xff, 0xff, 0xff];
// Paper-plane polygon in a 512 design space (same as public/icon.svg).
const POLY = [[96, 280], [416, 120], [336, 400], [262, 318], [196, 372], [204, 292]];

function inPoly(x, y) {
  let inside = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i];
    const [xj, yj] = POLY[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(size, { maskable }) {
  const SS = 3; // supersampling
  const scale = 512 / size;
  // Maskable: full-bleed background, glyph shrunk into the central safe zone.
  const glyphScale = maskable ? 0.7 : 1;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale;
          const y = (py + (sy + 0.5) / SS) * scale;
          if (maskable || inRoundRect(x, y, 512, 112)) bg++;
          const gx = (x - 256) / glyphScale + 256;
          const gy = (y - 256) / glyphScale + 256;
          if (inPoly(gx, gy) && (maskable || inRoundRect(x, y, 512, 112))) fg++;
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const f = fg / bg || 0;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] * (1 - f) + FG[k] * f);
      raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('public/icon-192.png', render(192, { maskable: false }));
writeFileSync('public/icon-512.png', render(512, { maskable: false }));
writeFileSync('public/icon-maskable-512.png', render(512, { maskable: true }));
console.log('icons written');
