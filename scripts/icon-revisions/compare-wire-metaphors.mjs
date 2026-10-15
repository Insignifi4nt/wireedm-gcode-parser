import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const original = 'M4 4h16M4 20h16M12 4v16M7 9h10v6H7Z';
const framedV3 = ['M3 4h18v16H3Z', 'M5 7h14M5 17h14M12 7v10'];
const directGuides = ['M6 3h12v4H6Z', 'M6 17h12v4H6Z', 'M12 7v10'];
const simulation = ['M3 4h18v16H3Z', 'M6 11h12v6H6Z', 'M12 8v10', 'M8 14h4'];
const machineSetup = ['M3 4h18v16H3Z', 'M7 16h10M8 15V8M8 15h8', 'M6 10l2-2 2 2M14 13l2 2-2 2'];
const variants = [
  { label: 'ORIGINAL WIRE', paths: [original] },
  { label: 'FRAMED V3', paths: framedV3 },
  { label: 'DIRECT GUIDES', paths: directGuides },
  { label: 'SIMULATION', paths: simulation },
  { label: 'MACHINE SETUP', paths: machineSetup }
];
const sizes = [14, 16, 24];
const cellWidth = 92;
const rowHeight = 50;
const labelWidth = 108;
const sectionHeight = 34 + sizes.length * rowHeight;
const width = labelWidth + variants.length * cellWidth;
const height = sectionHeight * 2;
let markup = '';
for (const [themeIndex, theme] of ['dark', 'light'].entries()) {
  const sectionY = themeIndex * sectionHeight;
  const background = theme === 'dark' ? '#111820' : '#f5f7fa';
  const iconStroke = theme === 'dark' ? '#d8dfe7' : '#283544';
  const labelColor = theme === 'dark' ? '#aab6c3' : '#526273';
  markup += `<rect x="0" y="${sectionY}" width="${width}" height="${sectionHeight}" fill="${background}"/>`;
  markup += `<text x="10" y="${sectionY + 17}" fill="${labelColor}" font-size="11" font-family="Arial">${theme.toUpperCase()} THEME · OUTPUT SIZES</text>`;
  variants.forEach((variant, column) => {
    const x = labelWidth + column * cellWidth;
    markup += `<text x="${x + cellWidth / 2}" y="${sectionY + 17}" text-anchor="middle" fill="${labelColor}" font-size="7.5" font-family="Arial">${variant.label}</text>`;
  });
  sizes.forEach((size, row) => {
    const y = sectionY + 34 + row * rowHeight;
    markup += `<text x="10" y="${y + 25}" fill="${labelColor}" font-size="9" font-family="Arial">${size}px</text>`;
    variants.forEach((variant, column) => {
      const x = labelWidth + column * cellWidth;
      const scale = size / 24;
      const top = y + (rowHeight - size) / 2;
      const left = x + (cellWidth - size) / 2;
      markup += `<g transform="translate(${left} ${top}) scale(${scale})" fill="none" stroke="${iconStroke}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${variant.paths.map((d) => `<path d="${d}"/>`).join('')}</g>`;
    });
  });
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markup}</svg>`;
const output = resolve('docs/design/icon-review/iteration-3-cam/wire-metaphors.png');
await mkdir(resolve('docs/design/icon-review/iteration-3-cam'), { recursive: true });
await writeFile(output, new Resvg(svg).render().asPng());
console.log(`Rendered original and direct-guide wire metaphors beside framed wire, simulation and setup at 14/16/24px in dark/light themes: ${output}`);
