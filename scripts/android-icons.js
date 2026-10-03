// Renders the Android launcher icons and splash icon from icons/icon.svg's
// design with headless Chrome (real Poppins, installed on the Mac):
//   npm run android:icons
// Android icons are adaptive: a full-bleed background layer and a foreground
// layer, each 108dp, of which the launcher shows about the middle 72dp
// through its mask (circle on a Pixel). So the 512-unit iPhone icon maps to
// that middle 72dp: the layers are drawn on a 768-unit canvas (-128..640).
// Older launchers (Android 7) get the whole icon, rounded and round.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RES = fileURLToPath(new URL('../android/app/src/main/res/', import.meta.url));

const GRADIENT = `
  <linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="512" x2="512" y2="0">
    <stop offset="0" stop-color="#05203c"/>
    <stop offset="0.45" stop-color="#05203c"/>
    <stop offset="1" stop-color="#46bb93"/>
  </linearGradient>`;
const TILES = `
  <rect x="100" y="146" width="146" height="220" rx="30" fill="#0a0a0a" fill-opacity="0.88"/>
  <rect x="266" y="146" width="146" height="220" rx="30" fill="#0a0a0a" fill-opacity="0.88"/>
  <text x="173" y="311" font-family="Poppins" font-size="150" font-weight="700" fill="#ffffff" text-anchor="middle">2</text>
  <text x="339" y="311" font-family="Poppins" font-size="150" font-weight="700" fill="#46bb93" text-anchor="middle">1</text>
  <rect x="100" y="254" width="312" height="5" fill="#0a0a0a" fill-opacity="0.9"/>`;

const LAYER = 'viewBox="-128 -128 768 768"';
const svgs = {
  background: `<svg xmlns="http://www.w3.org/2000/svg" ${LAYER}><defs>${GRADIENT}</defs>
    <rect x="-128" y="-128" width="768" height="768" fill="url(#fade)"/></svg>`,
  foreground: `<svg xmlns="http://www.w3.org/2000/svg" ${LAYER}>${TILES}</svg>`,
  // The whole icon, for launchers without adaptive icons and the splash.
  rounded: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRADIENT}
    <clipPath id="c"><rect width="512" height="512" rx="112"/></clipPath></defs>
    <g clip-path="url(#c)"><rect width="512" height="512" fill="#0a0a0a"/><rect width="512" height="512" fill="url(#fade)"/>${TILES}</g></svg>`,
  round: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRADIENT}
    <clipPath id="c"><circle cx="256" cy="256" r="256"/></clipPath></defs>
    <g clip-path="url(#c)"><rect width="512" height="512" fill="#0a0a0a"/><rect width="512" height="512" fill="url(#fade)"/>${TILES}</g></svg>`,
};

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const work = mkdtempSync(join(tmpdir(), 'android-icons-'));

function render(svg, px, out) {
  const html = join(work, 'icon.html');
  writeFileSync(html, `<!doctype html><html><head><style>
    html, body { margin: 0; background: transparent; }
    svg { display: block; width: ${px}px; height: ${px}px; }
  </style></head><body>${svg}</body></html>`);
  execFileSync(CHROME, [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${px},${px}`,
    `--screenshot=${out}`, `file://${html}`,
  ], { stdio: 'ignore' });
}

for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = join(RES, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  render(svgs.background, 108 * scale, join(dir, 'ic_launcher_background.png'));
  render(svgs.foreground, 108 * scale, join(dir, 'ic_launcher_foreground.png'));
  render(svgs.rounded, 48 * scale, join(dir, 'ic_launcher.png'));
  render(svgs.round, 48 * scale, join(dir, 'ic_launcher_round.png'));
}
// The splash's icon (Android 7 to 11; 12 and later draw the launcher icon).
mkdirSync(join(RES, 'drawable-nodpi'), { recursive: true });
render(svgs.rounded, 384, join(RES, 'drawable-nodpi', 'splash_icon.png'));

rmSync(work, { recursive: true, force: true });
console.log('Android icons rendered into android/app/src/main/res/');
