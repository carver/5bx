#!/usr/bin/env node
/*
 * Rasterizes icons/icon-badge.svg into icons/icon-badge-96.png.
 *
 * Android's notification tray (Notification.badge, and the small status-bar
 * icon) ignores color entirely and uses only the alpha channel: every opaque
 * pixel becomes a single OS-chosen flat color, every transparent pixel stays
 * background. icon-192.png is fully opaque edge-to-edge (a filled square, by
 * design — that's correct for the "any"-purpose app icon), so handing it to
 * `badge` makes the whole square opaque and it renders as a solid white
 * block. This generates a real silhouette instead: white glyph, transparent
 * everywhere else.
 *
 * Zero dependencies on purpose — this is a one-shot dev tool, not something
 * the app ships or runs. `node tools/generate-badge-icon.mjs`, then commit
 * the regenerated PNG if icon-badge.svg's geometry changes.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../icons/icon-badge-96.png', import.meta.url));

// Same five-bars geometry as icon-badge.svg's 512x512 viewBox.
const SOURCE_SIZE = 512;
const BARS = [
  { x: 68, y: 288, w: 56, h: 96, r: 14 },
  { x: 148, y: 248, w: 56, h: 136, r: 14 },
  { x: 228, y: 208, w: 56, h: 176, r: 14 },
  { x: 308, y: 168, w: 56, h: 216, r: 14 },
  { x: 388, y: 128, w: 56, h: 256, r: 14 },
];

const SIZE = 96;
const SUPERSAMPLE = 4; // render at 4x and box-filter down for antialiasing
const RENDER_SIZE = SIZE * SUPERSAMPLE;
const scale = RENDER_SIZE / SOURCE_SIZE;

function insideRoundedRect(px, py, bar) {
  const minX = bar.x * scale;
  const minY = bar.y * scale;
  const maxX = (bar.x + bar.w) * scale;
  const maxY = (bar.y + bar.h) * scale;
  const r = bar.r * scale;

  if (px < minX || px > maxX || py < minY || py > maxY) return false;

  const inStraightX = px >= minX + r && px <= maxX - r;
  const inStraightY = py >= minY + r && py <= maxY - r;
  if (inStraightX || inStraightY) return true;

  const cx = px < minX + r ? minX + r : maxX - r;
  const cy = py < minY + r ? minY + r : maxY - r;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

/* --------------------------------------------------------- supersampled render */

const hi = new Uint8Array(RENDER_SIZE * RENDER_SIZE); // alpha only; color is always white
for (let y = 0; y < RENDER_SIZE; y += 1) {
  for (let x = 0; x < RENDER_SIZE; x += 1) {
    const px = x + 0.5;
    const py = y + 0.5;
    const hit = BARS.some((bar) => insideRoundedRect(px, py, bar));
    if (hit) hi[y * RENDER_SIZE + x] = 255;
  }
}

/* ------------------------------------------------------- box-filter downsample */

const rgba = new Uint8Array(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    let sum = 0;
    for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
      for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
        sum += hi[(y * SUPERSAMPLE + sy) * RENDER_SIZE + (x * SUPERSAMPLE + sx)];
      }
    }
    const alpha = Math.round(sum / (SUPERSAMPLE * SUPERSAMPLE));
    const i = (y * SIZE + x) * 4;
    rgba[i] = 255;     // R
    rgba[i + 1] = 255; // G
    rgba[i + 2] = 255; // B
    rgba[i + 3] = alpha;
  }
}

/* ------------------------------------------------------------------- PNG encode */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([len, typeBytes, data, crc]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // One filter-type-0 (None) byte per scanline, then raw RGBA.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    Buffer.from(rgbaBuffer.buffer, y * width * 4, width * 4)
      .copy(raw, rowStart + 1);
  }
  const idat = deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(OUT, encodePng(SIZE, SIZE, rgba));
console.log(`wrote ${OUT} (${SIZE}x${SIZE})`);
