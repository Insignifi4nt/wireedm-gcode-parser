import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { iconSource } from '../../../scripts/icon-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const header = '// Generated from scripts/icon-source.mjs. Do not edit.\n';
const expected = new Map();
const names = new Set();
const ids = new Set();
for (const entry of iconSource) {
  if (!/^[a-z][a-z0-9-]+$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Invalid or duplicate icon: ${entry.id}`);
  ids.add(entry.id);
  const semantic = `${entry.id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('')}Icon`;
  for (const name of [semantic, ...entry.aliases]) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || names.has(name)) throw new Error(`Invalid or duplicate export: ${name}`);
    names.add(name);
  }
  const aliases = entry.aliases.length ? `export { ${entry.aliases.map(name => `${semantic} as ${name}`).join(', ')} };\n` : '';
  expected.set(`src/icons/${entry.id}.tsx`, `${header}import { createIcon } from '../createIcon.js';\n\nexport const ${semantic} = /* @__PURE__ */ createIcon(${JSON.stringify(entry.id)}, ${JSON.stringify(entry.paths)});\n${aliases}`);
}
expected.set('src/index.ts', `${header}export type { WorkbenchDrawnIconComponent, WorkbenchIconComponent, WorkbenchIconProps } from './types.js';\nexport type { IconName, IconCategory } from './catalog.js';\n\n${iconSource.map(entry => {
  const semantic = `${entry.id.split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('')}Icon`;
  return `export { ${[semantic, ...entry.aliases].join(', ')} } from './icons/${entry.id}.js';`;
}).join('\n')}\n`);
const catalog = Object.fromEntries(iconSource.map(({ id, label, category, paths }) => [id, { label, category, paths }]));
expected.set('src/catalog.ts', `${header}export const iconCatalog = ${JSON.stringify(catalog, null, 2)} as const;\n\nexport type IconName = keyof typeof iconCatalog;\nexport type IconCategory = (typeof iconCatalog)[IconName]['category'];\n`);

let stale = false;
for (const [relative, text] of expected) {
  const target = resolve(root, relative);
  if (check) {
    let existing = '';
    try { existing = readFileSync(target, 'utf8'); } catch { /* Report missing generated output below. */ }
    if (existing !== text) { console.error(`Stale generated icon package source: ${relative}`); stale = true; }
  } else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); }
}
const iconDirectory = resolve(root, 'src/icons');
for (const file of readdirSync(iconDirectory)) {
  if (expected.has(`src/icons/${file}`)) continue;
  const target = resolve(iconDirectory, file);
  if (dirname(target) !== iconDirectory || !file.endsWith('.tsx') || !readFileSync(target, 'utf8').startsWith(header)) throw new Error(`Unexpected file in generated icons: ${file}`);
  if (check) { console.error(`Obsolete generated icon: ${file}`); stale = true; }
  else unlinkSync(target);
}
if (stale) process.exitCode = 1;
else console.log(`${check ? 'Verified' : 'Generated'} ${iconSource.length} independent React icons and ${names.size} named exports.`);
