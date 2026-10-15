import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import ts from 'typescript';

// An icon rename must never rename an axis, field, tooltip or operation value.
const decorativeRemovals = new Map([
  ['src/features/cad/CadFeatureTree.tsx', new Set(['!'])],
  ['src/features/cad/CadPathSegmentFields.tsx', new Set(['‹', '›'])],
  ['src/features/cad/CadPolygonVertexFields.tsx', new Set(['‹', '›'])],
  ['src/features/cad/CadTopologyInspector.tsx', new Set(['▾', '▸'])],
]);
function literals(file, source) {
  const values = new Map();
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const importedIcons = new Set(tree.statements.filter(node => ts.isImportDeclaration(node)
    && ['lucide-react', '@wire-edm/icons-react', '@/components/icons'].includes(node.moduleSpecifier.text))
    .flatMap(node => node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
      ? node.importClause.namedBindings.elements.map(binding => binding.name.text) : []));
  const isIcon = node => ts.isJsxSelfClosingElement(node) && importedIcons.has(node.tagName.getText(tree));
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isTypeNode(node) || ts.isJsxAttribute(node) && node.name.getText(tree) === 'aria-hidden') return;
    if (ts.isConditionalExpression(node) && isIcon(node.whenTrue) && isIcon(node.whenFalse)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const value = node.text.replace(/\s+/g, ' ').trim();
      if (value) values.set(value, (values.get(value) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return values;
}
function changes(file, before, after) {
  const oldValues = literals(file, before), newValues = literals(file, after);
  return [...new Set([...oldValues.keys(), ...newValues.keys()])].flatMap(value => {
    const oldCount = oldValues.get(value) ?? 0, newCount = newValues.get(value) ?? 0;
    if (oldCount === newCount || decorativeRemovals.get(file)?.has(value) && oldCount === 1 && newCount === 0) return [];
    return [{ file, value, before: oldCount, after: newCount }];
  });
}
if (process.argv.includes('--self-test')) {
  const file = 'src/features/cad/Example.tsx';
  const original = `import { X } from 'lucide-react'; const input = <button aria-label="Translation X"><X />Horizontal X</button>;`;
  const renamed = original.replace("import { X } from 'lucide-react'", "import { CloseIcon } from '@/components/icons'").replace('<X />', '<CloseIcon />');
  assert.deepEqual(changes(file, original, renamed), []);
  const conditional = "import { Circle, Square } from 'lucide-react'; const Icon = profile.kind === 'circle' ? <Circle /> : <Square />;";
  const mapped = "import { CircleIcon } from '@wire-edm/icons-react'; type Kind = Profile['geometry']['kind']; const Icon = icons[profile.kind];";
  assert.deepEqual(changes(file, conditional, mapped), []);
  assert.equal(changes(file, original, renamed.replaceAll('Translation X', 'Translation CloseIcon').replaceAll('Horizontal X', 'Horizontal CloseIcon')).length, 4);
  console.log('CAD icon text guard accepts glyph replacements and rejects axis-label replacements.');
} else {
  const integration = JSON.parse(readFileSync('docs/design/icon-integration-map.json', 'utf8'));
  const checkpoint = integration.currentApplicationCheckpoint ?? integration.publishedCadCheckpoint;
  const files = execFileSync('git', ['diff', '--name-only', checkpoint, '--', 'src/features/cad', 'src/app/CadSettingsPanel.tsx'], { encoding: 'utf8' })
    .trim().split('\n').filter(file => /\.tsx?$/.test(file) && !/\.(?:test|spec)\./.test(file));
  const mismatches = files.flatMap(file => changes(file, execFileSync('git', ['show', `${checkpoint}:${file}`], { encoding: 'utf8' }), readFileSync(file, 'utf8')));
  if (mismatches.length) {
    console.error(JSON.stringify(mismatches, null, 2));
    process.exitCode = 1;
  } else console.log(`Verified CAD control text against ${checkpoint.slice(0, 7)} in ${files.length} files; only reviewed decorative glyph text differs.`);
}
