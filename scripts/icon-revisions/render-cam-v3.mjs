import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const { iconSource } = await import(pathToFileURL(resolve('scripts/icon-source.mjs')));
const { default: revisions } = await import(pathToFileURL(resolve('scripts/icon-revisions/cam-v3.mjs')));
const sizes = [14, 16, 24];
const cellWidth = 58;
const rowHeight = 54;
const labelWidth = 112;
const headerHeight = 58;
const width = labelWidth + sizes.length * 2 * cellWidth;
const height = headerHeight + revisions.length * rowHeight;
const sourceById = new Map(iconSource.map((entry) => [entry.id, entry]));
const actualPaths = new Map();

for (const { id } of revisions) {
  const svg = await readFile(resolve(`src/assets/icons/${id}.svg`), 'utf8');
  const paths = Array.from(svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g), (match) => match[1]);
  assert(paths.length > 0, `No current SVG path found for ${id}`);
  assert.deepEqual(paths, sourceById.get(id)?.paths, `${id} SVG must match editable source`);
  actualPaths.set(id, paths);
}

let content = '<rect width="100%" height="100%" fill="#111820" />';
content += '<text x="10" y="18" fill="#e8edf2" font-size="12" font-family="Arial">CAM v3 · current generated SVG vs function-specific proposal</text>';
for (let group = 0; group < 2; group += 1) {
  const groupX = labelWidth + group * sizes.length * cellWidth;
  const color = group ? '#75d4c9' : '#d8dfe7';
  content += `<text x="${groupX + sizes.length * cellWidth / 2}" y="35" text-anchor="middle" fill="${color}" font-size="9" font-family="Arial">${group ? 'V3 PROPOSAL' : 'CURRENT'}</text>`;
  sizes.forEach((size, index) => {
    content += `<text x="${groupX + index * cellWidth + cellWidth / 2}" y="50" text-anchor="middle" fill="#aab6c3" font-size="9" font-family="Arial">${size}px</text>`;
  });
}

revisions.forEach(({ id, paths: proposal }, row) => {
  const y = headerHeight + row * rowHeight;
  content += `<path d="M0 ${y}H${width}" stroke="#2c3843" />`;
  content += `<text x="8" y="${y + 30}" fill="#dbe4ed" font-size="9" font-family="Arial">${id}</text>`;
  [actualPaths.get(id), proposal].forEach((pathList, group) => {
    sizes.forEach((size, index) => {
      const scale = size / 24;
      const centerX = labelWidth + (group * sizes.length + index) * cellWidth + cellWidth / 2;
      const centerY = y + rowHeight / 2;
      const x = centerX - 12 * scale;
      const top = centerY - 12 * scale;
      const stroke = group ? '#75d4c9' : '#d8dfe7';
      content += `<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${pathList.map((d) => `<path d="${d}" />`).join('')}</g>`;
    });
  });
});

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
await writeFile(resolve('docs/design/icon-review/iteration-3-cam/current-v-proposal.png'), new Resvg(sheet).render().asPng());

const leadContour = 'M7 3h10l4 4v10l-4 4H7l-4-4V7Z';
const leadRows = [
  { label: 'LEAD IN · INTERIOR → EDGE', color: '#75d4c9', arrow: 'M7 12h11M15 9l3 3-3 3' },
  { label: 'LEAD OUT · EDGE → INTERIOR', color: '#75d4c9', arrow: 'M18 12H7M10 9l-3 3 3 3' },
  { label: 'OUTSIDE ENTRY (ALTERNATIVE)', color: '#b9c7d7', arrow: 'M23 12h-3M23 9l-3 3 3 3' },
  { label: 'OUTSIDE EXIT (ALTERNATIVE)', color: '#b9c7d7', arrow: 'M20 12h3M20 9l3 3-3 3' }
];
const pairWidth = 150 + sizes.length * 72;
const pairHeight = 54 + leadRows.length * 64;
let pair = '<rect width="100%" height="100%" fill="#111820" />';
pair += '<text x="10" y="18" fill="#e8edf2" font-size="12" font-family="Arial">Closed contour lead pair · arrow direction and clearance</text>';
sizes.forEach((size, index) => { pair += `<text x="${150 + index * 72 + 36}" y="42" text-anchor="middle" fill="#aab6c3" font-size="9" font-family="Arial">${size}px</text>`; });
leadRows.forEach(({ label, color, arrow }, row) => {
  const y = 54 + row * 64;
  pair += `<path d="M0 ${y}H${pairWidth}" stroke="#2c3843"/><text x="8" y="${y + 34}" fill="${color}" font-size="8" font-family="Arial">${label}</text>`;
  sizes.forEach((size, index) => {
    const scale = size / 24;
    const centerX = 150 + index * 72 + 36;
    const centerY = y + 32;
    const x = centerX - 12 * scale;
    const top = centerY - 12 * scale;
    pair += `<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="#d8dfe7" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${leadContour}" /></g>`;
    pair += `<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${arrow}" /></g>`;
  });
});
const pairSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pairWidth}" height="${pairHeight}" viewBox="0 0 ${pairWidth} ${pairHeight}">${pair}</svg>`;
await writeFile(resolve('docs/design/icon-review/iteration-3-cam/lead-pair.png'), new Resvg(pairSvg).render().asPng());
console.log(`Rendered ${revisions.length} current/proposal icons at ${sizes.join('/')} px and a 4-way lead comparison.`);
