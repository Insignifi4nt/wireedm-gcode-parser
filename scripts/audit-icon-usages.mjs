import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { iconSource } from './icon-source.mjs';

const root = process.cwd();
const srcRoot = path.join(root, 'src');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(srcRoot).filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).sort();
const aliasIds = new Map();
for (const entry of iconSource) for (const alias of entry.aliases ?? []) {
  const ids = aliasIds.get(alias) ?? [];
  ids.push(entry.id);
  aliasIds.set(alias, ids);
}
const catalogAliases = [...aliasIds.keys()].sort();
const occurrences = [];
const importRecords = [];
const filesWithImports = new Set();
const trim = value => value.replace(/\s+/g, ' ').trim();
const rel = file => path.relative(root, file).replaceAll('\\', '/');
function ancestors(node) { const out = []; for (let p = node.parent; p; p = p.parent) out.push(p); return out; }
function opening(node) { return ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null; }
function labelAttrs(open) {
  if (!open) return {};
  const out = {};
  for (const attr of open.attributes.properties) if (ts.isJsxAttribute(attr)) {
    const name = attr.name.getText();
    const init = attr.initializer;
    if (!['aria-label', 'title', 'aria-pressed', 'role', 'className'].includes(name)) continue;
    if (!init) out[name] = true;
    else if (ts.isStringLiteral(init)) out[name] = init.text;
    else if (ts.isJsxExpression(init) && init.expression) out[name] = trim(init.expression.getText());
  }
  return out;
}
function getContext(node, sf) {
  const chain = ancestors(node);
  const interactive = chain.map(opening).filter(Boolean).find(open => /^(button|Button|a|label|summary)$/.test(open.tagName.getText(sf)));
  const nearestVariable = chain.find(ts.isVariableDeclaration);
  const nearestProperty = chain.find(ts.isPropertyAssignment);
  const call = chain.find(ts.isCallExpression);
  const jsxTag = chain.map(opening).filter(Boolean).slice(0, 4).map(open => open.tagName.getText(sf));
  const stmt = chain.find(ts.isExpressionStatement) ?? chain.find(ts.isReturnStatement) ?? chain.find(ts.isVariableStatement);
  const anchor = interactive?.parent ?? nearestVariable ?? nearestProperty ?? call ?? stmt ?? node.parent;
  const snippet = trim(anchor.getText(sf)).slice(0, 900);
  const loc = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const line = sf.text.split(/\r?\n/)[loc.line] ?? '';
  return {
    file: rel(sf.fileName), line: loc.line + 1, column: loc.character + 1,
    localSymbol: node.text,
    usageForm: ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent) ? 'jsx-component' :
      ts.isPropertyAssignment(node.parent) ? 'object-property-value' :
      call && node.parent && ts.isCallExpression(node.parent) ? 'call-argument' :
      nearestVariable ? 'declaration-or-reference' : 'reference',
    componentChain: jsxTag,
    control: interactive ? { tag: interactive.tagName.getText(sf), ...labelAttrs(interactive) } : null,
    variable: nearestVariable?.name.getText(sf) ?? null,
    objectProperty: nearestProperty?.name.getText(sf) ?? null,
    call: call ? trim(call.expression.getText(sf)) : null,
    lineContext: trim(line), context: snippet,
  };
}
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const local = new Map();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || st.moduleSpecifier.text !== 'lucide-react') continue;
    filesWithImports.add(rel(file));
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const item of named.elements) {
      if (item.isTypeOnly || st.importClause?.isTypeOnly) continue;
      const imported = (item.propertyName ?? item.name).text;
      const localName = item.name.text;
      const ids = aliasIds.get(imported) ?? [];
      const record = { file: rel(file), line: sf.getLineAndCharacterOfPosition(item.getStart(sf)).line + 1, importedAlias: imported, localName, candidateCatalogIds: ids };
      local.set(localName, record);
      importRecords.push(record);
    }
  }
  function visit(node) {
    if (ts.isIdentifier(node) && local.has(node.text)) {
      const parents = ancestors(node);
      const inImport = parents.some(ts.isImportDeclaration);
      const inType = parents.some(ts.isTypeNode);
      const inJsxClosing = ts.isJsxClosingElement(node.parent);
      const isDeclaration = ts.isVariableDeclaration(node.parent) && node.parent.name === node;
      const isPropertyName = ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (!inImport && !inType && !inJsxClosing && !isDeclaration && !isPropertyName) {
        const source = local.get(node.text);
        occurrences.push({ ...getContext(node, sf), importedAlias: source.importedAlias, candidateCatalogIds: source.candidateCatalogIds });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
const contextId = use => {
  const alias = use.importedAlias;
  const text = `${use.file} ${use.control ? JSON.stringify(use.control) : ''} ${use.context} ${use.lineContext}`.toLowerCase();
  if (alias === 'Box') {
    if (use.file.includes('SimulationPanel')) return { intendedCatalogId: 'body', confidence: 'medium', semanticNote: 'Stock settings and dimensions. The same Box glyph represents CAD solid-body operations, the simulation workspace tab, and a loading illustration in other call sites.' };
    if (use.file.includes('SimulationViewport')) return { intendedCatalogId: 'simulation', confidence: 'low', semanticNote: 'Loading illustration for the 3D simulation workspace; same Box symbol is used for stock and CAD bodies elsewhere.' };
    if (use.file.includes('CadViewport')) return { intendedCatalogId: 'view', confidence: 'medium', semanticNote: 'Named view orientation selector; Box glyph serves as a view control here.' };
    if (use.file.includes('EditorPage')) return { intendedCatalogId: 'simulation', confidence: 'medium', semanticNote: 'Simulation workspace tab.' };
    if (use.file.includes('CadWorkbench')) return { intendedCatalogId: 'body', confidence: 'medium', semanticNote: 'Imported/extruded solid, Pad-Pocket, or shell feature icon.' };
    return { intendedCatalogId: null, confidence: 'uncertain', semanticNote: 'Box has multiple catalog candidates; review this call-site meaning.' };
  }
  if (alias === 'Pencil') return { intendedCatalogId: 'rename', confidence: 'high', semanticNote: 'Rename or edit action.' };
  if (alias === 'PencilRuler') return { intendedCatalogId: 'sketch', confidence: 'high', semanticNote: 'Sketch/CAD drawing action.' };
  if (alias === 'FileBox') return { intendedCatalogId: 'machine-setup', confidence: 'medium', semanticNote: 'Machine model settings control; the imported symbol is a box-file glyph, while the semantic action is machine setup.' };
  if (alias === 'Scan') return { intendedCatalogId: 'view', confidence: 'medium', semanticNote: 'Top view orientation control; context differs from the catalog’s bounds-inspection label.' };
  if (alias === 'ScanLine') return { intendedCatalogId: 'fit-view', confidence: 'medium', semanticNote: 'Fit machine and stock into the viewport; the call-site differs from the catalog’s section-view label.' };
  const candidates = use.candidateCatalogIds;
  return candidates.length === 1
    ? { intendedCatalogId: candidates[0], confidence: 'high', semanticNote: null }
    : { intendedCatalogId: null, confidence: 'uncertain', semanticNote: `Alias resolves to ${candidates.join(', ') || 'no catalog entry'}; inspect meaning.` };
};
const mapped = occurrences.map(use => ({ ...use, ...contextId(use) }));
const ids = [...new Set(iconSource.map(entry => entry.id))];
const usedIds = new Set(mapped.map(use => use.intendedCatalogId).filter(Boolean));
const catalogAliasesImported = new Set(importRecords.map(record => record.importedAlias));
const importedAliasesUsed = new Set(mapped.map(use => use.importedAlias));
const missingCatalogAliases = catalogAliases.filter(alias => !catalogAliasesImported.has(alias));
const importedUnused = importRecords.filter(record => !mapped.some(use => use.file === record.file && use.localSymbol === record.localName));
const byId = Object.fromEntries(iconSource.map(entry => [entry.id, { id: entry.id, label: entry.label, category: entry.category, aliases: entry.aliases ?? [], usages: [] }]));
for (const use of mapped) (byId[use.intendedCatalogId ?? '__uncertain__'] ??= { id: '__uncertain__', label: 'Uncertain mapping', category: 'review', aliases: [], usages: [] }).usages.push(use);
const ambiguousAliasUsages = mapped.filter(use => use.candidateCatalogIds.length !== 1 || use.confidence !== 'high');
const dynamicSlots = [];
for (const file of files) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const declarations = [];
  const functionScope = node => ancestors(node).find(p => ts.isFunctionLike(p)) ?? sf;
  function collectDeclarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isElementAccessExpression(node.initializer)) {
      const mapName = node.initializer.expression.getText(sf);
      const mapProperty = node.initializer.argumentExpression?.getText(sf) ?? null;
      declarations.push({ renderer: node.name.text, mapName, mapProperty, scope: functionScope(node), declarationLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, collectDeclarations);
  }
  collectDeclarations(sf);
  function collectSlots(node) {
    const open = opening(node);
    const declaration = open && ts.isIdentifier(open.tagName) ? declarations.find(item => item.renderer === open.tagName.text && item.scope === functionScope(node)) : null;
    if (open && declaration) {
      const relevant = mapped.filter(use => use.file === rel(file) && use.variable === declaration.mapName && use.objectProperty);
      const loc = sf.getLineAndCharacterOfPosition(open.tagName.getStart(sf));
      dynamicSlots.push({ file: rel(file), line: loc.line + 1, renderer: open.tagName.text, mapName: declaration.mapName,
        mapPropertyExpression: declaration.mapProperty, declarationLine: declaration.declarationLine,
        possibleCatalogMappings: relevant.map(use => ({ mapProperty: use.objectProperty, importedAlias: use.importedAlias, intendedCatalogId: use.intendedCatalogId, confidence: use.confidence })) });
    }
    ts.forEachChild(node, collectSlots);
  }
  collectSlots(sf);
}
const report = {
  generatedAt: new Date().toISOString(), catalogEntryCount: ids.length, catalogAliasCount: catalogAliases.length,
  scannedProductionTsFiles: files.length, filesWithLucideImports: filesWithImports.size,
  importCount: importRecords.length, referencedOccurrenceCount: mapped.length,
  distinctImportedAliases: importedAliasesUsed.size, distinctCatalogIdsCovered: usedIds.size,
  imports: importRecords, occurrences: mapped, dynamicSlots,
  catalog: Object.values(byId), ambiguousAliasUsages,
  missingCatalogAliases, importedUnused,
};
const outDir = path.join(root, 'docs/design');
if (!importRecords.length && existsSync(path.join(outDir, 'icon-usage-scout.json'))) throw new Error('The pre-migration Lucide baseline is preserved. Use audit-icon-current-integration.mjs for the migrated source.');
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(root, 'docs/design/icon-usage-scout.json'), JSON.stringify(report, null, 2) + '\n');
const lines = [
  '# Current Lucide icon usage scout', '',
  `Generated ${report.generatedAt}. This is a source-usage map for this checkout, based on TypeScript AST parsing. It records imports and individual references, including JSX elements, object-property values, dynamic icon declarations/references, and call arguments.`, '',
  '## Coverage', '',
  `- Catalog entries: ${ids.length}; catalog aliases: ${catalogAliases.length}.`,
  `- Production TypeScript files scanned: ${files.length}; files with Lucide imports: ${filesWithImports.size}.`,
  `- Lucide component imports: ${importRecords.length}; individual references: ${mapped.length}; aliases referenced: ${importedAliasesUsed.size}.`,
  `- Catalog IDs covered by references: ${usedIds.size}/${ids.length}; context-dependent or unresolved references: ${ambiguousAliasUsages.length}.`,
  `- Catalog aliases absent from imports: ${missingCatalogAliases.length}; imported but unused components: ${importedUnused.length}.`, '',
  '## Catalog IDs and individual usages', '',
];
for (const entry of iconSource) {
  lines.push(`### \`${entry.id}\` — ${entry.label} (${entry.category})`, '');
  lines.push(`Aliases: ${(entry.aliases ?? []).map(alias => `\`${alias}\``).join(', ') || 'none'}.`);
  const uses = mapped.filter(use => use.intendedCatalogId === entry.id);
  if (!uses.length) lines.push('No current production component references map to this ID.');
  for (const use of uses) {
    const semantic = use.semanticNote ? ` — ${use.confidence}: ${use.semanticNote}` : '';
    lines.push(`- [${use.file}:${use.line}] imported \`${use.importedAlias}\` as \`${use.localSymbol}\` (${use.usageForm})${use.control ? `; control ${JSON.stringify(use.control)}` : ''}${use.variable ? `; variable \`${use.variable}\`` : ''}${use.objectProperty ? `; property \`${use.objectProperty}\`` : ''}${semantic}`);
    lines.push(`  - Context: \`${use.context.replaceAll('`', '\\`')}\``);
  }
  lines.push('');
}
lines.push('## Dynamic icon slots', '');
if (!dynamicSlots.length) lines.push('No imported icon renderers were found through variable-backed dynamic slots.');
for (const slot of dynamicSlots) lines.push(`- [${slot.file}:${slot.line}] JSX renderer \`${slot.renderer}\` declared from \`${slot.mapName}[${slot.mapPropertyExpression}]\` (declaration line ${slot.declarationLine}); map entries: ${slot.possibleCatalogMappings.map(item => `\`${item.mapProperty} → ${item.intendedCatalogId ?? 'uncertain'}\``).join(', ') || 'no imported Lucide map values located'}.`);
lines.push('', '### Uncertain or context-sensitive mappings', '');
if (!ambiguousAliasUsages.length) lines.push('None.');
for (const use of ambiguousAliasUsages) lines.push(`- [${use.file}:${use.line}] \`${use.importedAlias}\` candidates ${use.candidateCatalogIds.map(id => `\`${id}\``).join(', ') || '(none)'}; proposed ${use.intendedCatalogId ? `\`${use.intendedCatalogId}\`` : 'unresolved'} (${use.confidence}). ${use.semanticNote ?? ''} Context: \`${use.context.replaceAll('`', '\\`')}\``);
lines.push('', '## Missing and unused aliases', '', `Catalog aliases not imported in this checkout (${missingCatalogAliases.length}): ${missingCatalogAliases.map(alias => `\`${alias}\``).join(', ') || 'none'}.`, '');
if (importedUnused.length) for (const item of importedUnused) lines.push(`- [${item.file}:${item.line}] imported \`${item.importedAlias}\` as \`${item.localName}\`, no production reference found.`);
else lines.push('No unused Lucide component imports.');
lines.push('', '## Notes', '', '- Unique alias mappings are proposed from the catalog’s explicit alias list; call-site context is retained for review.', '- The repeated `Box` symbol is context-dependent. Simulation stock bounds and CAD solid-body operations share the imported Lucide symbol, so each use is reported with its local meaning and lower confidence.', '- This scout covers imported Lucide components. It does not claim coverage of hand-authored SVG/CSS pictures, Unicode glyphs, native controls, or non-Lucide graphics.');
writeFileSync(path.join(root, 'docs/design/icon-usage-scout.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ catalogEntries: ids.length, catalogAliases: catalogAliases.length, scannedFiles: files.length, filesWithImports: filesWithImports.size, importCount: importRecords.length, references: mapped.length, aliasesReferenced: importedAliasesUsed.size, idsCovered: usedIds.size, ambiguousUsages: ambiguousAliasUsages.length, missingCatalogAliases: missingCatalogAliases.length, importedUnused: importedUnused.length, outputs: ['docs/design/icon-usage-scout.json','docs/design/icon-usage-scout.md'] }, null, 2));



