// Writes a synthetic laptop-lid photo pair to server/fixtures/pair/ for 0G tests:
// front-pickup.jpg is clean, front-return.jpg has one deep diagonal scratch. Replace with real photos when available.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const OUT = fileURLToPath(new URL("../fixtures/pair/", import.meta.url));

function lidSvg(scratch: boolean): string {
  const mark = scratch
    ? `<path d="M 330 250 L 610 470" stroke="#d9d9d9" stroke-width="5" stroke-linecap="round"/>
       <path d="M 334 256 L 606 466" stroke="#8a8a8a" stroke-width="1.5"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768">
    <rect width="1024" height="768" fill="#efe9df"/>
    <rect x="132" y="104" width="760" height="560" rx="34" fill="#2f3237"/>
    <rect x="132" y="104" width="760" height="560" rx="34" fill="none" stroke="#1d1f22" stroke-width="6"/>
    <circle cx="512" cy="384" r="34" fill="#45494f"/>
    ${mark}
  </svg>`;
}

mkdirSync(OUT, { recursive: true });
for (const [name, scratch] of [["front-pickup", false], ["front-return", true]] as const) {
  await sharp(Buffer.from(lidSvg(scratch))).jpeg({ quality: 80 }).toFile(`${OUT}${name}.jpg`);
  console.log(`wrote fixtures/pair/${name}.jpg`);
}
