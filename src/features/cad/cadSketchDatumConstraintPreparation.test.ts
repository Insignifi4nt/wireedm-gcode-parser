// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { cadSketchConstraintStep, type CadSketchConstraintPick, type CadSketchConstraintTool } from './cadSketchConstraintTool';
import { cadSketchRelationsHold, submitCadSketchRelationsWithoutRepeats } from './cadSketchInferenceFallback';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
let counter = 0;

/** A sloped line a–b, a level line c–d, a circle around k, an arc around m and a free point q, with `relations` added and `moved` points placed. */
function part(relations: CadSketchGraph['relations'], moved: Readonly<Record<string, [number, number]>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Datum constraints', 'datum-constraints'), schemaVersion: 2, features: [{
    id: 'sketch', name: 'Datums', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 5] }, { id: 'c', position: [-20, 7] }, { id: 'd', position: [-8, 7] },
        { id: 'k', position: [5, -12] }, { id: 'm', position: [30, 20] }, { id: 's', position: [36, 20] }, { id: 'e', position: [30, 26] }, { id: 'q', position: [-40, 9] }]
        .map(point => ({ ...point, position: moved[point.id] ?? point.position })),
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'ring', kind: 'circle', construction: false, centerPointId: 'k', radius: 3 },
        { id: 'arc', kind: 'arc', construction: false, centerPointId: 'm', startPointId: 's', endPointId: 'e', direction: 'ccw' }],
      relations
    }
  }] });
}
const graphOf = (document: CadDocument) => { const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch.'); return sketch.graph; };
const at = (document: CadDocument, id: string) => graphOf(document).points.find(point => point.id === id)!.position.map(Number);
const pick = (id: string): CadSketchConstraintPick => id === 'origin' || id === 'x-axis' || id === 'y-axis' ? { kind: 'datum', id } : { kind: ['ab', 'cd', 'ring', 'arc'].includes(id) ? 'entity' : 'point', id };

/** Apply what the tool-first command adds for these picks through the native solver, as the workbench does. */
async function constrain(source: CadDocument, tool: CadSketchConstraintTool, ...ids: string[]) {
  const step = cadSketchConstraintStep(graphOf(source), tool, ids.map(pick), () => `r${++counter}`);
  if (step.status !== 'ready') throw new Error(`Expected relations, got ${JSON.stringify(step)}.`);
  const prepared = await prepareCadEdits(source, step.relations.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const)), runtime);
  return { step, prepared, document: prepared.document, diagnostics: prepared.sketchDiagnostics[0].diagnostics };
}

/** Submit the same relations as the workbench does, retrying without optional ones the solver finds repeated. */
async function constrainAsWorkbench(source: CadDocument, tool: CadSketchConstraintTool, ...ids: string[]) {
  const step = cadSketchConstraintStep(graphOf(source), tool, ids.map(pick), () => `r${++counter}`), submitted: string[][] = [];
  if (step.status !== 'ready') throw new Error(`Expected relations, got ${JSON.stringify(step)}.`);
  const edits = (relations: readonly CadSketchGraph['relations'][number][]) => relations.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const));
  const prepared = await submitCadSketchRelationsWithoutRepeats({ relations: step.relations, optionalIds: step.optional ?? [], current: () => true,
    holds: async (kept, dropped) => cadSketchRelationsHold((await prepareCadEdits(source, edits(kept), runtime)).document, 'sketch', dropped),
    submit: relations => { submitted.push(relations.map(relation => relation.id)); return prepareCadEdits(source, edits(relations), runtime); } });
  return { step, submitted, document: prepared.document, diagnostics: prepared.sketchDiagnostics[0].diagnostics };
}

