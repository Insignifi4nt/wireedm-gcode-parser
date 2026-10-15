import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
import { cadRevisions } from './cad.mjs';
import { cadV3, cadV3Coverage } from './cad-v3.mjs';

const out = 'docs/design/icon-review/iteration-3-cad';
mkdirSync(out, { recursive: true });
const sourceById = new Map(iconSource.map((icon) => [icon.id, icon]));
const v2ById = new Map(cadRevisions.map((icon) => [icon.id, icon]));
for (const { id } of cadV3) if (!sourceById.has(id)) throw new Error(`Unknown catalog ID ${id}`);
for (const [id] of cadV3Coverage) if (!sourceById.has(id)) throw new Error(`Unknown coverage ID ${id}`);
const coverageIds = new Set(cadV3Coverage.map(([id]) => id));
const requiredIds = iconSource.filter(({ category }) => ['cad', 'geometry', 'view'].includes(category)).map(({ id }) => id);
const missingCoverage = requiredIds.filter((id) => !coverageIds.has(id));
if (missingCoverage.length) throw new Error(`CAD/geometry/view IDs lack review disposition: ${missingCoverage.join(', ')}`);

const bg = '#11171c';
const fg = '#e1e9ee';
const muted = '#8fa0aa';
const width = 510;
const rowH = 58;
const titleH = 78;

function svgFor(paths) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}
function draw(paths, x, y, px) {
  const scale = px / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${fg}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

for (const { id, variant, paths } of cadV3) {
  const bounds = new Resvg(svgFor(paths)).getBBox();
  if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 24 || bounds.y + bounds.height > 24) {
    throw new Error(`${id}/${variant} outside 24-unit viewBox: ${JSON.stringify(bounds)}`);
  }
  for (const px of [14, 15, 16, 24]) {
    const pixels = new Resvg(svgFor(paths), { fitTo: { mode: 'width', value: px } }).render().pixels;
    if (!pixels.some((alpha, index) => index % 4 === 3 && alpha > 0)) throw new Error(`${id}/${variant} empty at ${px}px`);
  }
}

for (const px of [14, 15, 16, 24]) {
  const height = titleH + cadV3.length * rowH;
  let s = `<rect width="${width}" height="${height}" fill="${bg}"/>`;
  s += `<text x="16" y="25" font-family="Segoe UI, sans-serif" font-size="17" fill="${fg}">CAD iteration 3 • exact ${px}px</text>`;
  s += `<text x="16" y="47" font-family="Segoe UI, sans-serif" font-size="11" fill="${muted}">Current source · rejected v2 candidate · v3 alternative</text>`;
  s += `<text x="257" y="69" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">source</text>`;
  s += `<text x="328" y="69" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">v2</text>`;
  s += `<text x="399" y="69" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">v3</text>`;
  cadV3.forEach(({ id, variant, paths }, i) => {
    const y = titleH + i * rowH;
    const current = sourceById.get(id);
    const v2 = v2ById.get(id);
    s += `<line x1="10" y1="${y + rowH - 1}" x2="500" y2="${y + rowH - 1}" stroke="#29353d"/>`;
    s += `<text x="16" y="${y + 16}" font-family="Segoe UI, sans-serif" font-size="11" fill="${fg}">${id}</text>`;
    s += `<text x="16" y="${y + 32}" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">${variant}</text>`;
    s += draw(current.paths, 250, y + 4, px);
    if (v2) s += draw(v2.paths, 321, y + 4, px);
    else s += `<text x="326" y="${y + 21}" font-family="Segoe UI, sans-serif" font-size="9" fill="${muted}">—</text>`;
    s += draw(paths, 392, y + 4, px);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${s}</svg>`;
  writeFileSync(`${out}/compare-${px}.png`, new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng());
}

const coverageRows = cadV3Coverage.map(([id, action, reason]) => `| \`${id}\` | ${action} | ${reason} |`).join('\n');
writeFileSync(`${out}/coverage.md`, `# CAD iteration 3 review coverage\n\n${requiredIds.length} CAD/geometry/view catalog IDs reviewed${cadV3Coverage.length > requiredIds.length ? `, plus ${cadV3Coverage.length - requiredIds.length} related view icon outside those categories` : ''}. This is a semantic review of source paths; it does not modify catalog assets.\n\n| ID | Disposition | Review note |\n| --- | --- | --- |\n${coverageRows}\n`);
console.log(`Rendered ${cadV3.length} v3 alternatives against current source and available v2 proposals at 14, 15, 16, and 24px; reviewed all ${requiredIds.length} CAD/geometry/view catalog IDs.`);
