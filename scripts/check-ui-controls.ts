import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owners: Record<string, string> = {
  button: 'src/components/ui/button.tsx', input: 'src/components/ui/input.tsx',
  textarea: 'src/components/ui/textarea.tsx', select: 'src/components/ui/select.tsx',
  menu: 'src/components/ui/menu.tsx', tooltip: 'src/components/ui/tooltip.tsx'
};

export function unsharedControlLocations(source: string, fileName: string) {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const locations: { tag: string; line: number; column: number }[] = [];
  function record(node: ts.Node, tag: string) {
    const position = file.getLineAndCharacterOfPosition(node.getStart(file));
    locations.push({ tag, line: position.line + 1, column: position.character + 1 });
  }
  function visit(node: ts.Node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ts.isIdentifier(node.tagName) && /^[a-z]/.test(node.tagName.text)) {
      if (Object.hasOwn(owners, node.tagName.text)) record(node, node.tagName.text);
      for (const attribute of node.attributes.properties) if (ts.isJsxAttribute(attribute)) {
        if (attribute.name.getText(file) === 'title') record(attribute, 'native-tooltip');
        if (attribute.name.getText(file) === 'role' && attribute.initializer && ts.isStringLiteral(attribute.initializer)
          && ['menu', 'tooltip'].includes(attribute.initializer.text)) record(node, attribute.initializer.text);
      }
    }
    const factory = ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && Object.hasOwn(owners, node.arguments[0].text)
      && (ts.isIdentifier(node.expression) && node.expression.text === 'createElement'
        || ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'createElement');
    if (factory && ts.isCallExpression(node) && ts.isStringLiteral(node.arguments[0])) record(node, node.arguments[0].text);
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
        || relative.includes('/__tests__/')) continue;
      const source = await readFile(path.join(root, relative), 'utf8');
      if (!/<(?:button|input|textarea|select)\b|\bcreateElement\s*\(|\b(?:role|title)\s*=/.test(source)) continue;
      for (const position of unsharedControlLocations(source, relative)) if (owners[position.tag] !== relative) violations.push(`${relative}:${position.line}:${position.column} (${position.tag})`);
    }
  }
  await visit('src');
  return violations.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkUiControls();
  if (violations.length) {
    console.error(`Use shared controls, menus and tooltips from @/components/ui. Unshared UI found at:\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else console.log('Shared UI control standard verified.');
}
