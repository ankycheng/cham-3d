#!/usr/bin/env node
// Merge three single-mask .splat files into one composite mask-trio.splat
// with X-axis offsets so the masks sit side-by-side. Run from repo root.
//
// Splat row format (32 bytes):
//   bytes 0..11   xyz position (3 × float32)
//   bytes 12..23  xyz scale    (3 × float32)
//   bytes 24..27  RGBA color   (4 × uint8)
//   bytes 28..31  rotation     (4 × uint8 quaternion, normalized to [-1,1])
//
// Bounding boxes (from scripts/measure.mjs) measured before renaming:
//   shawa       width 0.46, x∈[-0.23, 0.23]
//   guru        width 0.34, x∈[-0.17, 0.17]   (was mask-right.splat)
//   zhanag      width 0.49, x∈[-0.28, 0.21]   (was mask-center.splat)
//
// Layout chosen so each mask gets its own breathing room (~0.1 unit gap):
//   shawa  at x = -0.60  → screen LEFT
//   guru   at x =  0.00  → middle
//   zhanag at x = +0.55  → screen RIGHT

import fs from 'fs';
import path from 'path';

const ROW = 32;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// X positions: world -X → screen left, world +X → screen right under our
// default camera. Order matches the carousel's reading order.
const layout = [
  { file: 'mask-shawa.splat',        dx: -0.60 }, // screen-left
  { file: 'mask-guru-drakmar.splat', dx:  0.00 }, // middle
  { file: 'mask-zhanag.splat',       dx:  0.55 }, // screen-right
];

// Visual-center Y offsets, derived from rendering each mask alone in
// preview.html (dist=1.4) and measuring the pixel-y centroid of non-background
// pixels (scripts/measure-visual-center.mjs). Bbox bases would mis-align
// because each mask's "base" sits at a different physical level relative to
// where the eye reads the visual mass (Shawa's deer head vs ZhaNag's tall
// stand-and-hat). The per-mask dy shifts each rendered centroid onto a shared
// screen line.
//
// Conversion: at fy=1100, projection-height=873, canvas-pixel-height=1746,
// dist=1.4, the pixel-per-world-y ratio is fy * H_canvas / (H_proj * dist) ≈
// 1571 px / world-unit. dy = (target_centroid_px - measured_centroid_px) / 1571.
//
// Measured centroids (px, lower = lower on screen):
//   shawa  957.8   guru  894.7   zhanag  884.5
// Aligning all to the average (912.3 px):
//   shawa  → dy ≈ -0.029  (lift up)
//   guru   → dy ≈ +0.011  (drop slightly)
//   zhanag → dy ≈ +0.018  (drop slightly)
const dyByFile = {
  'mask-shawa.splat':        -0.029,
  'mask-guru-drakmar.splat':  0.011,
  'mask-zhanag.splat':        0.018,
};

const sources = layout.map(({ file, dx }) => {
  const buf = fs.readFileSync(path.join(ROOT, file));
  if (buf.length % ROW !== 0) throw new Error(`${file}: length ${buf.length} is not a multiple of ${ROW}`);
  return { file, dx, dy: dyByFile[file] ?? 0, buf, n: buf.length / ROW };
});

const buffers = [];
let total = 0;
for (const { file, dx, dy, buf, n } of sources) {
  const out = Buffer.from(buf);
  const f32 = new Float32Array(out.buffer, out.byteOffset, out.byteLength >> 2);
  for (let i = 0; i < n; i++) {
    f32[i * 8] += dx;
    f32[i * 8 + 1] += dy;
  }
  buffers.push(out);
  total += out.length;
  console.log(`${file}: ${n} splats, dx=${dx.toFixed(3)}, dy=${dy.toFixed(3)}`);
}

const merged = Buffer.concat(buffers, total);
const outPath = path.join(ROOT, 'mask-trio.splat');
fs.writeFileSync(outPath, merged);
console.log(`\nwrote ${outPath} (${merged.length} bytes, ${merged.length / ROW} splats)`);
