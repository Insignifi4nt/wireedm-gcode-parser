import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { iconSource } from './icon-source.mjs';

const crosswalk = JSON.parse(readFileSync('docs/design/final-inventory-crosswalk.json', 'utf8'));
const provenance = JSON.parse(readFileSync('docs/design/inventory/checkpoints/6e2113f/provenance.json', 'utf8'));
const exports = readFileSync('src/components/icons/index.ts', 'utf8');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const component = id => id.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('')+'Icon';
const byId = new Map(iconSource.map(entry=>[entry.id, entry]));
if (!crosswalk.summary.completenessChecks.complete || crosswalk.summary.actualGapRows) throw new Error('An incomplete inventory cannot become an integration map.');
if (crosswalk.externalInventory.auditSha256 !== provenance.files.find(file=>file.name==='icon-inventory.audit.json')?.sha256) throw new Error('Crosswalk does not describe the stamped published checkpoint.');
function replacements(ids) {
  return ids.map(id => {
    if (!byId.has(id) || !exports.includes(`export const ${component(id)} = makeIcon('${id}');`)) throw new Error(`Missing generated semantic component for ${id}`);
    return { catalogId:id, component:component(id), asset:`src/assets/icons/${id}.svg` };
  });
}
const direct = crosswalk.channels.occurrences.map(row=>({
  usageId:row.sourceId, file:row.file, snapshotLine:row.line, snapshotColumn:row.column,
  snapshotSourceHash:crosswalk.externalInventory.sourceHashes[row.file],
  sourceSymbol:row.sourceAlias, canonicalDrawing:row.sourceCanonical,
  expression:row.expression, visibleLabel:row.source.visibleText || null,
  mapProperty:row.source.mapProperty || null, callName:row.source.callName || null,
  callArguments:row.source.callArguments || null,
  replacements:replacements(row.catalogIds), disposition:row.disposition, reason:row.reason,
}));
const dynamicSlots = crosswalk.channels.dynamicSlots.map(row=>({
  usageId:row.sourceId, file:row.file, snapshotLine:row.line, snapshotColumn:row.column,
  snapshotSourceHash:crosswalk.externalInventory.sourceHashes[row.file],
  slotKind:row.source.kind, component:row.component, expression:row.expression,
  callName:row.source.callName || null, context:row.context,
  replacements:replacements(row.catalogIds), disposition:row.disposition, reason:row.reason,
}));
const variants = crosswalk.expandedVariants.map(row=>({ usageId:row.sourceId, parentUsageId:row.parentSourceId,
  file:row.file, expression:row.expression, context:row.context, replacements:replacements(row.catalogIds), reason:row.reason }));
const sourceRows = new Map(Object.values(crosswalk.channels).flat().map(row=>[row.sourceId,row]));
const rendererParents = [...new Set(variants.map(row=>row.parentUsageId))].map(usageId=>{
  const row = sourceRows.get(usageId);
  if (!row) throw new Error(`Missing expanded-variant parent contract: ${usageId}`);
  const children = variants.filter(variant=>variant.parentUsageId===usageId);
  return { usageId, sourceChannel:row.channel, file:row.file, snapshotLine:row.line,
    snapshotSourceHash:crosswalk.externalInventory.sourceHashes[row.file], expression:row.expression,
    context:row.context, originalDisposition:row.disposition, reason:row.reason,
    ownReplacements:replacements(row.catalogIds), expandedVariantIds:children.map(child=>child.usageId),
    availableVariantReplacements:replacements([...new Set(children.flatMap(child=>child.replacements.map(replacement=>replacement.catalogId)))]),
    rule:'Preserve the shared control/renderer and its guards. Apply glyph changes through the specific child variant or supplied icon parameter; this metadata is not an additional action occurrence.' };
});
const textControls = crosswalk.channels.glyphCandidates.filter(row=>row.catalogIds.length).map(row=>({
  usageId:row.sourceId, file:row.file, snapshotLine:row.line, expression:row.expression,
  replacements:replacements(row.catalogIds), reason:row.reason,
}));
const assets = iconSource.map(entry=>({ id:entry.id, label:entry.label, category:entry.category,
  component:component(entry.id), aliases:entry.aliases, file:`src/assets/icons/${entry.id}.svg`,
  sha256:sha256(readFileSync(`src/assets/icons/${entry.id}.svg`)), paths:entry.paths }));
