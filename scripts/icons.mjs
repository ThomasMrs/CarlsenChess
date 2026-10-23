import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const n of data) crc = crcTable[(crc ^ n) & 255] ^ (crc >>> 8);
  const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
  const footer = Buffer.alloc(4); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([header, data, footer]);
}
const silhouette = [[34,91],[40,76],[52,65],[59,51],[48,54],[38,67],[25,62],[30,50],[45,31],[48,19],[60,25],[67,22],[81,38],[89,58],[89,91]];
function inside(x, y, points) {
  let result = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}
await mkdir(new URL('../extension/icons/', import.meta.url), { recursive: true });
for (const size of [16,32,48,128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sum = [0,0,0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5)/4) * 128/size, py = (y + (sy + .5)/4) *128/size;
      let color = [29,32,31];
      if (inside(px, py, silhouette) || (px >= 30 && px <= 94 && py >= 96 && py <= 106)) color = [223,170,115];
      if ((px-53)**2+(py-42)**2 < 7) color = [29,32,31];
      for(let c=0;c<3;c++) sum[c] += color[c];
    }
    const index = y*(size*4+1)+1+x*4;
    for(let c=0;c<3;c++) pixels[index+c] = Math.round(sum[c]/16);
    pixels[index+3] = 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  await writeFile(new URL(`../extension/icons/icon${size}.png`, import.meta.url), png);
}
