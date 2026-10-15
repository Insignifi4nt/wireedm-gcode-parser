import { mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
const ids=['file-new','file-import','file-export','file-inspect','file-body','copy','folder-plus','folder-storage','busy','visible','hidden','dirty','wire-edm-mark','play','pause','step-back','step-forward','insert-points','locate','start-point','cam-editor','offset','toolpath','lead-in','lead-out','departure','send-cam','section-cam','wire','simulation','machine-setup','section-view'];
const out='docs/design/icon-review/production-general-cam';mkdirSync(out,{recursive:true});
writeFileSync(`${out}/coverage.json`,JSON.stringify({reviewedCount:ids.length,sizes:[12,14,16,24],themes:['dark','light'],ids},null,2)+'\n');
for(const [theme,bg,fg] of [['dark','#11171c','#cbd5dc'],['light','#f4f7f9','#263641']]){
 let content=`<rect width="820" height="1460" fill="${bg}"/>`;
 ids.forEach((id,i)=>{
  const entry=iconSource.find(e=>e.id===id),xml=readFileSync(`src/assets/icons/${id}.svg`,'utf8');
  const paths=[...xml.matchAll(/<path d="([^"]+)"/g)].map(m=>m[1]);if(JSON.stringify(paths)!==JSON.stringify(entry.paths))throw new Error(`Source parity ${id}`);
  const x=15+(i%2)*410,y=25+Math.floor(i/2)*89;
  content+=`<text x="${x}" y="${y}" fill="${fg}" font-family="Segoe UI" font-size="13">${id}</text>`;
  [12,14,16,24,48].forEach((s,j)=>{content+=`<g transform="translate(${x+j*56} ${y+12}) scale(${s/24})" fill="none" stroke="${fg}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.map(d=>`<path d="${d}"/>`).join('')}</g><text x="${x+j*56}" y="${y+72}" fill="${fg}" font-size="10" font-family="Segoe UI">${s}</text>`;});
 });
 const xml=`<svg xmlns="http://www.w3.org/2000/svg" width="820" height="1460" viewBox="0 0 820 1460">${content}</svg>`;
 writeFileSync(`${out}/${theme}.svg`,xml);writeFileSync(`${out}/${theme}.png`,new Resvg(xml,{font:{loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'}}).render().asPng());
}
console.log(`Inspected source parity and rendered ${ids.length} production glyphs in both themes.`);
