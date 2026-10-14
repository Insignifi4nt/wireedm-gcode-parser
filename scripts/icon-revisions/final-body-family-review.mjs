import { mkdirSync,writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
const out='docs/design/icon-review/final-body-family';mkdirSync(out,{recursive:true});
const previous={
 'file-body':['M5 21V3h9l5 5v3M14 3v5h5M5 21h5M11 15l5-2 5 2v5l-5 2-5-2ZM11 15l5 2 5-2M16 17v5'],
 'section-view':['M4 7l8-4 8 4v10l-8 4-8-4Z','M4 7l8 4 8-4M12 11v10','M6 9l4 2M6 12l4 2'],
 boolean:['M3 4h11v11h-11ZM10 9h11v11h-11ZM10 9h4v6h-4Z']
};
const ids=['body','select-body','imported-body','section-cam','section-view','file-body','boolean'];
const font={loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'};
const glyph=(paths,x,y,size,fg)=>`<g transform="translate(${x} ${y}) scale(${size/24})" fill="none" stroke="${fg}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
for(const [theme,bg,fg] of [['dark','#11171c','#dbe5eb'],['light','#f4f7f9','#263641']]){
 let content=`<rect width="850" height="780" fill="${bg}"/>`;
 ids.forEach((id,i)=>{
  const entry=iconSource.find(e=>e.id===id),y=25+i*108;
  content+=`<text x="15" y="${y}" fill="${fg}" font-size="13" font-family="Segoe UI">${id}</text>`;
  const rows=previous[id]?[[previous[id],205,'before'],[entry.paths,510,'after']]:[[entry.paths,205,'current family reference']];
  rows.forEach(([paths,x,title])=>{
   content+=`<text x="${x}" y="${y}" fill="${fg}" font-size="11" font-family="Segoe UI">${title}: 14 / 16 / 24 / 48</text>`;
   [14,16,24,48].forEach((s,j)=>content+=glyph(paths,x+j*64,y+17,s,fg));
  });
 });
 const xml=`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="780">${content}</svg>`;
 writeFileSync(`${out}/${theme}.svg`,xml);writeFileSync(`${out}/${theme}.png`,new Resvg(xml,{font}).render().asPng());
}
console.log('Rendered closed body-family references and three exact corrections in both themes.');
