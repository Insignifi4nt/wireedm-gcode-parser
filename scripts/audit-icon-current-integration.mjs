import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';
import { iconSource } from './icon-source.mjs';
import * as iconComponents from '@wire-edm/icons-react';

const root = process.cwd();
const baselinePath = path.join(root, 'docs/design/inventory/checkpoints/6e2113f/icon-inventory.audit.json');
const outputPath = path.join(root, 'docs/design/current-integration-audit.json');
const published = JSON.parse(readFileSync(baselinePath, 'utf8'));
const integration = JSON.parse(readFileSync(path.join(root, 'docs/design/icon-integration-map.json'), 'utf8'));
const intendedByUse = new Map(integration.directUsages.map(row=>[row.usageId,row.replacements]));
const normalizeAttribute = value => value.startsWith('{') && value.endsWith('}') ? compact(value.slice(1,-1)) : value.startsWith('"') ? JSON.parse(value) : value;
const baseline = { imports:JSON.parse(readFileSync(path.join(root,'docs/design/icon-usage-scout.json'),'utf8')).imports,
  occurrences:published.occurrences.filter(row=>row.id!=='use.78943e173e76').map(row=>({
    ...row, importedAlias:row.alias, objectProperty:row.mapProperty,
    usageForm:row.kind==='jsx-icon'?'jsx-component':row.kind==='map-binding'?'object-property-value':row.callName?'call-argument':'reference',
    context:row.call || row.containerText || row.expression,
    control:Object.fromEntries(Object.entries(row.controlAttributes || {}).filter(([key])=>['aria-label','title'].includes(key)).map(([key,value])=>[key,normalizeAttribute(value)])),
    intendedCatalogId:intendedByUse.get(row.id)?.[0]?.catalogId,
    intendedCatalogIds:intendedByUse.get(row.id)?.map(replacement=>replacement.catalogId) || [],
    actualNewSymbol:intendedByUse.get(row.id)?.[0]?.component,
  })),
  dynamicSlots:published.dynamicSlots.map(row=>({...row, renderer:row.tag, mapName:row.variable, mapPropertyExpression:row.expression})),
};
// The former header storage badge was explicitly removed in main bfac856.
const catalogIds = new Set(iconSource.map(entry=>entry.id));
const exportedIds = new Map(iconSource.flatMap(entry=>[...entry.aliases,entry.id.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('')+'Icon'].filter(name=>name in iconComponents).map(name=>[name,entry.id])));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(path.join(root, 'src')).filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).sort();
const slash = file => path.relative(root, file).replaceAll('\\', '/');
function compact(value) { return value.replace(/\s+/g, ' ').trim(); }
function ancestors(node) { const values = []; for (let parent = node.parent; parent; parent = parent.parent) values.push(parent); return values; }
function opening(node) { return ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null; }
function attrs(open) {
  if (!open) return {};
  const values = {};
  for (const attr of open.attributes.properties) if (ts.isJsxAttribute(attr) && ['aria-label', 'title', 'className', 'role'].includes(attr.name.getText())) {
    const init = attr.initializer;
    values[attr.name.getText()] = !init ? true : ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) && init.expression ? compact(init.expression.getText()) : compact(init.getText());
  }
  return values;
}
function usageContext(node, sf) {
  const chain = ancestors(node);
  const interactive = chain.map(opening).filter(Boolean).find(open => /^(button|Button|a|label|summary)$/.test(open.tagName.getText(sf)));
  const call = chain.find(ts.isCallExpression);
  const property = chain.find(ts.isPropertyAssignment);
  const variable = chain.find(ts.isVariableDeclaration);
  const openTags = chain.map(opening).filter(Boolean).slice(0, 5).map(open => open.tagName.getText(sf));
  const anchor = interactive?.parent ?? property ?? call ?? variable ?? chain.find(ts.isReturnStatement) ?? chain.find(ts.isExpressionStatement) ?? node.parent;
  const position = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const statementLine = sf.text.split(/\r?\n/)[position.line] ?? '';
  return {
    file: slash(sf.fileName), line: position.line + 1, column: position.character + 1,
    symbol: node.text,
    usageForm: ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent) ? 'jsx-component' : ts.isPropertyAssignment(node.parent) ? 'object-property-value' : call && node.parent === call ? 'call-argument' : variable ? 'declaration-or-reference' : 'reference',
    control: interactive ? { tag: interactive.tagName.getText(sf), ...attrs(interactive) } : null,
    objectProperty: property?.name.getText(sf) ?? null,
    variable: variable?.name.getText(sf) ?? null,
    call: call ? compact(call.expression.getText(sf)) : null,
    componentChain: openTags,
    lineContext: compact(statementLine), context: compact(anchor.getText(sf)).slice(0, 1400),
  };
}
const currentUses = [];
const currentImports = [];
const fileState = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const locals = new Map();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const source = statement.moduleSpecifier.text;
    if (!['@wire-edm/icons-react', '@/components/icons', 'lucide-react'].includes(source)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if (item.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const imported = (item.propertyName ?? item.name).text;
      const localName = item.name.text;
      const id = source !== 'lucide-react' ? exportedIds.get(imported) ?? null : (baseline.imports.find(entry => entry.importedAlias === imported)?.candidateCatalogIds?.length === 1 ? baseline.imports.find(entry => entry.importedAlias === imported).candidateCatalogIds[0] : null);
      locals.set(localName, { source, imported, localName, id });
      currentImports.push({ file: slash(file), source, imported, localName, id });
    }
  }
  fileState.set(slash(file), { sf, locals });
  function visit(node) {
    if (ts.isIdentifier(node) && locals.has(node.text)) {
      const parents = ancestors(node);
      const isImport = parents.some(ts.isImportDeclaration);
      const isType = parents.some(ts.isTypeNode);
      const closing = ts.isJsxClosingElement(node.parent);
      const declaration = ts.isVariableDeclaration(node.parent) && node.parent.name === node;
      const propertyName = ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (!isImport && !isType && !closing && !declaration && !propertyName) {
        const imported = locals.get(node.text);
        currentUses.push({ ...usageContext(node, sf), source: imported.source, importedSymbol: imported.imported, catalogId: imported.id });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
function similarity(a, b) {
  const scrub = value => new Set((value ?? '').toLowerCase().replace(/\b(?:icon|bodyicon|box|square|circle|arrow\w*|file\w*|camera\w*|mouse\w*|curveicon|sketchicon|datumplaneicon|padicon|pocketicon|patternicon|viewicon|simulationicon|machinesetupicon)\b/g, ' ').match(/[a-z0-9][a-z0-9'-]*/g) ?? []);
  const left = scrub(a), right = scrub(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0; for (const token of left) if (right.has(token)) overlap++;
  return overlap / Math.max(left.size, right.size);
}
const claimed = new Set();
const occurrenceAudit = [];
for (const original of baseline.occurrences) {
  const originId = original.id;
  const candidates = currentUses.filter(use => use.file === original.file && !claimed.has(use));
  const expected = original.actualNewCatalogId ?? original.intendedCatalogId;
  const ranked = candidates.map(use => {
    let score = 100 - Math.min(Math.abs(use.line - original.line) * 2.5, 50);
    if (use.line === original.line) score += 80;
    if (use.usageForm === original.usageForm) score += 12;
    if (use.catalogId === expected) score += 80;
    if (use.importedSymbol === original.actualNewSymbol || use.importedSymbol === original.importedAlias || use.symbol === original.actualNewSymbol || use.symbol === original.importedAlias) score += 120;
    if (original.objectProperty && use.objectProperty === original.objectProperty) score += 90;
    if (original.call && use.call === original.call) score += 10;
    const firstLabel = value => value?.match(/(?:toolButton|setupButton)\s*\(\s*['"]([^'"]+)/)?.[1] ?? null;
    const originalButtonLabel = firstLabel(original.context);
    const currentButtonLabel = firstLabel(use.context);
    if (originalButtonLabel && currentButtonLabel && originalButtonLabel === currentButtonLabel) score += 90;
    if (original.control && use.control) {
      const originalLabel = original.control['aria-label'] ?? original.control.title;
      const currentLabel = use.control['aria-label'] ?? use.control.title;
      if (originalLabel && currentLabel && originalLabel === currentLabel) score += 400;
    }
    score += similarity(original.context, use.context) * 100;
    return { use, score };
  }).sort((a, b) => b.score - a.score || Math.abs(a.use.line - original.line) - Math.abs(b.use.line - original.line));
  const selected = ranked[0];
  if (selected && selected.score >= 100) claimed.add(selected.use);
  occurrenceAudit.push({
    originId, originFile: original.file, originalLine: original.line, originalColumn: original.column, originalSymbol: original.importedAlias,
    intendedCatalogId: original.intendedCatalogId, scoutActualSymbol: original.actualNewSymbol ?? original.importedAlias,
    matchedCurrent: selected && selected.score >= 100 ? { file: selected.use.file, line: selected.use.line, column: selected.use.column, symbol: selected.use.importedSymbol, exportedSymbol: selected.use.symbol, catalogId: selected.use.catalogId, confidenceScore: Number(selected.score.toFixed(2)), context: selected.use.context } : null,
    resolution: selected && selected.score >= 100 && original.intendedCatalogIds.includes(selected.use.catalogId) ? 'resolved' : selected && selected.score >= 100 && selected.use.catalogId ? 'semantic-mismatch' : selected && selected.score >= 100 ? 'matched-symbol-id-unresolved' : 'unmatched',
    actualSymbol: selected && selected.score >= 100 ? selected.use.importedSymbol : null, actualCatalogId: selected && selected.score >= 100 ? selected.use.catalogId : null,
    catalogIdChangedFromOriginalIntent: selected?.use.catalogId !== original.intendedCatalogId,
  });
}
const unresolved = occurrenceAudit.filter(row => row.resolution !== 'resolved');
const unmatchedCurrent = currentUses.filter(use => !claimed.has(use));
const cadMapFile = 'src/features/cad/CadFeatureTree.tsx';
const { sf: cadSf } = fileState.get(cadMapFile) ?? {};
const cadMap = {};
if (cadSf) {
  function visitMap(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'icons' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property)) {
        const key = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(cadSf);
        const localSymbol = property.initializer.getText(cadSf);
        const id = fileState.get(cadMapFile)?.locals.get(localSymbol)?.id ?? null;
        cadMap[key] = { symbol: localSymbol, catalogId: id, line: cadSf.getLineAndCharacterOfPosition(property.initializer.getStart(cadSf)).line + 1 };
      }
    }
    ts.forEachChild(node, visitMap);
  }
  visitMap(cadSf);
}
const currentDynamicRenderers = [];
for (const [file, state] of fileState) {
  const sf = state.sf;
  const expectedSlots = baseline.dynamicSlots.filter(slot=>slot.file===file);
  function findRenderers(node) {
    const open = opening(node);
    if (open && ts.isIdentifier(open.tagName) && expectedSlots.some(slot=>slot.renderer===open.tagName.text)) {
      currentDynamicRenderers.push({ file, line: sf.getLineAndCharacterOfPosition(open.tagName.getStart(sf)).line + 1, renderer:open.tagName.text, context:compact(node.getText(sf)).slice(0,800) });
    } else if (ts.isJsxExpression(node) && node.expression) {
      const normalize = expression=>compact(expression).replace(/<[A-Z][A-Za-z0-9]*/g,'<ICON');
      const slot = expectedSlots.find(slot=>normalize(slot.expression)===normalize(`{${node.expression.getText(sf)}}`));
      if (slot) currentDynamicRenderers.push({file, line:sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1,renderer:slot.renderer,context:compact(node.getText(sf))});
    }
    ts.forEachChild(node, findRenderers);
  }
  findRenderers(sf);
}
const claimedDynamicRenderers = new Set();
const dynamicSlotAudit = baseline.dynamicSlots.map(slot => {
  const originId = `slot.${createHash('sha256').update(`${slot.file}|${slot.line}|${slot.renderer}|${slot.mapName}|${slot.mapPropertyExpression}`).digest('hex').slice(0, 16)}`;
  const currentRenderer = currentDynamicRenderers.filter(use => use.file === slot.file && use.renderer === slot.renderer && !claimedDynamicRenderers.has(use)).sort((a, b) => Math.abs(a.line - slot.line) - Math.abs(b.line - slot.line))[0];
  if (currentRenderer) claimedDynamicRenderers.add(currentRenderer);
  return { originId, originFile: slot.file, originalLine: slot.line, renderer: slot.renderer, mapName: slot.mapName, mapPropertyExpression: slot.mapPropertyExpression,
    currentRenderers: currentRenderer ? [{ line: currentRenderer.line, expression: currentRenderer.context }] : [],
    featureKindMap: Object.entries(cadMap).map(([featureKind, target]) => ({ featureKind, actualSymbol: target.symbol, actualCatalogId: target.catalogId, line: target.line })) };
});
const report = {
  generatedAt: new Date().toISOString(),
  baseline: { path:slash(baselinePath), publishedCheckpoint:integration.publishedCadCheckpoint, originalOccurrenceCount: baseline.occurrences.length, originalDynamicSlotCount: baseline.dynamicSlots.length, originalContextPreserved:true },
  currentSource: { scannedProductionTsFiles: files.length, catalogImports: currentImports.length, currentImportedSymbolReferences: currentUses.length, catalogExportsParsed: exportedIds.size, catalogEntriesParsed: catalogIds.size, exportsWithoutCatalogEntries: [...exportedIds].filter(([, id]) => !catalogIds.has(id)).map(([symbol, id]) => ({ symbol, id })), lucideImportsRemaining: currentImports.filter(item => item.source === 'lucide-react').length, unresolvedIconImports: currentImports.filter(item => !item.id).length, unresolvedCatalogReferences: currentUses.filter(use => !use.catalogId).length },
  reconciliation: { matchedOriginOccurrences: occurrenceAudit.filter(row => row.matchedCurrent).length, uniquelyClaimedCurrentUses: claimed.size, resolvedOriginOccurrences: occurrenceAudit.filter(row => row.resolution === 'resolved').length, unresolvedOriginOccurrences: unresolved.length, unmatchedCurrentReferences: unmatchedCurrent.length },
  currentUsageByCatalogId: Object.fromEntries([...new Set(currentUses.map(use => use.catalogId))].sort().map(id => [id, currentUses.filter(use => use.catalogId === id).length])),
  cadFeatureKindMap: cadMap,
  dynamicSlots: dynamicSlotAudit,
  retiredSourceReferences: [{id:'use.78943e173e76',reason:'The shared header storage badge was removed by the user in main bfac856; storage remains in settings.'}],
  newlyAddedCurrentReferences: unmatchedCurrent.map(use => ({ file: use.file, line: use.line, symbol: use.importedSymbol, catalogId: use.catalogId, context: use.context, note: 'Current package reference added after the frozen checkpoint or replacing a recorded text glyph.' })),
  occurrences: occurrenceAudit,
  unresolved,
  unmatchedCurrent: unmatchedCurrent.map(use => ({ file: use.file, line: use.line, symbol: use.importedSymbol, catalogId: use.catalogId, context: use.context })),
};
if (!process.argv.includes('--check')) writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
if (unresolved.length || dynamicSlotAudit.some(slot=>!slot.currentRenderers.length) || Object.keys(cadMap).length!==17 || report.currentSource.lucideImportsRemaining || report.currentSource.unresolvedIconImports || report.currentSource.unresolvedCatalogReferences || report.currentSource.exportsWithoutCatalogEntries.length) process.exitCode = 1;
console.log(JSON.stringify({ output: slash(outputPath), exports: exportedIds.size, currentImports: currentImports.length, currentRefs: currentUses.length,
  baselineRefs: baseline.occurrences.length, matched: report.reconciliation.matchedOriginOccurrences, resolved: report.reconciliation.resolvedOriginOccurrences,
  unresolved: unresolved.length, unmatchedCurrent: unmatchedCurrent.length, lucideImportsRemaining: report.currentSource.lucideImportsRemaining, featureKindMapEntries: Object.keys(cadMap).length, dynamicSlots: dynamicSlotAudit.length }, null, 2));
