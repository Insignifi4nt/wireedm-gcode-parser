import { beforeAll, describe, expect, it } from 'vitest';
// TypeScript 7 ships no compiler API yet; AST tooling uses the TypeScript 6 package.
import ts from '@typescript/typescript6';
import { CadSourceIndex, cadDiagnosticReach, type CadDiagnosticReachOptions, type CadDiagnosticRoot } from './cadDiagnosticReach';
import type { CadFeatureKind } from '../features/cadFeatureDefinitionTypes';
import { CAD_FEATURE_SHARED_DIAGNOSTICS, cadFeatureDefinition, cadFeatureKinds } from '../features/cadFeatureRegistry';

const FEATURES = 'src/domain/cad/features/', SCHEMA = 'src/domain/cad/cadSchema.ts', KERNEL = 'src/features/cad/kernel/cadKernelModel.ts';
const EVIDENCE = 'src/features/cad/kernel/cadKernelCutEvidence.ts';

/**
 * Functions that evaluate one input feature from its own data: a sketch's contours, solved graph and placement, a curve's geometry and
 * placement. The input's kind reaches each while it is checked, with the same data, so the input is refused before any feature reading
 * it. A consumer's walk stops at them.
 */
const INPUT_EVALUATIONS: Readonly<Record<string, readonly CadFeatureKind[]>> = {
  'src/domain/cad/cadSketchGeometry.ts:resolveCadSketchContours': ['sketch'],
  'src/domain/cad/cadSketchGraphGeometry.ts:compileCadSketchGraph': ['sketch'],
  'src/domain/cad/cadDatumPlanes.ts:resolveCadSketchPlacement': ['sketch', 'curve'],
  'src/domain/cad/cadCurve.ts:resolveCadCurveGeometry': ['curve']
};
/** Codes the walk finds that are no refusal of a feature, and why. */
const NOT_REFUSALS: Readonly<Record<string, string>> = {
  STALE_BUILD: 'A topology snapshot refuses use once disposed. A rebuild selects edges and faces on the snapshot of its own build, before disposing it.'
};

let index: CadSourceIndex;
let options: CadDiagnosticReachOptions;
let kindRoots: (kind: CadFeatureKind) => readonly CadDiagnosticRoot[];
let sharedRoots: Readonly<Record<keyof typeof CAD_FEATURE_SHARED_DIAGNOSTICS, readonly CadDiagnosticRoot[]>>;

