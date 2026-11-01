import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';

/**
 * Tolerances belong to the named precision policy in `src/domain/precision/cadPrecision.ts`.
 * This check flags tolerance spellings in non-test source outside that module:
 * - numeric literals with a negative exponent (`1e-9`), or decimals below 0.001 (`0.00001`);
 * - a literal raised to a negative literal power (`10 ** -9`, `Math.pow(10, -9)`);
 * - such a number converted from a string (`Number('1e-9')`, `parseFloat('1e-9')`, `+'1e-9'`);
 * - `Number.EPSILON` in any spelling, such as `Number['EPSILON']`, `(Number).EPSILON`,
 *   `globalThis.Number.EPSILON` or `const { EPSILON } = Number`.
 * Comments and other strings are not code and are ignored. Literals that deliberately stay where
 * they are are listed below, per file, with the reason. A file may not gain literals beyond its
 * entry, and an entry that is larger than needed must shrink. Values reached through an alias of
 * `Number`, or by arithmetic on other literals, are not traced.
 */
const POLICY = 'src/domain/precision/cadPrecision.ts';

interface Allowance { readonly literals: Readonly<Record<string, number>>; readonly reason: string }

/** Only for values that never end up in model coordinates, saved data, CAM or output. */
const VIEW = 'View or pointer space only: camera, picking, hover, overlay, glyph or grid layout, or playback time. It never reaches model coordinates, saved placements, CAM or output.';
const allowed: Readonly<Record<string, Allowance>> = {
  'src/features/cad/kernel/cadKernelStepUnits.ts': {
    literals: { '1e-1': 1, '1e-2': 1, '1e-3': 1, '1e-6': 1, '1e-9': 1, '1e-12': 1, '1e-15': 1, '1e-18': 1 },
    reason: 'STEP SI prefix factors, not tolerances.' },
  'src/domain/dxf/parseDxf.ts': { literals: { '1e-7': 1, '0.0000254': 1, '0.000001': 1 },
    reason: 'DXF unit table: angstroms, microinches and nanometres in millimetres.' },
  'src/domain/cad/cadGear.ts': { literals: { '0.00001': 1 }, reason: 'Smallest flank tolerance a gear accepts as input. An input range, not a comparison.' },
  'src/domain/cad/plugins/cadPlugins.ts': { literals: { '0.00001': 4 }, reason: 'Smallest flank tolerance the gear plugin inputs accept. An input range, not a comparison.' },
  'src/lib/userMessage.ts': { literals: { '0.0001': 1 }, reason: 'Display formatting: smaller magnitudes print as less than 0.0001.' },
  'src/domain/path-intel/segments.ts': { literals: { '1e-3': 1 },
    reason: 'Sweep below which arc length uses a series expansion. A numerical method switch, not a tolerance.' },
  'src/domain/editor/previewGeometry.ts': { literals: { '1e-6': 1 }, reason: 'Viewport aspect ratio match for the G-code preview.' },
  'src/features/cad/benchmark/cadBenchmarkCases.ts': { literals: { '1e-6': 1 }, reason: 'Benchmark acceptance of kernel volume, not product behaviour.' },
  'src/features/cad/benchmark/cadSolverDragCases.ts': { literals: { '1e-5': 1, '2.5e-6': 1 }, reason: 'Benchmark input geometry.' },
  'src/features/cad/CadViewport.tsx': { literals: { '1e-7': 1, '1e-12': 1 }, reason: VIEW },
  'src/features/cad/cadCurveRendering.ts': { literals: { '1e-7': 1, '4e-7': 1 }, reason: VIEW },
  'src/features/cad/cadExtrudeDepthHandle.ts': { literals: { '1e-10': 1 }, reason: VIEW },
  'src/features/cad/cadExtrudeDepthInteraction.ts': { literals: { '1e-3': 1, '1e-9': 1 }, reason: VIEW },
  'src/features/cad/cadRegionSelectionOverlay.ts': { literals: { '1e-8': 1 }, reason: VIEW },
  'src/features/cad/cadSketchGeometrySnaps.ts': { literals: { 'Number.EPSILON': 1 },
    reason: 'Ties between snap candidates ranked by pointer distance in pixels. The snap point itself uses the policy roles.' },
  'src/features/cad/cadSketchPicking.ts': { literals: { 'Number.EPSILON': 3 }, reason: VIEW },
  'src/features/cad/cadSketchRelationGlyphLayout.ts': { literals: { '1e-9': 1, '1e-6': 1 }, reason: VIEW },
  'src/features/cad/cadSketchSvg.ts': { literals: { '1e-12': 1 }, reason: VIEW },
  'src/features/cad/cadTopologyPicking.ts': { literals: { '1e-7': 1, '2e-7': 1 }, reason: VIEW },
  'src/features/cad/view/cadSectionCaps.ts': { literals: { '1e-6': 1 }, reason: VIEW },
  'src/features/cad/view/cadSectionView.ts': { literals: { '1e-12': 1 }, reason: VIEW },
  'src/features/cad/view/cadSketchCamera.ts': { literals: { '1e-5': 1 }, reason: VIEW },
  'src/features/editor/EditorInspectorPanel.tsx': { literals: { '1e-6': 1 }, reason: VIEW },
  'src/features/editor/EditorPathNavigatorPanel.tsx': { literals: { '1e-6': 1 }, reason: VIEW },
  'src/features/editor/EditorPreview.tsx': { literals: { '1e-6': 2 }, reason: VIEW },
  'src/features/editor/editorPreviewEndpoints.ts': { literals: { '1e-9': 2 }, reason: VIEW },
  'src/features/editor/editorPreviewHelpers.ts': { literals: { '1e-9': 4, '1e-4': 1 }, reason: VIEW },
  'src/features/simulation/SimulationPanel.tsx': { literals: { '1e-12': 1 }, reason: VIEW },
  'src/features/simulation/SimulationScene.ts': { literals: { '1e-12': 1 }, reason: VIEW },
  'src/features/simulation/simulationSurfaceAppearance.ts': { literals: { '1e-6': 1, '1e-12': 1 }, reason: VIEW }
};

