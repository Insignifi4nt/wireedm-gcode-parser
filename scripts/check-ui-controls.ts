import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const owners: Record<string, string> = {
  button: 'src/components/ui/button.tsx', input: 'src/components/ui/input.tsx',
  textarea: 'src/components/ui/textarea.tsx', select: 'src/components/ui/select.tsx',
  menu: 'src/components/ui/menu.tsx', tooltip: 'src/components/ui/tooltip.tsx'
};

interface Location { tag: string; line: number; column: number }

// CSS named colors are palette literals too; currentColor/system colors are not.
const namedColors = new Set(`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki
darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey
honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray
lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen
magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver
skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(/\s+/));

function hasLiteralColor(value: string) {
  return /#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i.test(value)
    || [...value.matchAll(/[-a-z_][\w-]*/gi)].some(match => namedColors.has(match[0].toLowerCase()));
}

function isPaintProperty(property: string) {
  return /^(?:color$|(?:background|border|outline|box-shadow|text-shadow|fill|stroke|accent-color|caret-color|column-rule|text-decoration|text-emphasis|filter)(?:-|$))/.test(property);
}

function hasUppercaseUtility(value: string) {
  return value.split(/\s+/).some(token => /(?:^|:)!?uppercase!?$|\[text-transform:uppercase\]!?$/.test(token));
}

function cssDeclarations(source: string, inspect: (property: string, value: string, offset: number, selectors: string[]) => void) {
  // Keep offsets while excluding comments, quoted content and quoted URL data.
  const code = source.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, value => value.replace(/[^\r\n]/g, ' '));
  const selectors: string[] = [];
  let start = 0, parentheses = 0;
  for (let index = 0; index < code.length; index++) {
    const character = code[index];
    if (character === '(') parentheses++;
    if (character === ')') parentheses--;
    if (parentheses || !['{', '}', ';'].includes(character)) continue;
    const segment = code.slice(start, index);
    if (character === '{') selectors.push(segment.trim());
    else {
      const declaration = /^\s*([\w-]+)\s*:\s*([\s\S]*)$/.exec(segment);
      if (declaration && selectors.length) inspect(declaration[1].toLowerCase(), declaration[2], start + segment.indexOf(declaration[1]), selectors);
      const apply = /^\s*@apply\s+([\s\S]*)$/.exec(segment);
      if (apply) inspect('@apply', apply[1], start + segment.indexOf('@apply'), selectors);
      if (character === '}') selectors.pop();
    }
    start = index + 1;
  }
}

function styleLocations(source: string, fileName: string): Location[] {
  const locations = new Map<number, Location>();
  function record(offset: number, tag: string) {
    const before = source.slice(0, offset);
    locations.set(offset, { tag, line: before.split('\n').length, column: offset - before.lastIndexOf('\n') });
  }
  if (fileName.endsWith('.css')) {
    cssDeclarations(source, (property, value, offset, selectors) => {
      if (property === 'text-transform' && /^uppercase(?:\s*!important)?\s*$/i.test(value.trim())) record(offset, 'uppercase-style');
      if (property === '@apply' && hasUppercaseUtility(value)) record(offset, 'uppercase-class');
      const shared = fileName.startsWith('src/components/ui/');
      if (shared && fileName !== 'src/components/ui/theme.css' && (isPaintProperty(property) || property.startsWith('--')) && hasLiteralColor(value)) record(offset, 'literal-control-color');
      if (!shared && selectors.some(selector => /\.ui-[\w-]+/.test(selector)) && (isPaintProperty(property) || property === 'opacity')) record(offset, 'shared-control-paint');
    });
  } else if (/uppercase/i.test(source)) {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function classes(node: ts.Node) {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
        && hasUppercaseUtility(node.text)) record(node.getStart(file), 'uppercase-class');
      ts.forEachChild(node, classes);
    }
    function visit(node: ts.Node) {
      if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className' && node.initializer) classes(node.initializer);
      if (ts.isPropertyAssignment(node)) {
        const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : '';
        if (name === 'className') classes(node.initializer);
        if (name === 'textTransform' && ts.isStringLiteralLike(node.initializer) && node.initializer.text.toLowerCase() === 'uppercase') record(node.getStart(file), 'uppercase-style');
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['cn', 'clsx', 'classnames', 'cva'].includes(node.expression.text)) classes(node);
      if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && node.left.name.text === 'textTransform'
        && ts.isStringLiteralLike(node.right) && node.right.text.toLowerCase() === 'uppercase') record(node.getStart(file), 'uppercase-style');
      ts.forEachChild(node, visit);
    }
    visit(file);
  }
  return [...locations.values()];
}

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
      if (!entry.isFile() || !/\.(?:tsx?|css)$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)
        || relative.includes('/__tests__/')) continue;
      const source = await readFile(path.join(root, relative), 'utf8');
      const controls = !relative.endsWith('.css') && /<(?:button|input|textarea|select)\b|\bcreateElement\s*\(|\b(?:role|title)\s*=/.test(source)
        ? unsharedControlLocations(source, relative).filter(position => owners[position.tag] !== relative) : [];
      for (const position of [...controls, ...styleLocations(source, relative)]) violations.push(`${relative}:${position.line}:${position.column} (${position.tag})`);
    }
  }
  await visit('src');
  return violations.sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = await checkUiControls();
  if (violations.length) {
    console.error(`Use shared controls and sentence-case styles. UI standard violations:\n${violations.join('\n')}`);
    process.exitCode = 1;
  } else console.log('Shared UI control standard verified.');
}
