import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from './icon-source.mjs';

const ids = ['lead-in','lead-out','offset','cam-editor','toolpath','send-cam','section-cam','section-view','wire','simulation','machine-setup','revolve','loft','sweep','pad-pocket','datum-plane','imported-body','select-face','select-edge','select-body','file-import','file-export','file-new','file-inspect','file-body','dirty','folder-plus','folder-storage','copy','hidden','busy','wire-edm-mark','navigation-trackpad','insert-points','locate'];
const source = new Map(iconSource.map(entry => [entry.id, entry]));
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function glyph(paths, size, x, y, color) {
  return `<g transform="translate(${x} ${y}) scale(${size / 24})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
}
const columns = 3, cellWidth = 360, cellHeight = 112;
const width = columns * cellWidth, height = 80 + Math.ceil(ids.length / columns) * cellHeight;
for (const [theme, background, foreground, accent] of [['dark','#11171c','#cbd5dc','#67c8da'],['light','#f4f7f9','#263641','#126477']]) {
  const label = (value, x, y, size=11, color=foreground) => `<text x="${x}" y="${y}" font-family="Segoe UI" font-size="${size}" fill="${color}">${escape(value)}</text>`;
  let markup = `<rect width="${width}" height="${height}" fill="${background}"/>` + label('Critical icon refinement: first checkpoint / integrated revision',16,28,18) + label('Actual sizes 12 / 14 / 16 / 24 px. Large 32 px specimen at right. All paths are original SVG geometry.',16,51);
  ids.forEach((id, index) => {
    const entry = source.get(id), x = 16 + index % columns * cellWidth, y = 83 + Math.floor(index / columns) * cellHeight;
    let previous = [];
    if (!['insert-points','locate'].includes(id)) {
      const xml = execFileSync('git', ['show', `ad03b43:src/assets/icons/${id}.svg`], {encoding:'utf8'});
      previous = [...xml.matchAll(/<path d="([^"]+)"/g)].map(match=>match[1]);
    }
    markup += label(id,x,y,12);
    markup += label(previous.length ? 'before' : 'new',x,y+24);
    markup += label('revised',x,y+58,11,accent);
    [12,14,16,24].forEach((size, i) => {
      if (previous.length) markup += glyph(previous,size,x+61+i*44,y+10,foreground);
      markup += glyph(entry.paths,size,x+61+i*44,y+44,accent);
    });
    markup += glyph(entry.paths,32,x+268,y+24,accent);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${markup}</svg>`;
  const output = `docs/design/icon-review/refinement-${theme}`;
  writeFileSync(`${output}.svg`,svg);
  writeFileSync(`${output}.png`,new Resvg(svg,{font:{loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'}}).render().asPng());
}
console.log(`Rendered ${ids.length} before/revised glyph comparisons from the original checkpoint and current source.`);
