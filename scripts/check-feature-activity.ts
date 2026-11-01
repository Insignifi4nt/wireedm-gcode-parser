import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';

/**
 * Whether a CAD feature takes part in a rebuild is answered by `cadFeatureActive` in `src/domain/cad/features/cadFeatureActivity.ts`,
 * so that suppression driven by parameters or configurations changes one function. This check flags, in non-test source outside that
 * module, every read of a property named `suppressed`:
 * - member access, optional or not (`feature.suppressed`, `feature?.suppressed`);
 * - element access by a literal name (`feature['suppressed']`);
 * - destructuring (`const { suppressed } = feature`, `({ suppressed: off }) => …`).
 * Writing the stored flag in an object literal (`{ ...feature, suppressed: true }`) is not a read. Other state that suppresses
 * something else takes a name of its own, such as `snapSuppressed`, so the check needs no exceptions.
 */
const ACTIVITY = 'src/domain/cad/features/cadFeatureActivity.ts';
const FIELD = 'suppressed';

function isTest(file: string) {
  return /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)testSetup\.ts$/.test(file);
}

/** A read of the stored suppression flag: how it was spelled, and its line. */
export interface FeatureActivityRead { readonly spelling: string; readonly line: number }

function literalName(node: ts.Node): string | undefined {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isPrivateIdentifier(node) ? node.text : undefined;
}

export function featureActivityReadsIn(file: string, text: string): FeatureActivityRead[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: FeatureActivityRead[] = [];
  const visit = (node: ts.Node) => {
    const add = (spelling: string) => found.push({ spelling, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    if (ts.isPropertyAccessExpression(node) && node.name.text === FIELD) add(`.${FIELD}`);
    else if (ts.isElementAccessExpression(node) && literalName(node.argumentExpression) === FIELD) add(`['${FIELD}']`);
    else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent) && literalName(node.propertyName ?? node.name) === FIELD) add(`{ ${FIELD} }`);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
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
