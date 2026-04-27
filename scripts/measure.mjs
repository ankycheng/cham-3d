import fs from 'fs';
import path from 'path';

const ROW = 32;

function bbox(file) {
  const buf = fs.readFileSync(file);
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
  const n = buf.length / ROW;
  let minX=Infinity, minY=Infinity, minZ=Infinity, maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
  let sumX=0, sumY=0, sumZ=0;
  for (let i = 0; i < n; i++) {
    const x = f32[i*8], y = f32[i*8+1], z = f32[i*8+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    sumX += x; sumY += y; sumZ += z;
  }
  return {
    file: path.basename(file), n,
    min: [minX, minY, minZ].map(v=>+v.toFixed(3)),
    max: [maxX, maxY, maxZ].map(v=>+v.toFixed(3)),
    size: [maxX-minX, maxY-minY, maxZ-minZ].map(v=>+v.toFixed(3)),
    centroid: [sumX/n, sumY/n, sumZ/n].map(v=>+v.toFixed(3)),
  };
}

for (const f of ['mask-left.splat', 'mask-center.splat', 'mask-right.splat']) {
  console.log(JSON.stringify(bbox('/tmp/cham-3d/'+f), null, 2));
}