function isTest(file: string) {
  return /(^|\/)__tests__\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)testSetup\.ts$/.test(file);
}

/** A tolerance spelled in source: its allowance key and its line. */
export interface PrecisionLiteral { readonly literal: string; readonly line: number }

const NUMBER_SPELLING = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/** Decimals below this, written without an exponent, read as tolerances. */
const SMALL_DECIMAL = 0.001;
const GLOBAL_OBJECTS = new Set(['globalThis', 'window', 'self', 'global']);

function isToleranceSpelling(text: string): boolean {
  const plain = text.trim().replaceAll('_', '');
  if (!NUMBER_SPELLING.test(plain)) return false;
  const magnitude = Math.abs(Number(plain));
  return /e-/i.test(plain) || (magnitude > 0 && magnitude < SMALL_DECIMAL);
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) node = node.expression;
  return node;
}

function stringValue(node: ts.Expression | undefined): string | undefined {
  const target = node && unwrap(node);
  return target && (ts.isStringLiteral(target) || ts.isNoSubstitutionTemplateLiteral(target)) ? target.text : undefined;
}

/** The object and property name of `a.b`, `a?.b` or `a['b']`. */
function memberOf(node: ts.Node): { readonly object: ts.Expression; readonly name: string } | undefined {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) return { object: node.expression, name: node.name.text };
  if (ts.isElementAccessExpression(node)) {
    const name = stringValue(node.argumentExpression);
    if (name !== undefined) return { object: node.expression, name };
  }
  return undefined;
}

/** The global `name`, directly or through the global object. */
function isGlobal(node: ts.Expression, name: string): boolean {
  const target = unwrap(node);
  if (ts.isIdentifier(target)) return target.text === name;
  const member = memberOf(target);
  if (!member || member.name !== name) return false;
  const owner = unwrap(member.object);
  return ts.isIdentifier(owner) && GLOBAL_OBJECTS.has(owner.text);
}

function numericText(node: ts.Expression): string | undefined {
  const target = unwrap(node);
  return ts.isNumericLiteral(target) ? target.getText() : undefined;
}

function negativeNumericText(node: ts.Expression): string | undefined {
  const target = unwrap(node);
  return ts.isPrefixUnaryExpression(target) && target.operator === ts.SyntaxKind.MinusToken ? numericText(target.operand) : undefined;
}

