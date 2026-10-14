import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';

const output = 'docs/design/icon-review/selected-cad';
mkdirSync(output, { recursive: true });
const ids = ['datum-plane', 'pad-pocket', 'revolve', 'loft', 'sweep', 'imported-body', 'select-face', 'select-edge', 'select-body'];
const byId = new Map(iconSource.map((entry) => [entry.id, entry]));
for (const id of ids) if (!byId.has(id)) throw new Error(`Missing source icon: ${id}`);
const palette = {
  dark: { bg: '#11171c', fg: '#dbe5eb', muted: '#8fa0aa', rule: '#29353d' },
  light: { bg: '#f4f7f9', fg: '#263641', muted: '#647680', rule: '#d3dde2' },
};

function draw(paths, x, y, px, color) {
  const scale = px / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
}

for (const [theme, colors] of Object.entries(palette)) {
  const width = 450;
  const titleH = 52;
  const rowH = 42;
  const height = titleH + ids.length * rowH;
  let svg = `<rect width="${width}" height="${height}" fill="${colors.bg}"/>`;
  svg += `<text x="12" y="22" font-family="Segoe UI,sans-serif" font-size="14" fill="${colors.fg}">Selected CAD source · ${theme} · exact toolbar pixels</text>`;
  for (const [i, px] of [14, 16, 24].entries()) svg += `<text x="${194 + i * 74}" y="42" text-anchor="middle" font-family="Segoe UI,sans-serif" font-size="10" fill="${colors.muted}">${px}px</text>`;
  ids.forEach((id, i) => {
    const y = titleH + i * rowH;
    const entry = byId.get(id);
    const dSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${colors.fg}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${entry.paths.map((d) => `<path d="${d}"/>`).join('')}</svg>`;
    const bounds = new Resvg(dSvg).getBBox();
    if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 24 || bounds.y + bounds.height > 24) throw new Error(`${id} outside viewBox: ${JSON.stringify(bounds)}`);
    for (const px of [14, 16, 24]) {
      const rendered = new Resvg(dSvg, { fitTo: { mode: 'width', value: px } }).render();
      if (rendered.width !== px || rendered.height !== px || !rendered.pixels.some((alpha, n) => n % 4 === 3 && alpha > 0)) throw new Error(`${id} failed ${px}px render`);
    }
    svg += `<line x1="10" y1="${y + rowH - 1}" x2="440" y2="${y + rowH - 1}" stroke="${colors.rule}"/>`;
    svg += `<text x="12" y="${y + 25}" font-family="Segoe UI,sans-serif" font-size="10" fill="${colors.fg}">${id}</text>`;
    [14, 16, 24].forEach((px, j) => svg += draw(entry.paths, 194 + j * 74 - px / 2, y + (rowH - px) / 2, px, colors.fg));
  });
  writeFileSync(`${output}/${theme}.png`, new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${svg}</svg>`, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng());
}

console.log(`Rendered ${ids.length} selected source icons at 14, 16, and 24px in both themes.`);
