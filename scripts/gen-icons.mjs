// Generuje ikony PWA z jednego SVG. Uruchamiane ręcznie: npm run icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const shield = (scale) => {
  const offset = 256 * (1 - scale);
  return `<g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="M256 84 396 134v116c0 92-58 150-140 178-82-28-140-86-140-178V134Z" fill="#f4f1e8"/>
    <path d="m192 258 46 46 86-92" fill="none" stroke="#0f5c50" stroke-width="36" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;
};

const svg = ({ radius, scale }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${radius}" fill="#0f5c50"/>${shield(scale)}</svg>`;

const png = (source, size) => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();

const dir = new URL('../public/icons/', import.meta.url);
mkdirSync(dir, { recursive: true });

const rounded = svg({ radius: 112, scale: 1 });
const square = svg({ radius: 0, scale: 1 });
const maskable = svg({ radius: 0, scale: 0.76 });

writeFileSync(new URL('icon.svg', dir), rounded);
writeFileSync(new URL('icon-192.png', dir), png(rounded, 192));
writeFileSync(new URL('icon-512.png', dir), png(rounded, 512));
writeFileSync(new URL('icon-maskable-512.png', dir), png(maskable, 512));
// iOS sam zaokrągla narożniki, więc ikona musi być pełnym kwadratem.
writeFileSync(new URL('apple-touch-icon.png', dir), png(square, 180));
