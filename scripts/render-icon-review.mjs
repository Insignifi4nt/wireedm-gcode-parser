import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from './icon-source.mjs';

const output = 'docs/design/icon-review';
mkdirSync(output, { recursive: true });
const sizes = [12,14,15,16,20,24];
const reviewFont = existsSync('C:/Windows/Fonts/segoeui.ttf')
  ? { family:'Segoe UI', options:{loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'} }
  : existsSync('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
    ? { family:'DejaVu Sans', options:{loadSystemFonts:false,fontFiles:['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'],defaultFontFamily:'DejaVu Sans'} }
    : { family:'sans-serif', options:{loadSystemFonts:true,defaultFontFamily:'sans-serif'} };
const themes = {
  dark: { bg:'#11171c', fg:'#cbd5dc', hover:'#27323b', bright:'#eef5f8', accent:'#67c8da', selected:'#17333b' },
  light: { bg:'#f4f7f9', fg:'#263641', hover:'#e0e8ed', bright:'#0c2636', accent:'#126477', selected:'#d7eef3' }
};
const results = [];
for (const entry of iconSource) {
  const xml = readFileSync(`src/assets/icons/${entry.id}.svg`, 'utf8');
  const image = new Resvg(xml, {font:{loadSystemFonts:false}});
  const bounds = image.getBBox();
  if (!bounds || bounds.x < 0 || bounds.y < 0 || bounds.x+bounds.width > 24 || bounds.y+bounds.height > 24) throw new Error(`Clipped or empty icon: ${entry.id} ${JSON.stringify(bounds)}`);
  const hashes = [];
  for (const size of sizes) {
    const rendered = new Resvg(xml, {font:{loadSystemFonts:false},fitTo:{mode:'width',value:size}}).render();
    const pixels = rendered.pixels;
    let ink = 0;
    for (let i=3;i<pixels.length;i+=4) if (pixels[i]>0) ink++;
    if (!ink) throw new Error(`Empty ${size}px rendering: ${entry.id}`);
    hashes.push({size,inkPixels:ink});
  }
  results.push({id:entry.id,bounds,sizes:hashes});
}
function glyph(entry, size, x, y, color, opacity=1) {
  return `<g transform="translate(${x} ${y}) scale(${size/24})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${entry.paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
}
function text(label,x,y,size,color) { return `<text x="${x}" y="${y}" font-family="${reviewFont.family}" font-size="${size}" fill="${color}">${label}</text>`; }
function renderSheet(entries,themeName,file,columns=4) {
  const theme=themes[themeName], width=columns*320, height=80+Math.ceil(entries.length/columns)*130;
  let content=`<rect width="${width}" height="${height}" fill="${theme.bg}"/>`+text(`Wire EDM original SVG review • ${themeName}`,20,30,20,theme.fg)+text('Actual pixel sizes: 12 / 14 / 15 / 16 / 20 / 24. States: normal / hover / selected / disabled.',20,55,12,theme.fg);
  entries.forEach((entry,index)=>{
    const x=20+(index%columns)*320, y=80+Math.floor(index/columns)*130;
    content+=text(entry.id,x,y+12,13,theme.fg);
    sizes.forEach((size,i)=>{content+=glyph(entry,size,x+i*44,y+24,theme.fg)+text(String(size),x+i*44,y+63,10,theme.fg);});
    ['normal','hover','selected','disabled'].forEach((state,i)=>{
      const sx=x+i*68, sy=y+76;
      if(state==='hover'||state==='selected')content+=`<rect x="${sx-5}" y="${sy-5}" width="26" height="26" rx="3" fill="${state==='hover'?theme.hover:theme.selected}"/>`;
      content+=glyph(entry,16,sx,sy,state==='selected'?theme.accent:state==='hover'?theme.bright:theme.fg,state==='disabled'?.35:1)+text(state,sx-5,sy+34,10,theme.fg);
    });
  });
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
  writeFileSync(`${output}/${file}.svg`,svg);
  writeFileSync(`${output}/${file}.png`,new Resvg(svg,{font:reviewFont.options}).render().asPng());
}
for(const theme of Object.keys(themes)) {
  renderSheet(iconSource,theme,`all-${theme}`);
  renderSheet(iconSource.filter(entry=>entry.category==='cad'||['body','select','slot','polyline','closed-path','camera-pan','camera-orbit'].includes(entry.id)),theme,`cad-${theme}`,3);
}
writeFileSync(`${output}/metrics.json`,JSON.stringify({renderer:'@resvg/resvg-js 2.6.2',icons:results},null,2)+'\n');
console.log(`Rendered ${iconSource.length} original icons at six sizes with dark/light state sheets. No empty or clipped assets.`);