beforeAll(() => {
  index = new CadSourceIndex();
  const find = (file: string, test: (node: ts.Node) => boolean): ts.Node[] => {
    const found: ts.Node[] = [];
    const visit = (node: ts.Node) => { if (test(node)) found.push(node); ts.forEachChild(node, visit); };
    visit(index.files.get(file)!);
    return found;
  };
  // A kind's checks: its definition object, whose fields' checks and `check` run while a document is parsed.
  const definitions = [...index.files.keys()].filter(file => file.startsWith(`${FEATURES}kinds/`));
  const definitionOf = (kind: CadFeatureKind) => definitions.flatMap(file => find(file, node => ts.isObjectLiteralExpression(node)
    && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText() === 'kind' && ts.isStringLiteralLike(property.initializer)
      && property.initializer.text === kind)).map(node => ({ file, node })));
  // Its evaluation: the case of the rebuild's switch over feature kinds, or the case it falls through to.
  const [rebuildSwitch] = find(KERNEL, node => ts.isSwitchStatement(node) && node.expression.getText() === 'feature.kind'
    && ts.isBlock(node.parent) && ts.isTryStatement(node.parent.parent)) as ts.SwitchStatement[];
  const clauses = rebuildSwitch.caseBlock.clauses;
  const caseOf = (kind: CadFeatureKind) => {
    const at = clauses.findIndex(clause => ts.isCaseClause(clause) && ts.isStringLiteralLike(clause.expression) && clause.expression.text === kind);
    return at < 0 ? [] : clauses.slice(at).find(clause => clause.statements.length)!.statements.map(node => ({ file: KERNEL, node }));
  };
  kindRoots = kind => [...definitionOf(kind), ...caseOf(kind)];
  // The steps every feature goes through: the parse loop around the kind's own checks, evaluating scalars, and the rebuild around its case.
  const [parseLoop] = find(SCHEMA, node => ts.isForOfStatement(node) && node.expression.getText() === 'document.features'
    && ts.findAncestor(node, ancestor => ts.isFunctionDeclaration(ancestor) && ancestor.name?.text === 'parseCadDocument') !== undefined) as ts.ForOfStatement[];
  const rebuild = rebuildSwitch.parent as ts.Block, attempt = rebuild.parent as ts.TryStatement;
  sharedRoots = {
    parse: [{ file: SCHEMA, node: parseLoop.statement }],
    expressions: index.exported('src/domain/cad/cadExpression.ts', 'evaluateCadScalar', new Set()),
    rebuild: [...rebuild.statements.slice(rebuild.statements.indexOf(rebuildSwitch) + 1), attempt.catchClause!.block].map(node => ({ file: KERNEL, node }))
  };
  // The checks are handed the parse's context object, whose members the parse loop defines.
  const [context] = find(SCHEMA, node => ts.isVariableDeclaration(node) && node.name.getText() === 'context' && node.initializer !== undefined
    && ts.isObjectLiteralExpression(node.initializer)).map(node => (node as ts.VariableDeclaration).initializer!);
  // Material evidence names its codes after the operation its caller passes: Cut for every cut but Pocket's.
  const operations = (walked: ReadonlySet<string>) => [
    ...walked.has(`${EVIDENCE}:cutCadKernelConfirmedMaterial`) ? ['cut'] : [],
    ...[...walked].some(name => name.startsWith('src/features/cad/kernel/cadKernelPocket.ts:')) ? ['pocket'] : []];
  options = {
    templates: { [`${EVIDENCE}: prefix`]: operations, [`${EVIDENCE}: operation.toLowerCase()`]: operations },
    // The catalog leads to every kind; the parse's context to every check it offers, which a kind's walk takes one by one.
    stop: new Set([`${FEATURES}cadFeatureRegistry.ts:catalog`, `${SCHEMA}:context`]),
    receivers: (file, name) => file.startsWith(FEATURES) && name === 'context' ? { file: SCHEMA, node: context } : undefined
  };
}, 60_000);

const sorted = (codes: Iterable<string>) => [...codes].sort();
const shared = () => new Set(Object.values(CAD_FEATURE_SHARED_DIAGNOSTICS).flat());

describe('CAD feature diagnostics', () => {
  it('list the codes of the steps every feature goes through as shared', () => {
    for (const [group, codes] of Object.entries(CAD_FEATURE_SHARED_DIAGNOSTICS)) {
      const reach = cadDiagnosticReach(index, sharedRoots[group as keyof typeof CAD_FEATURE_SHARED_DIAGNOSTICS], options);
      expect(reach.unexpanded, group).toEqual([]);
      expect(sorted(reach.codes), group).toEqual(sorted(codes));
    }
  }, 30_000);

  it.each(cadFeatureKinds())('list every code a %s feature can be refused with by its checks and evaluation', kind => {
    const stop = new Set([...options.stop!, ...Object.entries(INPUT_EVALUATIONS).filter(([, owners]) => !owners.includes(kind)).map(([name]) => name)]);
    const reach = cadDiagnosticReach(index, kindRoots(kind), { ...options, stop });
    expect(reach.unexpanded).toEqual([]);
    const declared = cadFeatureDefinition(kind).diagnostics, common = shared();
    expect(new Set(declared).size, 'listed once').toBe(declared.length);
    expect(sorted(declared)).toEqual(sorted([...reach.codes].filter(code => !common.has(code) && !(code in NOT_REFUSALS))));
    // An input's own kind walks the evaluations other kinds stop at, so their codes are listed there.
    for (const [name, owners] of Object.entries(INPUT_EVALUATIONS)) if (owners.includes(kind)) expect(reach.declarations, name).toContain(name);
  }, 30_000);
});
