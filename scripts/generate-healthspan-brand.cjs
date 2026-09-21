/* Dependency-free, deterministic native icon generator. No network or user data. */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const MINT = [99, 230, 208], VIOLET = [124, 140, 255], NAVY = [11, 17, 24];
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const kind = Buffer.from(type); const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0); kind.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([kind, data])), 8 + data.length); return result;
}
function contains(x, y) {
  const dx = x - 128, dy = y - 128, radius = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
  const arc = radius >= 68 && radius <= 88 && !(angle > -Math.PI / 4 && angle < 0);
  const cap = Math.hypot(x - 183.1543289, y - 72.8456711) <= 10;
  const bar = Math.hypot(x - Math.max(140, Math.min(206, x)), y - 128) <= 10;
  return arc || cap || bar;
}
function render(size, { transparent = false, monochrome = false, scale = 1 } = {}) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const totals = [0, 0, 0]; let alpha = 0;
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      const px = ((x + (sx + 0.5) / 2) / size * 256 - 128) / scale + 128;
      const py = ((y + (sy + 0.5) / 2) / size * 256 - 128) / scale + 128;
      const ink = contains(px, py);
      if (!ink && transparent) continue;
      const rgb = ink ? monochrome ? [255, 255, 255] : Math.hypot(px - 184, py - 128) <= 9 ? VIOLET : MINT : NAVY;
      alpha++; rgb.forEach((value, index) => { totals[index] += value; });
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 3; channel++) raw[offset + channel] = alpha ? Math.round(totals[channel] / alpha) : 0;
    raw[offset + 3] = Math.round(alpha / 4 * 255);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function generate(root = path.resolve(__dirname, '..')) {
  const directory = path.join(root, 'assets', 'healthspan'); fs.mkdirSync(directory, { recursive: true });
  const signature = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
  const outputs = [['icon.png', 1024, {}], ['adaptive-foreground.png', 1024, { transparent: true, scale: 0.86 }], ['monochrome.png', 1024, { transparent: true, monochrome: true, scale: 0.86 }], ['splash.png', 1024, { transparent: true, scale: 0.86 }], ['favicon.png', 64, {}]];
  const stamp = path.join(directory, '.signature');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === signature && outputs.every(([name]) => fs.existsSync(path.join(directory, name)))) return directory;
  for (const [name, size, options] of outputs) fs.writeFileSync(path.join(directory, name), render(size, options));
  fs.writeFileSync(stamp, signature); return directory;
}
module.exports = { generate, render, contains };
if (require.main === module) console.log(generate());
