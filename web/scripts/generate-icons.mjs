#!/usr/bin/env node
// Rasterizes the PWA icon set (a node-graph glyph on the accent color)
// without any image library: SDF shading + hand-rolled PNG encoding.

import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PUBLIC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const ACCENT = [0x4f, 0x46, 0xe5];
const WHITE = [0xff, 0xff, 0xff];

const NODES = [
  { x: 0.28, y: 0.5 },
  { x: 0.72, y: 0.26 },
  { x: 0.72, y: 0.74 },
];
const EDGES = [
  [0, 1],
  [0, 2],
];
const NODE_RADIUS = 0.105;
const EDGE_HALF_WIDTH = 0.026;

function circleSdf(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function segmentSdf(px, py, ax, ay, bx, by, halfWidth) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  return Math.hypot(apx - t * abx, apy - t * aby) - halfWidth;
}

function glyphCoverage(u, v, scale) {
  const cx = 0.5 + (u - 0.5) / scale;
  const cy = 0.5 + (v - 0.5) / scale;
  let sdf = Infinity;
  for (const [a, b] of EDGES) {
    sdf = Math.min(
      sdf,
      segmentSdf(cx, cy, NODES[a].x, NODES[a].y, NODES[b].x, NODES[b].y, EDGE_HALF_WIDTH / scale)
    );
  }
  for (const node of NODES) {
    sdf = Math.min(sdf, circleSdf(cx, cy, node.x, node.y, NODE_RADIUS / scale));
  }
  return sdf;
}

function renderIcon(size, glyphScale) {
  const pixels = Buffer.alloc(size * size * 4);
  const aa = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const sdf = glyphCoverage(u, v, glyphScale);
      const coverage = Math.max(0, Math.min(1, 0.5 - sdf / aa));
      const offset = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        pixels[offset + c] = Math.round(ACCENT[c] + (WHITE[c] - ACCENT[c]) * coverage);
      }
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(pixels, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const ICONS = [
  { file: 'pwa-192x192.png', size: 192, glyphScale: 1 },
  { file: 'pwa-512x512.png', size: 512, glyphScale: 1 },
  // Maskable safe zone: glyph shrunk toward the center.
  { file: 'maskable-icon-512x512.png', size: 512, glyphScale: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, glyphScale: 0.9 },
];

await mkdir(PUBLIC_DIR, { recursive: true });
for (const { file, size, glyphScale } of ICONS) {
  const path = resolve(PUBLIC_DIR, file);
  await writeFile(path, encodePng(renderIcon(size, glyphScale), size));
  console.log(`Wrote ${path}`);
}
