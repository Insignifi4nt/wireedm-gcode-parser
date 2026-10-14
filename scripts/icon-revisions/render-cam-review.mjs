import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import assert from 'node:assert/strict';

const { iconSource } = await import(pathToFileURL(resolve('scripts/icon-source.mjs')));
const { default: revisions } = await import(pathToFileURL(resolve('scripts/icon-revisions/cam.mjs')));
const ids = [
  'cam-editor', 'geometry', 'offset', 'lead-in', 'lead-out', 'departure', 'start-point', 'pin', 'wire',
  'simulation', 'machine-setup', 'toolpath', 'scan', 'section-view', 'send-cam', 'section-cam',
  'circle-center', 'snap', 'origin', 'rotate-clockwise', 'rotate-counterclockwise',
  'flip-horizontal', 'flip-vertical', 'move'
];
const sizes = [12, 14, 16, 24];
const cellWidth = 56;
const rowHeight = 62;
const labelWidth = 120;
const headerHeight = 68;
const width = labelWidth + sizes.length * 2 * cellWidth;
const height = headerHeight + ids.length * rowHeight;
const sourceById = new Map(iconSource.map((entry) => [entry.id, entry]));
const revisionById = new Map(revisions.map((entry) => [entry.id, entry]));
const actualSvgPaths = new Map();
for (const id of ids) {
  const svg = await readFile(resolve(`src/assets/icons/${id}.svg`), 'utf8');
  const paths = Array.from(svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g), (match) => match[1]);
  assert(paths.length > 0, `No path data found in src/assets/icons/${id}.svg`);
  assert.deepEqual(paths, sourceById.get(id)?.paths, `${id} SVG must match the editable icon source`);
  actualSvgPaths.set(id, paths);
}

let content = '<rect width="100%" height="100%" fill="#111820" />';
content += '<text x="12" y="20" fill="#e8edf2" font-size="14" font-family="Arial">CAM + simulation icon review · actual raster target sizes</text>';

for (let group = 0; group < 2; group += 1) {
  const groupX = labelWidth + group * sizes.length * cellWidth;
  const color = group ? '#75d4c9' : '#d8dfe7';
  content += `<text x="${groupX + sizes.length * cellWidth / 2}" y="39" text-anchor="middle" fill="${color}" font-size="10" font-family="Arial">${group ? 'PROPOSAL' : 'CURRENT'}</text>`;
  sizes.forEach((size, index) => {
    const x = groupX + index * cellWidth + cellWidth / 2;
    content += `<text x="${x}" y="57" text-anchor="middle" fill="#aab6c3" font-size="10" font-family="Arial">${size}px</text>`;
  });
}

ids.forEach((id, row) => {
  const y = headerHeight + row * rowHeight;
  content += `<path d="M0 ${y}H${width}" stroke="#2c3843" />`;
  content += `<text x="10" y="${y + 34}" fill="#dbe4ed" font-size="10" font-family="Arial">${id}</text>`;

  [actualSvgPaths.get(id) ?? [], revisionById.get(id)?.paths ?? actualSvgPaths.get(id) ?? []]
    .forEach((pathList, group) => {
      sizes.forEach((size, index) => {
        const centerX = labelWidth + (group * sizes.length + index) * cellWidth + cellWidth / 2;
        const centerY = y + rowHeight / 2;
        const scale = size / 24;
        const x = centerX - 12 * scale;
        const top = centerY - 12 * scale;
        const stroke = group && revisionById.has(id) ? '#75d4c9' : '#d8dfe7';
        const renderedPaths = pathList.map((d) => `<path d="${d}" />`).join('');
        content += `<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${renderedPaths}</g>`;
      });
    });
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
const png = new Resvg(svg).render().asPng();
await writeFile(resolve('docs/design/icon-review/iteration-2-cam/contact-sheet.png'), png);
console.log(`Rendered ${ids.length} icons at ${sizes.join('/')} px, current and proposed, to ${width}×${height}.`);

const comparisonContour = 'M5 4h9l6 5v7l-6 4H6l-3-5V8Z';
const directions = [
  { label: 'CENTER-PIERCE ENTRY', color: '#75d4c9', path: 'M7 12h10M14 9l3 3-3 3' },
  { label: 'CENTER-PIERCE EXIT', color: '#75d4c9', path: 'M17 12H7M10 9l-3 3 3 3' },
  { label: 'OUTSIDE ENTRY', color: '#b9c7d7', path: 'M23 12h-3M23 9l-3 3 3 3' },
  { label: 'OUTSIDE EXIT', color: '#b9c7d7', path: 'M20 12h3M20 9l3 3-3 3' }
];
const detailCell = 64;
const detailWidth = 150 + sizes.length * detailCell;
const detailHeight = 60 + directions.length * 70;
let detail = '<rect width="100%" height="100%" fill="#111820" />';
detail += '<text x="12" y="22" fill="#e8edf2" font-size="13" font-family="Arial">Lead alternatives · shared closed contour; center pair retains clearance</text>';
sizes.forEach((size, index) => {
  detail += `<text x="${150 + index * detailCell + detailCell / 2}" y="47" text-anchor="middle" fill="#aab6c3" font-size="10" font-family="Arial">${size}px</text>`;
});
directions.forEach(({ label, color, path }, row) => {
  const y = 60 + row * 70;
  detail += `<path d="M0 ${y}H${detailWidth}" stroke="#2c3843"/><text x="10" y="${y + 37}" fill="${color}" font-size="9" font-family="Arial">${label}</text>`;
  sizes.forEach((size, index) => {
    const scale = size / 24;
    const centerX = 150 + index * detailCell + detailCell / 2;
    const centerY = y + 35;
    const x = centerX - 12 * scale;
    const top = centerY - 12 * scale;
    detail += `<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="#d8dfe7" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${comparisonContour}" /></g>`;
    detail += `<g transform="translate(${x} ${top}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="${path}" /></g>`;
  });
});
const detailSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${detailWidth}" height="${detailHeight}" viewBox="0 0 ${detailWidth} ${detailHeight}">${detail}</svg>`;
await writeFile(resolve('docs/design/icon-review/iteration-2-cam/lead-direction-alternatives.png'), new Resvg(detailSvg).render().asPng());
console.log('Rendered inside-entry/inside-exit and outside-entry/outside-exit direction alternatives.');
