/** Deterministic Baseline G raster assets. Node built-ins only; no network or font dependency. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const COLORS = { background: [11, 17, 24], mint: [99, 230, 208], violet: [124, 140, 255], white: [255, 255, 255] };
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = CRC[(crc ^ byte) & 255] ^ (crc >>> 8);
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, checksum]);
}
function sample(x, y, kind) {
  if (kind !== 'icon') { x = 512 + (x - 512) / 0.84; y = 512 + (y - 512) / 0.84; }
  const nodeDistance = Math.hypot(x - 548, y - 512);
  if (nodeDistance <= 26) return kind === 'monochrome' ? COLORS.white : COLORS.violet;
  const background = kind === 'icon' ? COLORS.background : null;
  if (nodeDistance < 37) return background;
  const dx = x - 512, dy = y - 512;
  const inGap = dx > 0 && dy < 0 && -dy < dx * 201 / 217;
  const arc = !inGap && Math.abs(Math.hypot(dx, dy) - 296) <= 37;
  const upperCap = Math.hypot(x - 729, y - 311) <= 37;
  const crossbar = Math.hypot(x - Math.max(548, Math.min(808, x)), y - 512) <= 37;
  return arc || upperCap || crossbar ? kind === 'monochrome' ? COLORS.white : COLORS.mint : background;
}
function renderIcon(size, kind = 'icon') {
  if (!Number.isInteger(size) || size < 16 || size > 1024 || !['icon', 'foreground', 'monochrome'].includes(kind)) throw new Error('Unsupported brand asset');
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const samples = size <= 64 ? 4 : 2;
  const total = samples * samples;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, coverage = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const color = sample((x + (sx + 0.5) / samples) * 1024 / size, (y + (sy + 0.5) / samples) * 1024 / size, kind);
      if (color) { r += color[0]; g += color[1]; b += color[2]; coverage++; }
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    if (coverage) { raw[offset] = Math.round(r / coverage); raw[offset + 1] = Math.round(g / coverage); raw[offset + 2] = Math.round(b / coverage); }
    raw[offset + 3] = Math.round(255 * coverage / total);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ensureBrandAssets() {
  const directory = path.join(ROOT, 'assets/images');
  const revision = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  const marker = path.join(directory, '.baseline-build');
  const outputs = [['baseline-icon', 1024, 'icon'], ['baseline-foreground', 1024, 'foreground'], ['baseline-monochrome', 1024, 'monochrome'], ['baseline-favicon', 64, 'icon']];
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === revision && outputs.every(([name]) => fs.existsSync(path.join(directory, `${name}.png`)))) return;
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, size, kind] of outputs) fs.writeFileSync(path.join(directory, `${name}.png`), renderIcon(size, kind));
  fs.writeFileSync(marker, revision);
}
module.exports = { renderIcon, ensureBrandAssets };
if (require.main === module) ensureBrandAssets();
