import { mkdirSync,writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
import { iconSource } from '../icon-source.mjs';
import variants from './trackpad-v4.mjs';
const out='docs/design/icon-review/trackpad-v4';mkdirSync(out,{recursive:true});
const ids=['navigation-trackpad','navigation-mouse','camera-pan','panel-left-open','machine-setup'];
const rows=[...ids.map(id=>iconSource.find(e=>e.id===id)),...variants];
for(const [theme,bg,fg] of [['dark','#11171c','#dbe5eb'],['light','#f4f7f9','#263641']]){
 let content=`<rect width="680" height="780" fill="${bg}"/>`;
 rows.forEach((e,i)=>{const y=25+i*92;content+=`<text x="15" y="${y}" font-size="13" fill="${fg}" font-family="Segoe UI">${e.id}</text>`;[14,16,24,48].forEach((s,j)=>content+=`<g transform="translate(${250+j*87} ${y+13}) scale(${s/24})" fill="none" stroke="${fg}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${e.paths.map(d=>`<path d="${d}"/>`).join('')}</g>`);});
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="780" viewBox="0 0 680 780">${content}</svg>`;
 writeFileSync(`${out}/${theme}.svg`,svg);writeFileSync(`${out}/${theme}.png`,new Resvg(svg,{font:{loadSystemFonts:false,fontFiles:['C:/Windows/Fonts/segoeui.ttf'],defaultFontFamily:'Segoe UI'}}).render().asPng());
}
console.log('Rendered 3 trackpad candidates against mouse, pan, panel and machine controls in both themes.');
