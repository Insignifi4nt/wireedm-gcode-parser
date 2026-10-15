import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
import { cadRevisions } from './cad.mjs';

const out = 'docs/design/icon-review/iteration-2-cad';
mkdirSync(out, { recursive: true });
const revisions = new Map(cadRevisions.map((entry) => [entry.id, entry]));
const ids = cadRevisions.map(({ id }) => id);
const originals = new Map(iconSource.map((entry) => [entry.id, entry]));
const rows = ids.map((id) => {
  const old = originals.get(id);
  const next = revisions.get(id);
  if (!old) throw new Error(`Unknown catalog id ${id}`);
  return { id, old, next };
});
for (const { id, next } of rows) {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${next.paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
  const bounds = new Resvg(xml).getBBox();
  if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 24 || bounds.y + bounds.height > 24) {
    throw new Error(`${id} proposed geometry falls outside 24x24 viewBox: ${JSON.stringify(bounds)}`);
  }
  for (const px of [14, 15, 16, 24]) {
    const pixels = new Resvg(xml, { fitTo: { mode: 'width', value: px } }).render().pixels;
    if (!pixels.some((alpha, index) => index % 4 === 3 && alpha > 0)) throw new Error(`${id} is empty at ${px}px`);
  }
}

const bg = '#11171c';
const fg = '#e1e9ee';
const muted = '#8fa0aa';
function pathGroup(paths, x, y, px) {
  const scale = px / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${fg}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

for (const px of [14, 15, 16, 24]) {
  const width = 450;
  const rowH = 58;
  const height = 78 + rows.length * rowH;
  let s = `<rect width="${width}" height="${height}" fill="${bg}"/>`;
  s += `<text x="18" y="27" font-family="Segoe UI, sans-serif" font-size="17" fill="${fg}">CAD iteration 2 • exact ${px}px render</text>`;
  s += `<text x="18" y="48" font-family="Segoe UI, sans-serif" font-size="11" fill="${muted}">Current left · proposed right · same 24-unit viewBox and 1.75 stroke</text>`;
  rows.forEach(({ id, old, next }, i) => {
    const y = 66 + i * rowH;
    s += `<line x1="12" y1="${y + rowH - 2}" x2="438" y2="${y + rowH - 2}" stroke="#29353d"/>`;
    s += `<text x="18" y="${y + 19}" font-family="Segoe UI, sans-serif" font-size="12" fill="${fg}">${id}</text>`;
    s += pathGroup(old.paths, 224, y + 7, px);
    s += pathGroup(next.paths, 292, y + 7, px);
    s += `<text x="215" y="${y + 48}" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">current</text>`;
    s += `<text x="285" y="${y + 48}" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">proposal</text>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${s}</svg>`;
  writeFileSync(`${out}/compare-${px}.png`, new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng());
}
const familyIds = [
  'sketch', 'body', 'imported-body', 'datum-plane', 'pad', 'pocket', 'pad-pocket',
  'fillet', 'chamfer', 'shell', 'revolve', 'loft', 'sweep', 'boolean',
  'boolean-union', 'boolean-subtract', 'boolean-intersect', 'linear-pattern',
  'circular-pattern', 'pattern', 'mirror', 'select', 'select-face', 'select-edge',
  'select-body', 'slot', 'polyline', 'closed-path', 'arc', 'line', 'circle',
  'rectangle', 'fit-view', 'grid', 'view', 'view-top', 'camera-orbit',
  'camera-pan', 'camera-capture',
];
const family = familyIds.map((id) => originals.get(id));
for (const px of [14, 24]) {
  const columns = 5;
  const cellW = 116;
  const cellH = 72;
  const width = columns * cellW;
  const height = 48 + Math.ceil(family.length / columns) * cellH;
  let s = `<rect width="${width}" height="${height}" fill="${bg}"/><text x="14" y="25" font-family="Segoe UI, sans-serif" font-size="16" fill="${fg}">Current CAD / geometry / view family • ${px}px</text>`;
  family.forEach((entry, i) => {
    const x = (i % columns) * cellW;
    const y = 42 + Math.floor(i / columns) * cellH;
    s += pathGroup(entry.paths, x + 10, y + 4, px);
    s += `<text x="${x + 34}" y="${y + 21}" font-family="Segoe UI, sans-serif" font-size="9" fill="${fg}">${entry.id}</text>`;
    s += `<line x1="${x + 5}" y1="${y + cellH - 2}" x2="${x + cellW - 5}" y2="${y + cellH - 2}" stroke="#29353d"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${s}</svg>`;
  writeFileSync(`${out}/family-${px}.png`, new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng());
}
console.log(`Rendered ${rows.length} current/proposed CAD pairs at 14, 15, 16, and 24 actual pixels.`);
