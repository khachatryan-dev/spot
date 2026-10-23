// Draw the app icons (home screen, Android, iOS) from the Spot mark:
// white crossed utensils on the orange→rose gradient.
//   node scripts/generate-app-icons.mjs
import { mkdir } from "node:fs/promises";

import sharp from "sharp";

const GLYPH = `
  <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/>
  <path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/>
  <path d="m2.1 21.8 6.4-6.3"/>
  <path d="m19 5-7 7"/>`;

/** `radius` 0 = full square (maskable / iOS round it themselves); `glyph` = share of the size. */
const svg = (size, { radius, glyph }) => {
  const g = size * glyph;
  const offset = (size - g) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#f43f5e"/>
  </linearGradient></defs>
  <rect width="${size}" height="${size}" rx="${size * radius}" fill="url(#bg)"/>
  <g transform="translate(${offset} ${offset}) scale(${g / 24})" fill="none" stroke="#fff"
     stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>
</svg>`;
};

const icons = [
  ["public/icons/icon-192.png", 192, { radius: 0.22, glyph: 0.56 }],
  ["public/icons/icon-512.png", 512, { radius: 0.22, glyph: 0.56 }],
  // Maskable: full bleed, glyph inside the 80% safe zone.
  ["public/icons/maskable-512.png", 512, { radius: 0, glyph: 0.46 }],
  ["src/app/apple-icon.png", 180, { radius: 0, glyph: 0.52 }],
];

await mkdir("public/icons", { recursive: true });
for (const [file, size, options] of icons) {
  await sharp(Buffer.from(svg(size, options)))
    .png()
    .toFile(file);
  console.log(`wrote ${file}`);
}