/** The callee name of a string-to-number conversion: `Number`, `parseFloat` or `Number.parseFloat`. */
function conversionName(callee: ts.Expression): string | undefined {
  const target = unwrap(callee);
  if (isGlobal(target, 'Number')) return 'Number';
  if (isGlobal(target, 'parseFloat')) return 'parseFloat';
  const member = memberOf(target);
  return member?.name === 'parseFloat' && isGlobal(member.object, 'Number') ? 'Number.parseFloat' : undefined;
}

/** Every tolerance spelling in one source file, in source order. */
export function precisionLiteralsIn(file: string, text: string): PrecisionLiteral[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: PrecisionLiteral[] = [];
  const visit = (node: ts.Node) => {
    const add = (literal: string) => found.push({ literal, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
    const member = memberOf(node);
    if (ts.isNumericLiteral(node)) {
      if (isToleranceSpelling(node.getText(source))) add(node.getText(source).toLowerCase());
    } else if (member) {
      if (member.name === 'EPSILON' && isGlobal(member.object, 'Number')) add('Number.EPSILON');
    } else if (ts.isBindingElement(node)) {
      const declaration = node.parent.parent, key = node.propertyName ?? node.name;
      if (ts.isObjectBindingPattern(node.parent) && ts.isVariableDeclaration(declaration) && declaration.initializer
        && isGlobal(declaration.initializer, 'Number') && (ts.isIdentifier(key) || ts.isStringLiteral(key)) && key.text === 'EPSILON') add('Number.EPSILON');
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
      const base = numericText(node.left), exponent = negativeNumericText(node.right);
      if (base !== undefined && exponent !== undefined) add(`${base}**-${exponent}`);
    } else if (ts.isCallExpression(node)) {
      const callee = memberOf(unwrap(node.expression)), [first, second] = node.arguments;
      const base = first && numericText(first), exponent = second && negativeNumericText(second);
      if (callee?.name === 'pow' && isGlobal(callee.object, 'Math') && base !== undefined && exponent !== undefined) add(`Math.pow(${base},-${exponent})`);
      const name = conversionName(node.expression), value = stringValue(first);
      if (name && value !== undefined && isToleranceSpelling(value)) add(`${name}('${value.trim()}')`);
    } else if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken)) {
      const value = stringValue(node.operand);
      if (value !== undefined && isToleranceSpelling(value)) add(`${node.operator === ts.SyntaxKind.PlusToken ? '+' : '-'}'${value.trim()}'`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The repository's tolerance spellings outside the policy that its allowlist does not cover. */
export async function checkPrecisionLiterals(root = ROOT): Promise<{ readonly checked: number; readonly problems: readonly string[] }> {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'packages/sketch-solver'], { cwd: root, encoding: 'utf8' })
    .split('\n').filter(file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts') && !isTest(file) && file !== POLICY);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let text: string;
    try { text = await readFile(path.join(root, file), 'utf8'); } catch { continue; }
    const found = precisionLiteralsIn(file, text);
    const allowance = allowed[file];
    if (found.length || allowance) seen.add(file);
    const counts = new Map<string, number[]>();
    for (const { literal, line } of found) counts.set(literal, [...(counts.get(literal) ?? []), line]);
    for (const [literal, lines] of counts) {
      const limit = allowance?.literals[literal] ?? 0;
      if (lines.length > limit) problems.push(`${file}:${lines.join(',')}: raw tolerance ${literal}. Use a role from ${POLICY}, or add a precision role first.`);
    }
    for (const [literal, limit] of Object.entries(allowance?.literals ?? {})) {
      const count = counts.get(literal)?.length ?? 0;
      if (count < limit) problems.push(`${file}: the allowance for ${literal} is ${limit} but only ${count} remain. Lower it in scripts/check-precision-literals.ts.`);
    }
  }
  for (const file of Object.keys(allowed)) if (!seen.has(file)) problems.push(`${file}: allowed file no longer exists. Remove its entry.`);
  return { checked: files.length, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { checked, problems } = await checkPrecisionLiterals();
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else console.log(`Precision literals: ${checked} source files checked; tolerances outside ${POLICY} are only the listed exceptions.`);
}