describe('constraints with the plane origin and axes, solved natively', () => {
  it('lays a line with one end fixed at the origin on the X axis by constraining only its free end', async () => {
    const source = part([{ id: 'pin', kind: 'fixed-point', pointId: 'a', position: [0, 0] }]);
    const result = await constrain(source, 'coincident', 'ab', 'x-axis');
    expect(result.step.relations).toEqual([expect.objectContaining({ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 })]);
    expect(result.diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    expect(at(result.document, 'b')[1]).toBeCloseTo(0, 9); expect(at(result.document, 'a')).toEqual([0, 0]);
  });

  it('lays a level line, and a line joined to a point on the axis, on the axis without a repeated relation', async () => {
    const level = await constrain(part([{ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }]), 'coincident', 'x-axis', 'cd');
    expect(level.step.relations).toHaveLength(1);
    expect(level.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    for (const id of ['c', 'd']) expect(at(level.document, id)[1]).toBeCloseTo(0, 9);
    const joined = await constrain(part([{ id: 'j', kind: 'coincident', pointIds: ['d', 'q'] }, { id: 'qy', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 0 }], { d: [-8, 0], q: [-8, 0] }), 'coincident', 'cd', 'x-axis');
    expect(joined.step.relations).toEqual([expect.objectContaining({ pointId: 'c', axis: 'y' })]);
    expect(joined.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(joined.document, 'c')[1]).toBeCloseTo(0, 9);
  });

  it('counts an endpoint whose coordinate expression is zero, and a line level through a joined point, as already on the axis', async () => {
    const written = await constrain(part([], { a: [0, '0'] as unknown as [number, number] }), 'coincident', 'ab', 'x-axis');
    expect(written.step.relations).toEqual([expect.objectContaining({ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 })]);
    expect(written.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(written.document, 'b')[1]).toBeCloseTo(0, 9);
    // a joins q and q–b is horizontal, so a–b is already level and one endpoint lays it on the axis.
    const aliased = await constrain(part([{ id: 'j', kind: 'coincident', pointIds: ['a', 'q'] }, { id: 'h', kind: 'horizontal', pointIds: ['q', 'b'] }], { q: [0, 0], b: [10, 0] }), 'coincident', 'x-axis', 'ab');
    expect(aliased.step.relations).toHaveLength(1);
    expect(aliased.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    for (const id of ['a', 'b']) expect(at(aliased.document, id)[1]).toBeCloseTo(0, 9);
  });

  it('drops a coordinate the sketch already holds through relations the tool does not trace, and keeps the rest', async () => {
    // a–b is level only through Parallel with the horizontal c–d, so the second endpoint fix repeats the first.
    const parallel = await constrainAsWorkbench(part([{ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'p', kind: 'parallel', lineIds: ['ab', 'cd'] }], { a: [0, 3], b: [10, 3] }), 'coincident', 'ab', 'x-axis');
    expect(parallel.step).toMatchObject({ relations: [{ pointId: 'a' }, { pointId: 'b' }], optional: parallel.step.relations.map(relation => relation.id) });
    expect(parallel.submitted).toEqual([parallel.step.relations.map(relation => relation.id), [parallel.step.relations[0].id]]);
    expect(parallel.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    for (const id of ['a', 'b']) expect(at(parallel.document, id)[1]).toBeCloseTo(0, 9);
    // a lies on c–d, which is on the X axis, so only b needs fixing.
    const onAxisLine: Readonly<Record<string, [number, number]>> = { c: [-20, 0], d: [-8, 0], a: [-14, 0] };
    const throughLine = await constrainAsWorkbench(part([{ id: 'cy', kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 0 }, { id: 'dy', kind: 'fixed-axis', pointId: 'd', axis: 'y', value: 0 },
      { id: 'on', kind: 'point-on-line', pointId: 'a', lineId: 'cd' }], onAxisLine), 'coincident', 'x-axis', 'ab');
    expect(throughLine.submitted.at(-1)).toEqual([throughLine.step.relations[1].id]);
    expect(at(throughLine.document, 'b')[1]).toBeCloseTo(0, 9); expect(at(throughLine.document, 'a')[1]).toBeCloseTo(0, 9);
    // q lies on a line along the Y axis, so placing it at the origin adds only its Y.
    const atOrigin = await constrainAsWorkbench(part([{ id: 'cx', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 0 }, { id: 'dx', kind: 'fixed-axis', pointId: 'd', axis: 'x', value: 0 },
      { id: 'onq', kind: 'point-on-line', pointId: 'q', lineId: 'cd' }], { c: [0, 7], d: [0, 19], q: [0, 9] }), 'coincident', 'q', 'origin');
    expect(atOrigin.submitted.at(-1)).toEqual([atOrigin.step.relations.find(relation => relation.kind === 'fixed-axis' && relation.axis === 'y')!.id]);
    expect(at(atOrigin.document, 'q').map(value => Math.abs(value))).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    // A line free of the axis takes both fixes at once, and a line already on it through such relations still reports the repeat.
    const free = await constrainAsWorkbench(part([]), 'coincident', 'ab', 'x-axis');
    expect(free.submitted).toHaveLength(1); expect(free.step.relations).toHaveLength(2);
    const repeated = constrainAsWorkbench(part([{ id: 'cy', kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 0 }, { id: 'dy', kind: 'fixed-axis', pointId: 'd', axis: 'y', value: 0 },
      { id: 'on', kind: 'point-on-line', pointId: 'a', lineId: 'cd' }, { id: 'p', kind: 'parallel', lineIds: ['ab', 'cd'] }], { ...onAxisLine, b: [10, 0] }), 'coincident', 'ab', 'x-axis');
    await expect(repeated).rejects.toSatisfy(error => error instanceof CadSketchPreparationError && error.feedback.reason === 'redundant');
  });

  it('keeps the first rejection when the coordinate the solver calls repeated would not hold without it', async () => {
    // q lies on a fixed circle through the origin. Its X fix depends on the circle where the circle meets the Y = 0 line, yet Y = 0
    // alone also holds q where it is, at (6, 0) on the far side.
    const source = part([{ id: 'hub', kind: 'fixed-point', pointId: 'k', position: [3, 0] }, { id: 'size', kind: 'radial-size', entityId: 'ring', quantity: 'radius', value: 3 },
      { id: 'on', kind: 'point-on-curve', pointId: 'q', curveId: 'ring' }], { k: [3, 0], q: [6, 0] });
    await expect(constrainAsWorkbench(source, 'coincident', 'q', 'origin')).rejects.toSatisfy(error => error instanceof CadSketchPreparationError && error.feedback.reason === 'redundant');
    // Without the check the reduced Y fix is accepted with q still at (6, 0).
    const step = cadSketchConstraintStep(graphOf(source), 'coincident', [pick('q'), pick('origin')], () => `r${++counter}`);
    if (step.status !== 'ready') throw new Error('Expected relations.');
    const onlyY = step.relations.filter(relation => relation.kind === 'fixed-axis' && relation.axis === 'y');
    const reduced = await prepareCadEdits(source, onlyY.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const)), runtime);
    expect(at(reduced.document, 'q').map(value => Math.round(value * 1e9) / 1e9 + 0)).toEqual([6, 0]);
  });

  it('keeps the center of a circle or arc on an axis, and the arc ends follow', async () => {
    const circle = await constrain(part([]), 'coincident', 'ring', 'x-axis');
    expect(circle.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(circle.document, 'k')[1]).toBeCloseTo(0, 9);
    const arc = await constrain(part([]), 'coincident', 'y-axis', 'arc');
    expect(arc.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    const [center, start, end] = ['m', 's', 'e'].map(id => at(arc.document, id));
    expect(center[0]).toBeCloseTo(0, 9);
    expect(Math.hypot(start[0] - center[0], start[1] - center[1])).toBeCloseTo(Math.hypot(end[0] - center[0], end[1] - center[1]), 9);
  });
});
