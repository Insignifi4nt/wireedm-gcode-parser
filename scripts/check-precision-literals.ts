import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';

/**
 * Tolerances belong to the named precision policy in `src/domain/precision/cadPrecision.ts`.
 * This check flags raw negative-exponent literals (`1e-9`) and `Number.EPSILON` in non-test
 * source outside that module. Comments and strings are not code and are ignored. Literals that
 * deliberately stay where they are are listed below, per file, with the reason. A file may not
 * gain literals beyond its entry, and an entry that is larger than needed must shrink.
 */
const POLICY = 'src/domain/precision/cadPrecision.ts';

interface Allowance { readonly literals: Readonly<Record<string, number>>; readonly reason: string }

const VIEW = 'View or pointer space only: camera, picking, snapping, overlay or label layout. It never reaches saved geometry, CAM or output.';
const allowed: Readonly<Record<string, Allowance>> = {
  'src/features/cad/kernel/cadKernelStepUnits.ts': {
    literals: { '1e-1': 1, '1e-2': 1, '1e-3': 1, '1e-6': 1, '1e-9': 1, '1e-12': 1, '1e-15': 1, '1e-18': 1 },
    reason: 'STEP SI prefix factors, not tolerances.' },
  'src/domain/dxf/parseDxf.ts': { literals: { '1e-7': 1 }, reason: 'DXF unit table: one angstrom in millimetres.' },
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
  'src/features/cad/cadSketchGeometrySnaps.ts': { literals: { '1e-9': 2, '1e-12': 2, 'Number.EPSILON': 1 }, reason: VIEW },
  'src/features/cad/cadSketchGraphDimensionLayout.ts': { literals: { '1e-12': 7, '1e-9': 1, '1e-6': 2 }, reason: VIEW },
  'src/features/cad/cadSketchPicking.ts': { literals: { 'Number.EPSILON': 3 }, reason: VIEW },
  'src/features/cad/cadSketchRelationGlyphLayout.ts': { literals: { '1e-9': 1, '1e-6': 1 }, reason: VIEW },
  'src/features/cad/cadSketchSvg.ts': { literals: { '1e-12': 1 }, reason: VIEW },
  'src/features/cad/cadTopologyPicking.ts': { literals: { '1e-7': 1, '2e-7': 1 }, reason: VIEW },
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

function literalsIn(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: { literal: string; line: number }[] = [];
  const visit = (node: ts.Node) => {
    const at = () => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    if (ts.isNumericLiteral(node) && /e-/i.test(node.getText(source))) found.push({ literal: node.getText(source).toLowerCase(), line: at() });
    else if (ts.isPropertyAccessExpression(node) && node.getText(source).replace(/\s/g, '') === 'Number.EPSILON') found.push({ literal: 'Number.EPSILON', line: at() });
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'packages/sketch-solver'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(file => /\.[cm]?[jt]sx?$/.test(file) && !file.endsWith('.d.ts') && !isTest(file) && file !== POLICY);
const problems: string[] = [];
const seen = new Set<string>();
for (const file of files) {
  let text: string;
  try { text = await readFile(path.join(root, file), 'utf8'); } catch { continue; }
  const found = literalsIn(file, text);
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
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log(`Precision literals: ${files.length} source files checked; tolerances outside ${POLICY} are only the listed exceptions.`);
