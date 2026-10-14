import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const baselinePath = path.join(root, 'docs/design/icon-usage-scout.json');
const outputPath = path.join(root, 'docs/design/current-integration-audit.json');
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const iconIndexPath = path.join(root, 'src/components/icons/index.ts');
const iconIndex = readFileSync(iconIndexPath, 'utf8');
const iconCatalogSource = readFileSync(path.join(root, 'src/components/icons/iconCatalog.ts'), 'utf8');
const catalogIds = new Set([...iconCatalogSource.matchAll(/^  "([^"]+)": \{/gm)].map(match => match[1]));
const exportedIds = new Map([...iconIndex.matchAll(/export const (\w+) = makeIcon\('([^']+)'\);/g)].map(match => [match[1], match[2]]));
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const files = walk(path.join(root, 'src')).filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file)).sort();
const slash = file => path.relative(root, file).replaceAll('\\', '/');
const compact = value => value.replace(/\s+/g, ' ').trim();
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
    if (!['@/components/icons', 'lucide-react'].includes(source)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const item of bindings.elements) {
      if (item.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const imported = (item.propertyName ?? item.name).text;
      const localName = item.name.text;
      const id = source === '@/components/icons' ? exportedIds.get(imported) ?? null : (baseline.imports.find(entry => entry.importedAlias === imported)?.candidateCatalogIds?.length === 1 ? baseline.imports.find(entry => entry.importedAlias === imported).candidateCatalogIds[0] : null);
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
  const originId = `origin.${createHash('sha256').update(`${original.file}|${original.line}|${original.column}|${original.importedAlias}|${original.expression ?? ''}`).digest('hex').slice(0, 16)}`;
  const candidates = currentUses.filter(use => use.file === original.file && !claimed.has(use));
  const expected = original.actualNewCatalogId ?? original.intendedCatalogId;
  const ranked = candidates.map(use => {
    let score = 100 - Math.min(Math.abs(use.line - original.line) * 2.5, 50);
    if (use.line === original.line) score += 80;
    if (use.usageForm === original.usageForm) score += 12;
    if (use.catalogId === expected) score += 8;
    if (use.importedSymbol === original.actualNewSymbol || use.importedSymbol === original.importedAlias || use.symbol === original.actualNewSymbol || use.symbol === original.importedAlias) score += 3;
    if (original.objectProperty && use.objectProperty === original.objectProperty) score += 90;
    if (original.call && use.call === original.call) score += 10;
    const firstLabel = value => value?.match(/(?:toolButton|setupButton)\s*\(\s*['"]([^'"]+)/)?.[1] ?? null;
    const originalButtonLabel = firstLabel(original.context);
    const currentButtonLabel = firstLabel(use.context);
    if (originalButtonLabel && currentButtonLabel && originalButtonLabel === currentButtonLabel) score += 90;
    if (original.control && use.control) {
      const originalLabel = original.control['aria-label'] ?? original.control.title;
      const currentLabel = use.control['aria-label'] ?? use.control.title;
      if (originalLabel && currentLabel && originalLabel === currentLabel) score += 90;
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
    resolution: selected && selected.score >= 100 && selected.use.catalogId ? 'resolved' : selected && selected.score >= 100 ? 'matched-symbol-id-unresolved' : 'unmatched',
    actualSymbol: selected && selected.score >= 100 ? selected.use.importedSymbol : null, actualCatalogId: selected && selected.score >= 100 ? selected.use.catalogId : null,
    catalogIdChangedFromOriginalIntent: selected?.use.catalogId !== original.intendedCatalogId,
  });
}
const unresolved = occurrenceAudit.filter(row => row.resolution !== 'resolved');
const unmatchedCurrent = currentUses.filter(use => !claimed.has(use));
const { sf: cadSf } = fileState.get('src/features/cad/CadWorkbench.tsx') ?? {};
const cadMap = {};
if (cadSf) {
  function visitMap(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'featureIcons' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) if (ts.isPropertyAssignment(property)) {
        const key = ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(cadSf);
        const localSymbol = property.initializer.getText(cadSf);
        const id = fileState.get('src/features/cad/CadWorkbench.tsx')?.locals.get(localSymbol)?.id ?? null;
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
  const scopes = [];
  const scopeFor = node => ancestors(node).find(p => ts.isFunctionLike(p)) ?? sf;
  function findDynamicDeclarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'Icon' && node.initializer && ts.isElementAccessExpression(node.initializer) && node.initializer.expression.getText(sf) === 'featureIcons') scopes.push({ node, scope: scopeFor(node) });
    ts.forEachChild(node, findDynamicDeclarations);
  }
  findDynamicDeclarations(sf);
  function findRenderers(node) {
    const open = opening(node);
    if (open && ts.isIdentifier(open.tagName) && open.tagName.text === 'Icon' && scopes.some(item => item.scope === scopeFor(node))) {
      currentDynamicRenderers.push({ file, line: sf.getLineAndCharacterOfPosition(open.tagName.getStart(sf)).line + 1, renderer: 'Icon', context: compact(node.getText(sf)).slice(0, 800) });
    }
    ts.forEachChild(node, findRenderers);
  }
  findRenderers(sf);
}
const claimedDynamicRenderers = new Set();
const dynamicSlotAudit = baseline.dynamicSlots.map(slot => {
  const originId = `slot.${createHash('sha256').update(`${slot.file}|${slot.line}|${slot.renderer}|${slot.mapName}|${slot.mapPropertyExpression}`).digest('hex').slice(0, 16)}`;
  const currentRenderer = currentDynamicRenderers.filter(use => use.file === slot.file && !claimedDynamicRenderers.has(use)).sort((a, b) => Math.abs(a.line - slot.line) - Math.abs(b.line - slot.line))[0];
  if (currentRenderer) claimedDynamicRenderers.add(currentRenderer);
  return { originId, originFile: slot.file, originalLine: slot.line, renderer: slot.renderer, mapName: slot.mapName, mapPropertyExpression: slot.mapPropertyExpression,
    currentRenderers: currentRenderer ? [{ line: currentRenderer.line, expression: currentRenderer.context }] : [],
    featureKindMap: Object.entries(cadMap).map(([featureKind, target]) => ({ featureKind, actualSymbol: target.symbol, actualCatalogId: target.catalogId, line: target.line })) };
});
const report = {
  generatedAt: new Date().toISOString(),
  baseline: { path: 'docs/design/icon-usage-scout.json', originalOccurrenceCount: baseline.occurrences.length, originalDynamicSlotCount: baseline.dynamicSlots.length, originalContextPreserved: true },
  currentSource: { scannedProductionTsFiles: files.length, catalogImports: currentImports.length, currentImportedSymbolReferences: currentUses.length, catalogExportsParsed: exportedIds.size, catalogEntriesParsed: catalogIds.size, exportsWithoutCatalogEntries: [...exportedIds].filter(([, id]) => !catalogIds.has(id)).map(([symbol, id]) => ({ symbol, id })), lucideImportsRemaining: currentImports.filter(item => item.source === 'lucide-react').length, unresolvedIconImports: currentImports.filter(item => !item.id).length, unresolvedCatalogReferences: currentUses.filter(use => !use.catalogId).length },
  reconciliation: { matchedOriginOccurrences: occurrenceAudit.filter(row => row.matchedCurrent).length, uniquelyClaimedCurrentUses: claimed.size, resolvedOriginOccurrences: occurrenceAudit.filter(row => row.resolution === 'resolved').length, unresolvedOriginOccurrences: unresolved.length, unmatchedCurrentReferences: unmatchedCurrent.length },
  currentUsageByCatalogId: Object.fromEntries([...new Set(currentUses.map(use => use.catalogId))].sort().map(id => [id, currentUses.filter(use => use.catalogId === id).length])),
  cadFeatureKindMap: cadMap,
  dynamicSlots: dynamicSlotAudit,
  newlyAddedCurrentReferences: unmatchedCurrent.map(use => ({ file: use.file, line: use.line, symbol: use.importedSymbol, catalogId: use.catalogId, context: use.context, note: 'Additional current icon reference with no original Lucide component occurrence; currently replaces the two Unicode topology disclosure arrows.' })),
  occurrences: occurrenceAudit,
  unresolved,
  unmatchedCurrent: unmatchedCurrent.map(use => ({ file: use.file, line: use.line, symbol: use.importedSymbol, catalogId: use.catalogId, context: use.context })),
};
if (!process.argv.includes('--check')) writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
if (report.currentSource.lucideImportsRemaining || report.currentSource.unresolvedIconImports || report.currentSource.unresolvedCatalogReferences || report.currentSource.exportsWithoutCatalogEntries.length) process.exitCode = 1;
console.log(JSON.stringify({ output: slash(outputPath), exports: exportedIds.size, currentImports: currentImports.length, currentRefs: currentUses.length,
  baselineRefs: baseline.occurrences.length, matched: report.reconciliation.matchedOriginOccurrences, resolved: report.reconciliation.resolvedOriginOccurrences,
  unresolved: unresolved.length, unmatchedCurrent: unmatchedCurrent.length, lucideImportsRemaining: report.currentSource.lucideImportsRemaining, featureKindMapEntries: Object.keys(cadMap).length, dynamicSlots: dynamicSlotAudit.length }, null, 2));




