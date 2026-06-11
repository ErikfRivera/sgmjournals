// Renders the SGM Journals brand assets (favicons, apple-touch icon, Google
// Organization logo, and the Open Graph social card) from a single source of
// truth: the three-hexagon "molecular" brand glyph used by HexMark.astro and
// the navbar. Keeping every raster in sync with that one mark is the whole
// point — favicon, app icons, the OG card, and the schema.org logo must all
// show the same logo so search engines and social previews stay consistent.
//
//   node scripts/gen-brand-assets.mjs
//
// Outputs into ./public. Requires @resvg/resvg-js (devDependency).
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// Brand palette (mirrors src/styles/tokens/colors.css).
const TEAL_700 = '#0E4C43'; // brand primary
const TEAL_800 = '#0A3A33';
const TEAL_900 = '#062B26';
const WHITE = '#FFFFFF';

// The shared brand glyph, authored in a 0..48 viewBox exactly like
// HexMark.astro. Rendered at an arbitrary scale/position via a transform.
function glyph(color, { strokeWidth = 2, x = 0, y = 0, size = 48 } = {}) {
  const s = size / 48;
  return `<g transform="translate(${x} ${y}) scale(${s})">
    <g fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linejoin="round">
      <polygon points="24,4 33,9.5 33,20.5 24,26 15,20.5 15,9.5"/>
      <polygon points="13,22 22,27.5 22,38.5 13,44 4,38.5 4,27.5"/>
      <polygon points="35,22 44,27.5 44,38.5 35,44 26,38.5 26,27.5"/>
    </g>
    <g fill="${color}">
      <circle cx="24" cy="15" r="2.4"/>
      <circle cx="13" cy="33" r="2.4"/>
      <circle cx="35" cy="33" r="2.4"/>
    </g>
  </g>`;
}

function render(svg, width) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { loadSystemFonts: true },
    background: 'rgba(0,0,0,0)',
  });
  return r.render().asPng();
}

function write(name, buf) {
  writeFileSync(join(PUBLIC, name), buf);
  console.log(`  wrote public/${name} (${buf.length.toLocaleString()} bytes)`);
}

// ---- App / favicon icons: white rounded tile + teal glyph -----------------
// Matches public/favicon.svg so the rasters Google and mobile devices prefer
// show the identical mark.
function iconTile(px, { opaque = false } = {}) {
  // Rounded transparent corners for favicons; full-bleed opaque tile for the
  // apple-touch-icon, since iOS fills any transparency with black and applies
  // its own corner mask.
  const rx = opaque ? 0 : Math.round(px * 0.1875); // 9/48, matches favicon.svg
  const pad = px * 0.16;
  const g = px - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
    <rect width="${px}" height="${px}" rx="${rx}" fill="${WHITE}"/>
    ${glyph(TEAL_700, { x: pad, y: pad, size: g, strokeWidth: 2 * (g / 48) })}
  </svg>`;
}

// ---- Google Organization logo: square white field, mark + wordmark --------
function organizationLogo() {
  const W = 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
    <rect width="${W}" height="${W}" fill="${WHITE}"/>
    ${glyph(TEAL_700, { x: 196, y: 96, size: 120, strokeWidth: 5 })}
    <text x="256" y="300" text-anchor="middle" font-family="Liberation Serif, Georgia, serif"
      font-weight="700" font-size="84" fill="${TEAL_700}">SGM</text>
    <text x="256" y="384" text-anchor="middle" font-family="Liberation Serif, Georgia, serif"
      font-weight="700" font-size="84" fill="${TEAL_700}">Journals</text>
  </svg>`;
}

// ---- Open Graph card (1200x630): teal field, honeycomb, mark + wordmark ----
function ogCard() {
  const W = 1200;
  const H = 630;
  // Flat-top honeycomb tile for the faint background texture.
  const hex = 'M30,0 L90,0 L120,52 L90,104 L30,104 L0,52 Z';
  const badge = 168; // white rounded badge size
  const bx = 96;
  const by = (H - badge) / 2 - 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${TEAL_700}"/>
        <stop offset="0.6" stop-color="${TEAL_800}"/>
        <stop offset="1" stop-color="${TEAL_900}"/>
      </linearGradient>
      <pattern id="comb" width="180" height="104" patternUnits="userSpaceOnUse" patternTransform="translate(0 0)">
        <path d="${hex}" fill="none" stroke="${WHITE}" stroke-opacity="0.06" stroke-width="2"/>
        <path d="${hex}" transform="translate(90 52)" fill="none" stroke="${WHITE}" stroke-opacity="0.06" stroke-width="2"/>
      </pattern>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#comb)"/>

    <!-- white badge holding the brand mark -->
    <rect x="${bx}" y="${by}" width="${badge}" height="${badge}" rx="36" fill="${WHITE}"/>
    ${glyph(TEAL_700, { x: bx + badge * 0.18, y: by + badge * 0.18, size: badge * 0.64, strokeWidth: 2 * (badge * 0.64 / 48) })}

    <!-- wordmark + tagline -->
    <text x="${bx + badge + 56}" y="296" font-family="Liberation Serif, Georgia, serif"
      font-weight="700" font-size="104" fill="${WHITE}">SGM Journals</text>
    <text x="${bx + badge + 60}" y="360" font-family="Liberation Sans, Arial, sans-serif"
      font-size="40" fill="${WHITE}" fill-opacity="0.82">Peer-reviewed microbiology research archive</text>

    <!-- footer line -->
    <text x="${bx + 4}" y="556" font-family="Liberation Sans, Arial, sans-serif"
      font-size="30" fill="${WHITE}" fill-opacity="0.66">www.sgmjournals.org · Society for General Microbiology</text>
  </svg>`;
}

console.log('Rendering SGM Journals brand assets…');
write('favicon-32.png', render(iconTile(32), 32));
write('favicon-192.png', render(iconTile(192), 192));
write('apple-touch-icon.png', render(iconTile(180, { opaque: true }), 180));
write('logo.png', render(organizationLogo(), 512));
write('og-default.png', render(ogCard(), 1200));
console.log('Done.');
