import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { iconSource } from './icon-source.mjs';

// Source-only inventory. It never changes app files or requires a running app.
const root = process.cwd();
const slash = value => value.replaceAll('\\', '/');
const hash = value => createHash('sha256').update(value).digest('hex');
const walk = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const sourceFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'package-tools')), path.join(root, 'index.html')].sort();
const isFixture = file => /(?:\/__tests__\/|\.(?:test|spec)\.|\/test[A-Z]|\/test-)/.test(slash(path.relative(root, file)));
const production = sourceFiles.filter(file => !isFixture(file));
const codeFiles = production.filter(file => /\.[cm]?[jt]sx?$/.test(file) && !/\.d\.ts$/.test(file));
const program = ts.createProgram(codeFiles, { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, noResolve: true, allowJs: true });
const checker = program.getTypeChecker();
const imports = [], occurrences = [], dynamicSlots = [], glyphCandidates = [], graphics = [], nativeControls = [], cssVisuals = [], assets = [], renderCalls = [], primitives = [], sharedGraphicCalls = [], programmaticGraphics = [], cursorLocations = [];
const sourceHashes = {};
const packageExports = new Map(), packageDefinitions = new Map();
for (const entry of iconSource) for (const name of [...entry.aliases, entry.id.split('-').map(word=>word[0].toUpperCase()+word.slice(1)).join('')+'Icon']) packageExports.set(name, `${entry.id}.svg`);
const canonical = name => `icon.wireedm.${path.basename(packageExports.get(name) ?? name, '.svg')}`;
const compact = value => value.replace(/\s+/g, ' ').trim();
// All non-ASCII text is a candidate, including uncommon pause/arrow glyphs.
const symbolGlyph = /[^\x00-\x7f]/u;
const tinyGlyph = /^(?:[+\-!?>*]|fx|f\(x\)|[A-Z]|XY|XZ|YZ)$/;
const containerTags = new Set(['button', 'Button', 'MenuItem', 'MenuCheckboxItem', 'a', 'label', 'summary', 'output', 'span', 'div', 'li', 'header']);
function ancestors(node) { const values = []; for (let p = node.parent; p; p = p.parent) values.push(p); return values; }
function jsxOpening(node) { return ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null; }
function attrs(opening, sf) {
  if (!opening) return {};
  return Object.fromEntries(opening.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(sf), attribute.initializer ? compact(attribute.initializer.getText(sf)) : 'true']));
}
function component(node, sf) {
  for (const p of ancestors(node)) {
    if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name) return p.name.getText(sf);
    if (ts.isArrowFunction(p) && ts.isVariableDeclaration(p.parent)) return p.parent.name.getText(sf);
  }
  return path.basename(sf.fileName).replace(/\.[^.]+$/, '');
}
function context(node, sf) {
  const enclosing = ancestors(node);
  const containers = enclosing.map(p => ({ node: p, opening: jsxOpening(p) })).filter(p => p.opening && containerTags.has(p.opening.tagName.getText(sf)));
  const interactive = containers.find(p => /^(button|Button|MenuItem|MenuCheckboxItem|a|label|summary)$/.test(p.opening.tagName.getText(sf))) ?? containers[0];
  const attributes = attrs(interactive?.opening, sf);
  const conditional = enclosing.filter(p => ts.isConditionalExpression(p) || ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || ts.isIfStatement(p)).slice(0, 4).map(p => {
    if (ts.isConditionalExpression(p)) return `${compact(p.condition.getText(sf))} [${node.pos >= p.whenTrue.pos && node.end <= p.whenTrue.end ? 'true' : 'false'} branch]`;
    if (ts.isIfStatement(p)) return compact(p.expression.getText(sf));
    return compact(p.left.getText(sf));
  });
  const call = enclosing.find(ts.isCallExpression);
  const variable = enclosing.find(ts.isVariableDeclaration);
  const property = enclosing.find(ts.isPropertyAssignment);
  const jsxParents = enclosing.map(p => jsxOpening(p)).filter(Boolean).filter(p => /^[A-Z]/.test(p.tagName.getText(sf))).slice(0, 3).map(p => ({ tag: p.tagName.getText(sf), attributes: attrs(p, sf) }));
  const visibleText = [];
  const collectText = p => {
    if (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p)) return;
    if ((ts.isJsxText(p) || ts.isStringLiteralLike(p)) && compact(p.text)) visibleText.push(compact(p.text));
    ts.forEachChild(p, collectText);
  };
  if (interactive && interactive.opening.tagName.getText(sf) !== 'div') collectText(interactive.node);
  return { component: component(node, sf), container: interactive?.opening.tagName.getText(sf) ?? null, attributes, controlAttributes: attributes, jsxParents,
    visibleText: visibleText.join(' ').slice(0, 400), callName: call?.expression.getText(sf) ?? null, callArguments: call?.arguments.map(argument => compact(argument.getText(sf))) ?? [],
    containerText: interactive ? compact(interactive.node.getText(sf)).slice(0, 1500) : null,
    conditions: conditional, call: call ? compact(call.getText(sf)).slice(0, 1500) : null,
    variable: variable?.name.getText(sf) ?? null, mapProperty: property?.name.getText(sf) ?? null };
}
function record(node, sf, fields) {
  const start = node.getStart(sf), location = sf.getLineAndCharacterOfPosition(start);
  const file = slash(path.relative(root, sf.fileName));
  return { file, line: location.line + 1, column: location.character + 1, start, expression: compact(node.getText(sf)), ...context(node, sf), ...fields };
}
for (const file of production) {
  const bytes = readFileSync(file); const rel = slash(path.relative(root, file)); sourceHashes[rel] = hash(bytes);
  if (/\.(?:png|jpe?g|webp|gif|avif|ico|svg)$/i.test(file)) assets.push({ file: rel, bytes: statSync(file).size, sha256: hash(bytes) });
  if (/\.css$/i.test(file)) {
    const text = bytes.toString('utf8');
    const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    for (const match of rules) {
      const selector = compact(match[1]), declarations = compact(match[2]);
      if (/(?:^|[;\s])(?:content|cursor)\s*:|(?:mask|background)(?:-image)?\s*:[^;]*url\(|::(?:before|after|marker)|(?:icon|legend|swatch|crosshair|handle|spinner|spin|dot|marker|disclosure)|\bsvg\b|\.sim-tools[^{}]*\bi\b/i.test(selector + ' ' + declarations)) {
        const position = match.index + match[0].indexOf(match[1]) + match[1].search(/\S/);
        cssVisuals.push({ file: rel, line: text.slice(0, position).split('\n').length, selector, declarations });
      }
    }
  }
  if (/\.html$/i.test(file)) {
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/<(?:svg|img|link)\b[^>]*>/gi)) {
      if (/^<link/i.test(match[0]) && !/rel\s*=\s*["'](?:icon|apple-touch-icon|mask-icon)/i.test(match[0])) continue;
      graphics.push({ file: rel, line: text.slice(0, match.index).split('\n').length, column: 1, expression: compact(match[0]), component: 'HTML entry point', kind: 'html-graphic' });
    }
  }
}
for (const file of codeFiles) {
  const sf = program.getSourceFile(file);
  if (!sf) throw new Error(`Unparsed source ${file}`);
  const symbols = new Map(), names = new Map(), namespaceNames = new Set(), sharedSelectNames = new Set(), sharedInputNames = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const packageName = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (packageName === '@/components/ui/select' && bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) if (!item.isTypeOnly && !statement.importClause.isTypeOnly && (item.propertyName ?? item.name).text === 'Select') sharedSelectNames.add(item.name.text);
    }
    if (packageName === '@/components/ui/input' && bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) if (!item.isTypeOnly && !statement.importClause.isTypeOnly && (item.propertyName ?? item.name).text === 'Input') sharedInputNames.add(item.name.text);
    }
    if (!/(?:lucide|icons?|\.svg$)/i.test(packageName)) continue;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      const imported = (item.propertyName ?? item.name).text;
      if (item.isTypeOnly || statement.importClause?.isTypeOnly) continue;
      const modulePath = packageExports.get(imported);
      if (packageName === '@wire-edm/icons-react' && !modulePath) throw new Error(`Unresolved icon package export ${imported}`);
      if (modulePath && !packageDefinitions.has(modulePath)) {
        const iconPath = path.join(root, 'src/assets/icons', modulePath), text = readFileSync(iconPath, 'utf8');
        const entry = iconSource.find(entry=>`${entry.id}.svg`===modulePath);
        packageDefinitions.set(modulePath, { canonical: canonical(imported), file: slash(path.relative(root, iconPath)), line:1,
          label:entry.label, node:JSON.stringify(entry.paths), sha256:hash(text) });
      }
      const entry = record(item.name, sf, { canonical: canonical(imported), imported, alias: item.name.text, source: packageName });
      imports.push(entry); names.set(item.name.text, entry); const symbol = checker.getSymbolAtLocation(item.name); if (symbol) symbols.set(symbol, entry);
    }
    if (bindings && ts.isNamespaceImport(bindings)) namespaceNames.add(bindings.name.text);
  }
  function visit(node) {
    if (ts.isIdentifier(node)) {
      const entry = symbols.get(checker.getSymbolAtLocation(node));
      const inImport = ancestors(node).some(ts.isImportDeclaration);
      const closing = ts.isJsxClosingElement(node.parent);
      const inType = ancestors(node).some(p => ts.isTypeNode(p));
      if (entry && !inImport && !closing && !inType) {
        const opening = ts.isJsxOpeningElement(node.parent) || ts.isJsxSelfClosingElement(node.parent);
        occurrences.push(record(node, sf, { canonical: entry.canonical, alias: entry.alias, source: entry.source, attributes: opening ? attrs(node.parent, sf) : context(node, sf).attributes, kind: opening ? 'jsx-icon' : ts.isPropertyAssignment(node.parent) ? 'map-binding' : 'icon-reference' }));
      }
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (/Icon|icon/.test(tag) && !names.has(tag)) {
        const declaration = checker.getSymbolAtLocation(node.tagName)?.declarations?.map(p => compact(p.getText(sf))).join(' / ');
        dynamicSlots.push(record(node, sf, { kind: 'dynamic-icon-slot', tag, declaration: declaration ?? null, attributes: attrs(node, sf) }));
      }
      if (['svg', 'img', 'image', 'symbol', 'use', 'marker', 'pattern', 'i'].includes(tag)) graphics.push(record(node, sf, { kind: tag === 'i' ? 'css-graphic' : 'jsx-graphic', tag, attributes: attrs(node, sf) }));
      if (['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'text'].includes(tag)) primitives.push(record(node, sf, { kind: 'svg-primitive', tag, attributes: attrs(node, sf) }));
      if (['InfoTip', 'SearchField', 'CadContextHelp', 'StatusDot', 'SlidingTabs', 'SectionButton', 'SelectField', 'ScalarField', 'CadReferencePickButton', 'CadEdgeTreatmentCommand', 'CadPatternCommand', 'CadFeatureTree', 'CadTreeRename', 'CadParametersPanel', 'CadPluginsPanel', 'CadSketchDimensionControls', 'CadSketchProfilePanel', 'CadGearHelp'].includes(tag)) sharedGraphicCalls.push(record(node, sf, { kind: 'shared-component-call', tag, attributes: attrs(node, sf) }));
      if (['select', 'summary'].includes(tag) || tag === 'input' && /checkbox|radio/.test(attrs(node, sf).type ?? '')) nativeControls.push(record(node, sf, { kind: 'native-control', tag, attributes: attrs(node, sf) }));
      if (sharedSelectNames.has(tag)) nativeControls.push(record(node, sf, { kind: 'native-control', tag: 'select', sharedComponent: tag, attributes: attrs(node, sf) }));
      if (sharedInputNames.has(tag) && /checkbox|radio/.test(attrs(node, sf).type ?? '')) nativeControls.push(record(node, sf, { kind: 'native-control', tag: 'input', sharedComponent: tag, attributes: attrs(node, sf) }));
      const values = attrs(node, sf);
      if (/cursor-/.test(values.className ?? '')) cursorLocations.push(record(node, sf, { kind: 'browser-cursor-class', tag, attributes: values }));
      if (/rounded-full/.test(values.className ?? '') && /bg-|border|h-|size-/.test(values.className ?? '')) graphics.push(record(node, sf, { kind: 'css-status-shape', tag, attributes: values }));
      if (/(?:status-dot|state-dot|legend|swatch)/.test(values.className ?? '') && tag !== 'i') graphics.push(record(node, sf, { kind: 'css-status-shape', tag, attributes: values }));
    }
    if (ts.isCallExpression(node) && /^(?:toastIcon|toolButton|setupButton|scalar)$/.test(node.expression.getText(sf))) renderCalls.push(record(node, sf, { kind: 'icon-render-call', renderer: node.expression.getText(sf), arguments: node.arguments.map(argument => compact(argument.getText(sf))) }));
    if (ts.isJsxExpression(node) && node.expression && /^(?:icon|tab\.icon)$|^triggerContent(?:\s*\?\?|$)/.test(node.expression.getText(sf))) dynamicSlots.push(record(node, sf, { kind: 'dynamic-content-slot', tag: node.expression.getText(sf), declaration: 'ReactNode supplied by parent prop or tab descriptor; absent triggerContent defaults to Info' }));
    if (ts.isNewExpression(node) && /(?:AxesHelper|ArrowHelper|GridHelper|CanvasTexture|Sprite|SphereGeometry|CylinderGeometry|ConeGeometry)$/.test(node.expression.getText(sf))) programmaticGraphics.push(record(node, sf, { kind: 'programmatic-graphic', constructor: node.expression.getText(sf) }));
    if (ts.isJsxText(node) || ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const value = compact(node.text);
      if (symbolGlyph.test(value) || tinyGlyph.test(value)) glyphCandidates.push(record(node, sf, { kind: 'glyph-candidate', value }));
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
// Independently count lexical opening tags and imports, separate from symbol resolution.
const lexical = { iconImports: [], svgOpenings: [], imageOpenings: [], iconSlots: [] };
for (const file of codeFiles) {
  const text = readFileSync(file, 'utf8'), rel = slash(path.relative(root, file));
  for (const match of text.matchAll(/from\s*['"]@wire-edm\/icons-react['"]/g)) lexical.iconImports.push({ file: rel, line: text.slice(0, match.index).split('\n').length });
  for (const [key, pattern] of [['svgOpenings', /<svg(?:\s|>)/g], ['imageOpenings', /<(?:img|image)(?:\s|>)/g], ['iconSlots', /<[\w.]*Icon(?:\s|>)/g]]) for (const match of text.matchAll(pattern)) lexical[key].push({ file: rel, line: text.slice(0, match.index).split('\n').length });
}
for (const category of [occurrences, dynamicSlots, glyphCandidates, graphics, nativeControls, cssVisuals, renderCalls, primitives, sharedGraphicCalls, programmaticGraphics, cursorLocations]) {
  const ordinal = new Map();
  for (const entry of category) {
    const signature = `${entry.file}|${entry.component ?? ''}|${entry.kind ?? ''}|${entry.canonical ?? ''}|${entry.expression ?? entry.selector}|${entry.mapProperty ?? ''}`;
    const count = (ordinal.get(signature) ?? 0) + 1; ordinal.set(signature, count);
    entry.id = `use.${hash(signature + '|' + count).slice(0, 12)}`;
  }
}
const report = {
  generatedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirtyState: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  scannedRoots: ['src/', 'package-tools/', 'index.html'], productionFileCount: production.length, parsedCodeFileCount: codeFiles.length,
  fixtureFileCount: sourceFiles.length - production.length, sourceHashes,
  iconPackage:{name:'@wire-edm/icons-react',version:JSON.parse(readFileSync(path.join(root,'packages/icons-react/package.json'),'utf8')).version,original:true},
  packageDefinitions: [...packageDefinitions.values()], imports, occurrences, dynamicSlots, renderCalls, sharedGraphicCalls, primitives, programmaticGraphics, cursorLocations, graphics, nativeControls, glyphCandidates, cssVisuals, assets, lexical
};
report.excludedCategories = ['docs', 'scripts', 'e2e', 'tests', 'DXF-test-subjects', 'vendor', 'dist', '.cache', '.playwright', 'playwright-report', 'test-results'].filter(directory => {
  try { return statSync(path.join(root, directory)).isDirectory(); } catch { return false; }
}).map(directory => {
  const files = walk(path.join(root, directory));
  const media = files.filter(file => /\.(?:svg|png|jpe?g|gif|webp|ico|avif)$/i.test(file));
  return { root: directory, fileCount: files.length, mediaFileCount: media.length, mediaPaths: media.map(file => slash(path.relative(root, file))) };
});
let lexicalImportBindings = 0, lexicalJsxIcons = 0, lexicalPrimitives = 0;
for (const file of codeFiles) {
  const text = readFileSync(file, 'utf8'), relative = slash(path.relative(root, file));
  for (const match of text.matchAll(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]@wire-edm\/icons-react['"]/g)) if (!match[1]) lexicalImportBindings += match[2].split(',').filter(item => item.trim() && !/^type\s/.test(item.trim())).length;
  for (const entry of imports.filter(entry => entry.file === relative)) lexicalJsxIcons += [...text.matchAll(new RegExp('<' + entry.alias + '(?:\\s|/?>)', 'g'))].length;
  lexicalPrimitives += [...text.matchAll(/<(?:path|circle|ellipse|line|polyline|polygon|rect|text)(?:\s|>)/g)].length;
}
report.coverageChecks = {
  importBindings: { independent: lexicalImportBindings, ast: imports.length },
  directJsxIcons: { independent: lexicalJsxIcons, ast: occurrences.filter(entry => entry.kind === 'jsx-icon').length },
  svgRoots: { independent: lexical.svgOpenings.length, ast: graphics.filter(entry => entry.tag === 'svg').length },
  imageRoots: { independent: lexical.imageOpenings.length, ast: graphics.filter(entry => ['img', 'image'].includes(entry.tag)).length },
  primitiveTemplates: { independent: lexicalPrimitives, ast: primitives.length }
};
for (const [name, values] of Object.entries(report.coverageChecks)) if (values.independent !== values.ast) throw new Error(`Unreconciled icon coverage ${name}: ${JSON.stringify(values)}`);
for (const file of codeFiles) if (hash(program.getSourceFile(file).text) !== sourceHashes[slash(path.relative(root, file))]) throw new Error(`Source changed while parsing ${file}; rerun the inventory`);
for (const [file, expected] of Object.entries(sourceHashes)) if (hash(readFileSync(path.join(root, file))) !== expected) throw new Error(`Source changed during audit ${file}; rerun the inventory`);
const output = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? 'docs/design/icon-inventory.audit.json';
mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
writeFileSync(path.resolve(root, output), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, files: production.length, codeFiles: codeFiles.length, imports: imports.length, canonicalLucideIcons: new Set(imports.map(item => item.canonical)).size, occurrences: occurrences.length, dynamicSlots: dynamicSlots.length, graphics: graphics.length, nativeControls: nativeControls.length, glyphCandidates: glyphCandidates.length, cssVisuals: cssVisuals.length, assets: assets.length, lexical: Object.fromEntries(Object.entries(lexical).map(([key, values]) => [key, values.length])) }, null, 2));
if (process.argv.includes('--render')) {
  const { renderIconInventory } = await import('./render-icon-inventory.mjs');
  console.log(JSON.stringify(renderIconInventory(report, root)));
}
