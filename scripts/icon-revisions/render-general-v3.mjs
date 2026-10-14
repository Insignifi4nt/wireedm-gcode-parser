import { writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
import { generalV3, brandV3 } from './general-v3.mjs';
const out='docs/design/icon-review/iteration-3-general';
mkdirSync(out,{recursive:true});
const font={loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'};
const glyph=(paths,x,y,size,color)=>`<g transform="translate(${x} ${y}) scale(${size/24})" fill="none" stroke="${color}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map(d=>`<path d="${d}"/>`).join('')}</g>`;
const entries=[...generalV3,...brandV3];
for(const [theme,bg,fg] of [['dark','#11171c','#cbd5dc'],['light','#f4f7f9','#263641']]) {
  let content=`<rect width="880" height="1080" fill="${bg}"/>`;
  entries.forEach((e,i)=>{
    const y=25+i*116,originalId=e.id.startsWith('brand-')?'wire-edm-mark':e.id.startsWith('hidden')?'hidden':e.id.startsWith('dirty')?'dirty':e.id.startsWith('file-import')?'file-import':'file-export';
    content+=`<text x="15" y="${y+12}" fill="${fg}" font-size="13" font-family="Segoe UI">${e.id}</text>`;
    for(const [paths,x,title] of [[iconSource.find(e=>e.id===originalId).paths,240,'current'],[e.paths,430,'candidate']]){
      content+=`<text x="${x}" y="${y+12}" fill="${fg}" font-size="11" font-family="Segoe UI">${title}: 14 / 16 / 24 / 48</text>`;
      [14,16,24,48].forEach((s,j)=>content+=glyph(paths,x+43*j,y+25,s,fg));
    }
    if(e.id.startsWith('brand-')){
      content+=`<text x="640" y="${y+12}" fill="${fg}" font-size="11" font-family="Segoe UI">favicon 16 / 32; dark / light chrome</text>`;
      [16,32].forEach((s,j)=>{
        const x=645+j*47;content+=`<rect x="${x-4}" y="${y+21}" width="${s+8}" height="${s+8}" fill="#dfe4e9"/><rect x="${x}" y="${y+25}" width="${s}" height="${s}" rx="${s/8}" fill="#11171c"/>`+glyph(e.paths,x,y+25,s,'#67c8da');
        content+=`<rect x="${x-4}" y="${y+65}" width="${s+8}" height="${s+8}" fill="#20252a"/><rect x="${x}" y="${y+69}" width="${s}" height="${s}" rx="${s/8}" fill="#11171c"/>`+glyph(e.paths,x,y+69,s,'#67c8da');
      });
    }
  });
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="880" height="1080" viewBox="0 0 880 1080">${content}</svg>`;
  writeFileSync(`${out}/comparison-${theme}.svg`,svg);
  writeFileSync(`${out}/comparison-${theme}.png`,new Resvg(svg,{font}).render().asPng());
}
const categories=new Set(['navigation','actions','files','storage','status','brand']);
const extra=new Set(['visible','hidden','locked','link','plugin','navigation-mouse','navigation-trackpad']);
const owned=iconSource.filter(e=>categories.has(e.category)||extra.has(e.id));
writeFileSync(`${out}/coverage.json`,JSON.stringify({reviewedCount:owned.length,entries:owned.map(e=>({id:e.id,label:e.label,decision:['file-new','file-import','file-export','file-inspect','file-body','copy','folder-plus','busy'].includes(e.id)?'refine-iteration-2':['hidden','dirty','folder-storage','wire-edm-mark','navigation-trackpad'].includes(e.id)?'evaluate-candidate':'retain-after-review'}))},null,2)+'\n');
console.log(`Rendered ${entries.length} candidates; wrote ${owned.length}-ID review ledger.`);
