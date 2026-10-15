import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
import { cadV3 } from './cad-v3.mjs';
import { cadV4, cadV4Coverage } from './cad-v4.mjs';

const out = 'docs/design/icon-review/iteration-4-cad';
mkdirSync(out, { recursive: true });
const byId = new Map(iconSource.map((entry) => [entry.id, entry]));
const v3 = new Map(cadV3.map((entry) => [`${entry.id}/${entry.variant}`, entry]));
for (const { id } of cadV4) if (!byId.has(id)) throw new Error(`Unknown icon ID ${id}`);
for (const [id] of cadV4Coverage) if (!byId.has(id)) throw new Error(`Unknown review ID ${id}`);

const v3VariantFor = {
  'revolve/stepped-profile-axis': 'revolve/closed-profile',
  'revolve/stepped-lathe-result': 'revolve/turned-result',
  'loft/oblique-section-rhombi': 'loft/wire-sections',
  'sweep/tube-no-centerline': 'sweep/closed-tube-result',
  'sweep/tube-centerline-end-seam': 'sweep/closed-tube-result',
  'select-face/isolated-body-axis-face': 'select-face/isolated-face-shared-cursor',
  'select-edge/isolated-body-axis-edge': 'select-edge/isolated-edge-shared-cursor',
};

const boolIds = ['boolean', 'boolean-union', 'boolean-subtract', 'boolean-intersect'];
const rows = [
  ...cadV4.map((entry) => ({ ...entry, kind: 'candidate' })),
  ...boolIds.map((id) => ({ id, variant: 'boolean-closure-review', kind: 'boolean', paths: byId.get(id).paths })),
];
const palette = {
  dark: { bg: '#11171c', fg: '#dbe5eb', muted: '#8fa0aa', rule: '#29353d' },
  light: { bg: '#f4f7f9', fg: '#263641', muted: '#647680', rule: '#d3dde2' },
};

function svgFor(paths) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
}
function draw(paths, x, y, px, color) {
  const scale = px / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

for (const entry of cadV4) {
  const svg = svgFor(entry.paths);
  const bounds = new Resvg(svg).getBBox();
  if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 24 || bounds.y + bounds.height > 24) {
    throw new Error(`${entry.id}/${entry.variant} outside 24-unit viewBox: ${JSON.stringify(bounds)}`);
  }
  for (const px of [14, 15, 16, 24]) {
    const pixels = new Resvg(svg, { fitTo: { mode: 'width', value: px } }).render().pixels;
    if (!pixels.some((alpha, index) => index % 4 === 3 && alpha > 0)) throw new Error(`${entry.id}/${entry.variant} empty at ${px}px`);
  }
}

for (const [theme, colors] of Object.entries(palette)) {
  for (const px of [14, 15, 16, 24]) {
    const width = 560;
    const titleH = 78;
    const rowH = 58;
    const height = titleH + rows.length * rowH;
    let s = `<rect width="${width}" height="${height}" fill="${colors.bg}"/>`;
    s += `<text x="16" y="25" font-family="Segoe UI, sans-serif" font-size="17" fill="${colors.fg}">CAD iteration 4 • ${theme} • exact ${px}px</text>`;
    s += `<text x="16" y="47" font-family="Segoe UI, sans-serif" font-size="11" fill="${colors.muted}">Current source · v3 candidate · v4 alternative</text>`;
    s += `<text x="264" y="69" font-family="Segoe UI, sans-serif" font-size="9" fill="${colors.muted}">source</text>`;
    s += `<text x="342" y="69" font-family="Segoe UI, sans-serif" font-size="9" fill="${colors.muted}">v3</text>`;
    s += `<text x="420" y="69" font-family="Segoe UI, sans-serif" font-size="9" fill="${colors.muted}">v4</text>`;
    rows.forEach((row, i) => {
      const y = titleH + i * rowH;
      const current = byId.get(row.id);
      const v3Name = v3VariantFor[`${row.id}/${row.variant}`];
      const v3Entry = v3Name ? v3.get(v3Name) : undefined;
      s += `<line x1="10" y1="${y + rowH - 1}" x2="550" y2="${y + rowH - 1}" stroke="${colors.rule}"/>`;
      s += `<text x="16" y="${y + 16}" font-family="Segoe UI, sans-serif" font-size="11" fill="${colors.fg}">${row.id}</text>`;
      s += `<text x="16" y="${y + 32}" font-family="Segoe UI, sans-serif" font-size="9" fill="${colors.muted}">${row.variant}</text>`;
      s += draw(current.paths, 256, y + 4, px, colors.fg);
      if (v3Entry) s += draw(v3Entry.paths, 334, y + 4, px, colors.fg);
      else s += `<text x="340" y="${y + 21}" font-family="Segoe UI, sans-serif" font-size="9" fill="${colors.muted}">—</text>`;
      if (row.kind === 'candidate') s += draw(row.paths, 412, y + 4, px, colors.fg);
      else s += `<text x="420" y="${y + 21}" font-family="Segoe UI, sans-serif" font-size="9" fill="${colors.muted}">retain</text>`;
    });
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${s}</svg>`;
    writeFileSync(`${out}/${theme}-${px}.png`, new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng());
  }
}

const coverage = cadV4Coverage.map(([id, decision, note]) => `| \`${id}\` | ${decision} | ${note} |`).join('\n');
writeFileSync(`${out}/boolean-and-focus-coverage.md`, `# Iteration 4 focused coverage\n\n| ID | Decision | Finding |\n| --- | --- | --- |\n${coverage}\n`);
console.log(`Rendered ${cadV4.length} v4 alternatives plus all four Boolean IDs in dark and light at 14, 15, 16, and 24px; validated candidate paths and reviewed all ${cadV4Coverage.length} focus IDs.`);
