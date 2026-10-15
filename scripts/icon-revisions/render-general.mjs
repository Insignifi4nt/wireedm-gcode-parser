import { writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
import revisions from './general.mjs';
const out='docs/design/icon-review/iteration-2-general';
mkdirSync(out,{recursive:true});
const font={loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'};
const categories=new Set(['navigation','actions','files','storage','status','brand']);
const extras=new Set(['visible','hidden','locked','link','plugin','navigation-mouse','navigation-trackpad']);
const owned=iconSource.filter(e=>categories.has(e.category)||extras.has(e.id));
const glyph=(paths,x,y,size,color,opacity=1)=>`<g transform="translate(${x} ${y}) scale(${size/24})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}">${paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
const label=(s,x,y,color)=>`<text x="${x}" y="${y}" fill="${color}" font-size="12" font-family="Segoe UI">${s}</text>`;
for(const [theme,bg,fg,accent] of [['dark','#11171c','#cbd5dc','#67c8da'],['light','#f4f7f9','#263641','#126477']]) {
  for(const [name,entries,compare] of [['baseline-1',owned.slice(0,19),false],['baseline-2',owned.slice(19,38),false],['baseline-3',owned.slice(38),false],['comparison',revisions,true]]) {
    const height=40+entries.length*76,width=680;
    let content=`<rect width="${width}" height="${height}" fill="${bg}"/>`+label(`${theme}: actual 14 / 16 / 24 px; enlarged 48 px`,15,22,fg);
    entries.forEach((entry,i)=>{
      const y=40+i*76,old=iconSource.find(e=>e.id===entry.id);
      content+=label(entry.id,15,y+19,fg);
      const variants=compare?[[old.paths,185,'before'],[entry.paths,425,'after']]:[[old.paths,185,'current']];
      variants.forEach(([paths,x,text])=>{
        content+=label(text,x,y+15,fg);
        [14,16,24,48].forEach((size,j)=>content+=glyph(paths,x+j*49,y+23,size,fg));
        content+=glyph(paths,x+199,y+23,16,accent)+glyph(paths,x+199,y+48,16,fg,.35);
      });
    });
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
    writeFileSync(`${out}/${name}-${theme}.svg`,svg);
    writeFileSync(`${out}/${name}-${theme}.png`,new Resvg(svg,{font}).render().asPng());
  }
}
for(const entry of revisions){
  const xml=`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${entry.paths.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
  const b=new Resvg(xml,{font}).getBBox();
  if(!b||b.x<0||b.y<0||b.x+b.width>24||b.y+b.height>24)throw new Error(`Bounds: ${entry.id}`);
}
console.log(`Rendered ${owned.length} baseline glyphs and ${revisions.length} proposals in two themes.`);
