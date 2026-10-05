// Renders the app icon to the PNG sizes iOS, Android, and desktop installs need.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';

const BG = '#0E1013';
const TRACK = '#23262C';
const GREEN = '#3DD68C';
const HANDS = '#F5F6F8';

/** A clock face whose rim is a green progress ring: pay building up. `scale` shrinks it for maskable safe zones. */
function icon({ radius = 112, scale = 1 } = {}) {
  const t = (v) => 256 + (v - 256) * scale;
  const r = 150 * scale;
  const w = 44 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${BG}"/>
  <circle cx="256" cy="256" r="${r}" fill="none" stroke="${TRACK}" stroke-width="${w}"/>
  <path d="M256 ${t(106)} A${r} ${r} 0 1 1 ${t(106)} 256" fill="none" stroke="${GREEN}" stroke-width="${w}" stroke-linecap="round"/>
  <path d="M256 256 L256 ${t(178)}" stroke="${HANDS}" stroke-width="${28 * scale}" stroke-linecap="round"/>
  <path d="M256 256 L${t(312)} ${t(290)}" stroke="${HANDS}" stroke-width="${28 * scale}" stroke-linecap="round"/>
  <circle cx="256" cy="256" r="${18 * scale}" fill="${HANDS}"/>
</svg>`;
}

function png(svg, size, out) {
  const data = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(out, data);
  console.log(`wrote ${out}`);
}

mkdirSync('public/icons', { recursive: true });
writeFileSync('public/favicon.svg', icon());
png(icon(), 192, 'public/icons/icon-192.png');
png(icon(), 512, 'public/icons/icon-512.png');
// Maskable and Apple icons are full-bleed squares; the platform rounds the corners.
png(icon({ radius: 0, scale: 0.78 }), 512, 'public/icons/maskable-512.png');
png(icon({ radius: 0, scale: 0.86 }), 180, 'public/apple-touch-icon.png');
