import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';

/**
 * Whether a CAD feature takes part in a rebuild is answered by `cadFeatureActive` in `src/domain/cad/features/cadFeatureActivity.ts`,
 * so that suppression driven by parameters or configurations changes one function. This check flags, in non-test source outside that
 * module, every use of a property named `suppressed` that names it:
 * - member access, optional or not (`feature.suppressed`, `feature?.suppressed`), which also covers assigning or deleting through it;
 * - element access by a literal key (`feature['suppressed']`, ``feature?.[`suppressed`]``, `feature['suppressed' as const]`);
 * - destructuring in declarations, parameters and loops, by name, quoted or computed key (`const { suppressed } = feature`,
 *   `({ suppressed: off }) => …`, `const { ['suppressed']: off } = feature`), at any depth and with defaults or rest siblings;
 * - destructuring assignment, by the same keys, at any depth (`({ suppressed: off } = feature)`, `[{ suppressed }] = features`,
 *   `for ({ suppressed } of features)`);
 * - `'suppressed' in feature`;
 * - reflective reads by a literal key: `Reflect.get`, `Reflect.has` and `Reflect.getOwnPropertyDescriptor`, `Object.hasOwn` and
 *   `Object.getOwnPropertyDescriptor`, and `hasOwnProperty` or `propertyIsEnumerable` on any receiver, called directly or through
 *   `.call` or `.apply`.
 * A literal key is a string or a template without substitutions, or a `const` of this file initialized to one.
 *
 * Writing the stored flag in an object literal (`{ ...feature, suppressed: true }`) is not a read, and neither are types. Other state
 * that suppresses something else takes a name of its own, such as `snapSuppressed`, so the check needs no exceptions.
 *
 * Left alone on purpose, because they cannot be told from other code without types or data flow:
 * - reads that never name the flag: `Object.keys`, `Object.values`, `Object.entries`, `for…in`, spreads and serialization pass every
 *   property, and flagging them would flag every copy of a feature;
 * - keys computed at run time, imported from another module or built from substitutions, such as ``feature[`supp${rest}`]``;
 * - comparisons with the string `'suppressed'`, which is also a sketch source issue (`case 'suppressed':`).
 */
const ACTIVITY = 'src/domain/cad/features/cadFeatureActivity.ts';
const FIELD = 'suppressed';

function isTest(file: string) {
  return /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)testSetup\.ts$/.test(file);
}

/** A read of the stored suppression flag: how it was spelled, and its line. */
export interface FeatureActivityRead { readonly spelling: string; readonly line: number }

/** The expression without the parentheses, assertions and non-null marks around it, which do not change its value. */
function bare(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))
    node = node.expression;
  return node;
}

/** `const` names of this file bound to the flag's name, as `const KEY = 'suppressed'` is. */
function flagConstants(source: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isVariableDeclarationList(node.parent)
      && node.parent.flags & ts.NodeFlags.Const) {
      const value = bare(node.initializer);
      if (ts.isStringLiteralLike(value) && value.text === FIELD) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function isTarget(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isBinaryExpression(parent)) return parent.left === node && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
  if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) return parent.initializer === node;
  if (ts.isParenthesizedExpression(parent)) return isTarget(parent);
  if (ts.isPropertyAssignment(parent)) return parent.initializer === node && ts.isObjectLiteralExpression(parent.parent) && isTarget(parent.parent);
  if (ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent)) return isTarget(parent.parent);
  if (ts.isArrayLiteralExpression(parent)) return isTarget(parent);
  return false;
}

export function featureActivityReadsIn(file: string, text: string): FeatureActivityRead[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const constants = flagConstants(source);
  const isKey = (node: ts.Expression | undefined) => {
    if (!node) return false;
    const value = bare(node);
    return ts.isStringLiteralLike(value) ? value.text === FIELD : ts.isIdentifier(value) && constants.has(value.text);
  };
  const isName = (name: ts.PropertyName | ts.BindingName) =>
    ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text === FIELD : ts.isComputedPropertyName(name) && isKey(name.expression);
  const found: FeatureActivityRead[] = [];
  const visit = (node: ts.Node) => {
    const add = (spelling: string) => found.push({ spelling, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    if (ts.isPropertyAccessExpression(node) && node.name.text === FIELD) add(`.${FIELD}`);
    else if (ts.isElementAccessExpression(node) && isKey(node.argumentExpression)) add(`['${FIELD}']`);
    else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && isName(node.propertyName ?? node.name)) add(`{ ${FIELD} }`);
    else if ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) && ts.isObjectLiteralExpression(node.parent) && isTarget(node.parent)
      && isName(node.name)) add(`{ ${FIELD} } =`);
    else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InKeyword && isKey(node.left)) add(`'${FIELD}' in`);
    else if (ts.isCallExpression(node)) {
      const method = reflectiveRead(node);
      if (method?.args.some(isKey)) add(`${method.name}('${FIELD}')`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const OWN = new Set(['hasOwnProperty', 'propertyIsEnumerable']);
const BY_RECEIVER: Readonly<Record<string, ReadonlySet<string>>> = {
  Reflect: new Set(['get', 'has', 'getOwnPropertyDescriptor']),
  Object: new Set(['hasOwn', 'getOwnPropertyDescriptor'])
};
/** The reflective method a call reads a property with, and the arguments that may name it. */
function reflectiveRead(call: ts.CallExpression): { readonly name: string; readonly args: readonly ts.Expression[] } | undefined {
  let callee = bare(call.expression), args: readonly ts.Expression[] = call.arguments;
  if (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'call' || callee.name.text === 'apply')) {
    const listed = callee.name.text === 'apply' ? call.arguments[1] && bare(call.arguments[1]) : undefined;
    args = callee.name.text === 'call' ? call.arguments.slice(1) : listed && ts.isArrayLiteralExpression(listed) ? listed.elements : [];
    callee = bare(callee.expression);
  }
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const name = callee.name.text, receiver = bare(callee.expression);
  if (OWN.has(name) || ts.isIdentifier(receiver) && BY_RECEIVER[receiver.text]?.has(name)) return { name, args };
  return undefined;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The repository's reads of the stored suppression flag outside the activity module. */
export async function checkFeatureActivity(root = ROOT): Promise<{ readonly checked: number; readonly problems: readonly string[] }> {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts') && !isTest(file) && file !== ACTIVITY);
  const problems: string[] = [];
  for (const file of files) {
    let text: string;
    try { text = await readFile(path.join(root, file), 'utf8'); } catch { continue; }
    for (const { spelling, line } of featureActivityReadsIn(file, text))
      problems.push(`${file}:${line}: reads ${spelling}. Ask cadFeatureActive(feature, scope) from ${ACTIVITY}, or name other state for what it suppresses.`);
  }
  return { checked: files.length, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checked, problems } = await checkFeatureActivity();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else console.log(`Feature activity: ${checked} source files checked; only ${ACTIVITY} reads the stored suppression flag.`);
}
