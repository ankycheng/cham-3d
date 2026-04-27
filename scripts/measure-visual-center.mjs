#!/usr/bin/env node
// Measure each mask's visual center after rendering it alone in preview.html.
// Captures a CDP screenshot per mask, then computes the y-centroid of
// non-black, non-transparent pixels. Outputs normalized centroid (0=top, 1=bottom).
//
// Requires:
//   - cham-3d local server at http://127.0.0.1:8924
//   - Chrome tab open at preview.html (target id passed as argv[2], default C8CA3C2A)

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const TARGET = process.argv[2] || 'C8CA3C2A';
const CDP = `${process.env.HOME}/.claude/skills/chrome-cdp/scripts/cdp.mjs`;
const masks = ['mask-shawa.splat', 'mask-guru-drakmar.splat', 'mask-zhanag.splat'];

// Tiny PNG decoder: reads IHDR + decodes IDAT to raw RGBA8.
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); p += 4;
    const type = buf.toString('ascii', p, p + 4); p += 4;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(p);
      height = buf.readUInt32BE(p + 4);
      bitDepth = buf[p + 8];
      colorType = buf[p + 9];
    } else if (type === 'IDAT') {
      idat.push(buf.slice(p, p + len));
    } else if (type === 'IEND') {
      break;
    }
    p += len + 4; // data + CRC
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported, got ' + bitDepth);
  if (colorType !== 6 && colorType !== 2) throw new Error('only RGB/RGBA supported, got colorType ' + colorType);
  const channels = colorType === 6 ? 4 : 3;
  const inflated = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prevRow = Buffer.alloc(stride);
  let inP = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[inP++];
    const row = inflated.slice(inP, inP + stride);
    inP += stride;
    const decoded = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[x - channels] : 0;
      const up = prevRow[x];
      const upLeft = x >= channels ? prevRow[x - channels] : 0;
      let r = row[x];
      switch (filter) {
        case 0: break;
        case 1: r = (r + left) & 0xff; break;
        case 2: r = (r + up) & 0xff; break;
        case 3: r = (r + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          const pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          r = (r + pred) & 0xff; break;
        }
        default: throw new Error('unknown filter ' + filter);
      }
      decoded[x] = r;
    }
    decoded.copy(out, y * stride);
    prevRow = decoded;
  }
  return { width, height, channels, data: out };
}

function visualCenterY(img) {
  const { width, height, channels, data } = img;
  let sumY = 0, count = 0;
  let minY = Infinity, maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // Treat very dark pixels as background (canvas bg is #000)
      if (r + g + b > 30) {
        sumY += y;
        count++;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return count
    ? { count, centroidY: sumY / count, minY, maxY, height }
    : { count: 0, centroidY: 0, minY: 0, maxY: 0, height };
}

const results = [];
for (const file of masks) {
  const url = `http://127.0.0.1:8924/preview.html?url=./${file}&dist=1.4&rotate=99999`;
  console.log(`\n→ ${file}`);
  execSync(`${CDP} nav ${TARGET} '${url}' >/dev/null`);
  // Wait for the splat to load + first frame to render
  execSync('sleep 4');
  const tmp = `/tmp/measure-${file}.png`;
  execSync(`${CDP} shot ${TARGET} ${tmp} >/dev/null 2>&1`);
  const img = decodePng(fs.readFileSync(tmp));
  const { count, centroidY, minY, maxY, height } = visualCenterY(img);
  if (!count) { console.log('  no visible pixels (canvas likely empty)'); continue; }
  const normalized = centroidY / height;
  console.log(`  visible px: ${count}, height ${height}, centroid y=${centroidY.toFixed(0)} (${(normalized * 100).toFixed(1)}% from top)`);
  console.log(`  vertical extent: ${minY}..${maxY}`);
  results.push({ file, count, centroidY, minY, maxY, height, normalized });
}

console.log('\n--- summary ---');
console.log(JSON.stringify(results, null, 2));
