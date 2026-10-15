import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function nativeSelectLocations(source: string, fileName: string) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const locations: { line: number; column: number }[] = [];
  function visit(node: ts.Node) {
    const jsx = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === 'select';
    const factory = ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'select'
      && (ts.isIdentifier(node.expression) && node.expression.text === 'createElement'
        || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createElement');
    if (jsx || factory) {
      const position = file.getLineAndCharacterOfPosition(node.getStart(file));
      locations.push({ line: position.line + 1, column: position.character + 1 });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return locations;
}

export async function checkUiControls(root = process.cwd()) {
  const violations: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) { await visit(relative); continue; }
      if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)
        || relative.includes('/__tests__/') || relative === 'src/components/ui/select.tsx') continue;
      const source = await readFile(path.join(root, relative), 'utf8');
      for (const position of nativeSelectLocations(source, relative)) violations.push(`${relative}:${position.line}:${position.column}`);
    }
  }
  await visit('src');
  return violations.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkUiControls();
  if (violations.length) {
    console.error(`Use the shared Select from @/components/ui/select. Native select controls found at:\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else console.log('Shared UI control standard verified.');
}