const output = { schemaVersion:1, publishedCadCheckpoint:provenance.publishedCheckpoint,
  externalSnapshot:{ generatedAt:crosswalk.externalInventory.generatedAt, revision:crosswalk.externalInventory.revision,
    auditSha256:crosswalk.externalInventory.auditSha256, sourceHashDigest:crosswalk.externalInventory.sourceHashDigest },
  catalog:{ count:assets.length, source:'scripts/icon-source.mjs', componentModule:'@/components/icons',
    viewBox:'0 0 24 24', strokeWidth:1.75, color:'currentColor', assets },
  directUsages:direct, dynamicSlots, rendererParents, expandedVariants:variants, textControls,
  applicationRules:[
    'Use the stable usage ID, owning control and expression to relocate each call. Snapshot line numbers are evidence, not edit offsets.',
    'Resolve overloaded library names per occurrence. Import bindings alone cannot select the correct feature or command icon.',
    'Preserve original geometry renderers, controller checks, labels, handlers, disabled states, refs and accessibility.',
    'Dynamic-slot rows describe render sites and their allowed semantic replacements, not extra direct occurrences. For dispatchers such as the CAD history map or toolButton, update the matching concrete direct usages and keep the renderer dynamic.',
    'Lead tree rows select LeadInIcon or LeadOutIcon from travelRole. The source Flag binding is a dynamic pair, not a global flag replacement.',
    'Keep WireEdmMarkIcon in the app heading and the generated favicon. FolderStorageIcon identifies folder-specific persistence controls; BrowserCacheIcon identifies cache storage and the cache-first Storage category.',
    'Apply only icon implementation/integration changes onto the latest reviewed CAD base. CAD functionality and version 0.0.697 remain owned by its existing PR.',
  ] };
const json = JSON.stringify(output,null,2)+'\n';
const groups = new Map();
for (const row of direct) groups.set(row.file,[...(groups.get(row.file)||[]),row]);
const variantCounts = new Map();
for (const row of variants) variantCounts.set(row.parentUsageId,(variantCounts.get(row.parentUsageId)||0)+1);
const md = `# Icon integration map\n\nPublished CAD checkpoint: \`${provenance.publishedCheckpoint}\`. Complete set: ${assets.length} original glyphs, ${direct.length} direct usages, ${dynamicSlots.length} dynamic slots, ${variants.length} expanded variants and ${textControls.length} text controls. This is a concrete mapping for integration; the CAD implementation has not been copied into this worktree.\n\nThe [JSON](icon-integration-map.json) includes semantic component exports, original path data, exact SVG SHA-256 digests, stable usage IDs, source-file hashes and owning control/call metadata. The [crosswalk](final-inventory-crosswalk.md) also accounts for excluded geometry, cursor, native and text channels.\n\n## Apply the set\n\n${output.applicationRules.map(rule=>`- ${rule}`).join('\n')}\n\nCarry \`src/assets/icons/\`, \`src/components/icons/\`, \`scripts/icon-source.mjs\`, the generation/check scripts, \`icon-catalog/index.html\`, the Vite catalog entry, and the favicon reference. Use the usage table for newer CAD files rather than restoring older feature implementations. Release compatibility remains in \`docs/releases/0.0.698.json\`.\n\n## Dynamic render sites\n\nThese are renderer slots, not additional occurrences. Match each parent ID to expanded variants and the concrete direct usages that supply its icon components.\n\n| Stable slot ID | File | Snapshot line | Slot expression | Available replacements | Expanded variants |\n| --- | --- | --- | --- | --- | ---: |\n${dynamicSlots.map(row=>`| \`${row.usageId}\` | ${row.file} | ${row.snapshotLine} | \`${row.expression.replaceAll('|','\\|')}\` | ${row.replacements.map(replacement=>replacement.catalogId).join(', ')} | ${variantCounts.get(row.usageId)||0} |`).join('\n')}\n\n## Direct usage mapping\n\n${[...groups].map(([file,rows])=>`### ${file}\n\n| Stable usage ID | Snapshot line | Original symbol | Semantic replacement |\n| --- | --- | --- | --- |\n${rows.map(row=>`| \`${row.usageId}\` | ${row.snapshotLine} | \`${row.sourceSymbol}\` | ${row.replacements.map(replacement=>`\`${replacement.component}\``).join(' / ')} |`).join('\n')}\n`).join('\n')}`;
const parentMd = `\n## Expanded-variant parent contracts\n\nAll ${rendererParents.length} referenced parents are present in the JSON. This includes shared controls that are not themselves standalone icon occurrences. Preserve those controls and their checks; use the child variant to choose the glyph.\n\n| Stable parent ID | Channel | File | Child variants |\n| --- | --- | --- | ---: |\n${rendererParents.map(row=>`| \`${row.usageId}\` | ${row.sourceChannel} | ${row.file} | ${row.expandedVariantIds.length} |`).join('\n')}\n`;
for (const [path, content] of [['docs/design/icon-integration-map.json',json],['docs/design/icon-integration-map.md',md+parentMd]]) {
  if (process.argv.includes('--check')) {
    if (readFileSync(path,'utf8') !== content) throw new Error(`Stale integration map: ${path}`);
  } else writeFileSync(path,content);
}
console.log(`Verified ${assets.length} final assets, ${direct.length} direct mappings, ${dynamicSlots.length} dynamic slots, ${variants.length} expanded variants, ${rendererParents.length} parent contracts and ${textControls.length} text controls against the published inventory.`);
