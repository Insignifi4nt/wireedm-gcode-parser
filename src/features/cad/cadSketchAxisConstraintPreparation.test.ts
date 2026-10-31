// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { cadSketchConstraintStep, type CadSketchConstraintPick, type CadSketchConstraintTool } from './cadSketchConstraintTool';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
let counter = 0;

/** A sloped line a–b, a level line c–d, a circle around k, an arc around m and a free point q, with `relations` added and `moved` points placed. */
function part(relations: CadSketchGraph['relations'], moved: Readonly<Record<string, [number, number]>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Axis constraints', 'axis-constraints'), schemaVersion: 2, features: [{
    id: 'sketch', name: 'Axes', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
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
// The origin is picked as a point and the axes as edges, by their reserved ids.
const pick = (id: string): CadSketchConstraintPick => ({ kind: ['ab', 'cd', 'ring', 'arc', '@h', '@v'].includes(id) ? 'entity' : 'point', id });

/** Apply what the tool-first command adds for these picks through the native solver, as the workbench does. */
async function constrain(source: CadDocument, tool: CadSketchConstraintTool, ...ids: string[]) {
  const step = cadSketchConstraintStep(graphOf(source), tool, ids.map(pick), () => `r${++counter}`);
  if (step.status !== 'ready') throw new Error(`Expected relations, got ${JSON.stringify(step)}.`);
  const prepared = await prepareCadEdits(source, step.relations.map(relation => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const)), runtime);
  return { step, prepared, document: prepared.document, diagnostics: prepared.sketchDiagnostics[0].diagnostics };
}

describe('constraints with the plane origin and axes, solved natively', () => {
  it('lays a line with one end fixed at the origin on the H axis by constraining only its free end', async () => {
    const source = part([{ id: 'pin', kind: 'fixed-point', pointId: 'a', position: [0, 0] }]);
    const result = await constrain(source, 'coincident', 'ab', '@h');
    expect(result.step.relations).toEqual([expect.objectContaining({ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 })]);
    expect(result.diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    expect(at(result.document, 'b')[1]).toBeCloseTo(0, 9); expect(at(result.document, 'a')).toEqual([0, 0]);
  });

  it('lays a level line, and a line joined to a point on the axis, on the axis without a repeated relation', async () => {
    const level = await constrain(part([{ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }]), 'coincident', '@h', 'cd');
    expect(level.step.relations).toHaveLength(1);
    expect(level.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    for (const id of ['c', 'd']) expect(at(level.document, id)[1]).toBeCloseTo(0, 9);
    const joined = await constrain(part([{ id: 'j', kind: 'coincident', pointIds: ['d', 'q'] }, { id: 'qy', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 0 }], { d: [-8, 0], q: [-8, 0] }), 'coincident', 'cd', '@h');
    expect(joined.step.relations).toEqual([expect.objectContaining({ pointId: 'c', axis: 'y' })]);
    expect(joined.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(joined.document, 'c')[1]).toBeCloseTo(0, 9);
  });

  it('counts an endpoint whose coordinate expression is zero, and a line level through a joined point, as already on the axis', async () => {
    const written = await constrain(part([], { a: [0, '0'] as unknown as [number, number] }), 'coincident', 'ab', '@h');
    expect(written.step.relations).toEqual([expect.objectContaining({ kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 })]);
    expect(written.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(written.document, 'b')[1]).toBeCloseTo(0, 9);
    // a joins q and q–b is horizontal, so a–b is already level and one endpoint lays it on the axis.
    const aliased = await constrain(part([{ id: 'j', kind: 'coincident', pointIds: ['a', 'q'] }, { id: 'h', kind: 'horizontal', pointIds: ['q', 'b'] }], { q: [0, 0], b: [10, 0] }), 'coincident', '@h', 'ab');
    expect(aliased.step.relations).toHaveLength(1);
    expect(aliased.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    for (const id of ['a', 'b']) expect(at(aliased.document, id)[1]).toBeCloseTo(0, 9);
  });

  it('adds only the coordinates value-free relations leave free, in one submission the solver accepts', async () => {
    // a–b is level only through Parallel with the horizontal c–d, so one endpoint fix lays it on the axis.
    const parallel = await constrain(part([{ id: 'h', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'p', kind: 'parallel', lineIds: ['ab', 'cd'] }], { a: [0, 3], b: [10, 3] }), 'coincident', 'ab', '@h');
    expect(parallel.step.relations).toEqual([expect.objectContaining({ pointId: 'a', axis: 'y' })]);
    expect(parallel.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    for (const id of ['a', 'b']) expect(at(parallel.document, id)[1]).toBeCloseTo(0, 9);
    // a lies on c–d, which is on the H axis, so only b needs fixing.
    const onAxisLine: Readonly<Record<string, [number, number]>> = { c: [-20, 0], d: [-8, 0], a: [-14, 0] };
    const axisLine: CadSketchGraph['relations'] = [{ id: 'cy', kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 0 }, { id: 'dy', kind: 'fixed-axis', pointId: 'd', axis: 'y', value: 0 }];
    const throughLine = await constrain(part([...axisLine, { id: 'on', kind: 'point-on-line', pointId: 'a', lineId: 'cd' }], onAxisLine), 'coincident', '@h', 'ab');
    expect(throughLine.step.relations).toEqual([expect.objectContaining({ pointId: 'b', axis: 'y' })]);
    expect(throughLine.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(throughLine.document, 'b')[1]).toBeCloseTo(0, 9); expect(at(throughLine.document, 'a')[1]).toBeCloseTo(0, 9);
    // q lies on a line along the V axis, so placing it at the origin adds only its Y.
    const atOrigin = await constrain(part([{ id: 'cx', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 0 }, { id: 'dx', kind: 'fixed-axis', pointId: 'd', axis: 'x', value: 0 },
      { id: 'onq', kind: 'point-on-line', pointId: 'q', lineId: 'cd' }], { c: [0, 7], d: [0, 19], q: [0, 9] }), 'coincident', 'q', '@origin');
    expect(atOrigin.step.relations).toEqual([expect.objectContaining({ pointId: 'q', axis: 'y' })]);
    expect(atOrigin.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(atOrigin.document, 'q').map(value => Math.abs(value))).toEqual([expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    // A line free of the axis takes both fixes at once, and a line already on it through such relations is reported, not repeated.
    const free = await constrain(part([]), 'coincident', 'ab', '@h');
    expect(free.step.relations).toHaveLength(2); expect(free.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    const held = part([...axisLine, { id: 'on', kind: 'point-on-line', pointId: 'a', lineId: 'cd' }, { id: 'p', kind: 'parallel', lineIds: ['ab', 'cd'] }], { ...onAxisLine, b: [10, 0] });
    expect(cadSketchConstraintStep(graphOf(held), 'coincident', [pick('ab'), pick('@h')], () => `r${++counter}`)).toEqual({ status: 'invalid', reason: 'This line is already on the H axis.' });
  });

  it('rejects a fix that dimensions only happen to repeat, so a later dimension edit cannot silently break it', async () => {
    // q lies on a fixed circle of radius 3 through the origin. At the origin its X fix repeats the circle locally, but a radius of
    // 4 would keep Y = 0 with q at (−1, 0), so the request is reported as redundant instead of being applied without its X.
    const hub: CadSketchGraph['relations'] = [{ id: 'hub', kind: 'fixed-point', pointId: 'k', position: [3, 0] }, { id: 'size', kind: 'radial-size', entityId: 'ring', quantity: 'radius', value: 3 },
      { id: 'on', kind: 'point-on-curve', pointId: 'q', curveId: 'ring' }];
    for (const q of [[0, 0], [6, 0]] as [number, number][]) {
      const source = part(hub, { k: [3, 0], q });
      const step = cadSketchConstraintStep(graphOf(source), 'coincident', [pick('q'), pick('@origin')], () => `r${++counter}`);
      expect(step).toMatchObject({ status: 'ready', relations: [{ pointId: 'q', axis: 'x' }, { pointId: 'q', axis: 'y' }] });
      await expect(constrain(source, 'coincident', 'q', '@origin')).rejects.toSatisfy(error => error instanceof CadSketchPreparationError && error.feedback.reason === 'redundant');
    }
  });

  it('asks to detach a linked reference that holds an end on the axis only until its source moves', async () => {
    // A layout line at Y = lift, linked into the sketch, holds a on the H axis while lift is 0. Counting that would add only b's fix,
    // and lift = 5 would then carry a off the axis with the edit accepted, so the step asks to detach the reference instead.
    const source = parseCadDocument({ ...createCadDocument('Linked axis', 'linked-axis'), schemaVersion: 2, parameters: { lift: 0 }, features: [
      { id: 'layout', kind: 'sketch', name: 'Layout', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 's', position: [0, ' lift '] }, { id: 'e', position: [10, ' lift '] }],
        entities: [{ id: 'line', kind: 'line', startPointId: 's', endPointId: 'e', construction: true }], relations: [] } },
      { id: 'sketch', kind: 'sketch', name: 'Axes', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [5, 0] }, { id: 'b', position: [12, 6] }],
        entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] } }] });
    const linked = (await prepareCadEdits(source, [{ kind: 'use-sketch-entity', sketchId: 'sketch', sourceSketchId: 'layout', sourceEntityId: 'line', idPrefix: 'ref' }], runtime)).document;
    const sketchOf = (document: CadDocument) => { const sketch = document.features[1]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch.'); return sketch.graph; };
    const reference = sketchOf(linked).entities.find(entity => entity.kind === 'line' && entity.id !== 'ab');
    if (reference?.kind !== 'line') throw new Error('Missing reference line.');
    const reason = 'An endpoint of this line follows a linked reference that its source sketch can move off the H axis. Detach it first.';
    for (const relation of [{ id: 'on', kind: 'point-on-line', pointId: 'a', lineId: reference.id }, { id: 'join', kind: 'coincident', pointIds: ['a', reference.startPointId] }] as const) {
      const held = (await prepareCadEdits(linked, [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation }], runtime)).document;
      expect(cadSketchConstraintStep(sketchOf(held), 'coincident', [pick('ab'), pick('@h')], () => `r${++counter}`)).toEqual({ status: 'invalid', reason });
      // What counting it would have applied: b alone on the axis, which the source then moves a away from.
      const partial = await prepareCadEdits(held, [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'by', kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 } }], runtime);
      const lifted = (await prepareCadEdits(partial.document, [{ kind: 'set-parameter', name: 'lift', value: 5 }], runtime)).document;
      const position = (id: string) => sketchOf(lifted).points.find(point => point.id === id)!.position.map(Number);
      expect(position('a')[1]).toBeCloseTo(5, 9); expect(position('b')[1]).toBeCloseTo(0, 9);
    }
  });

  it('keeps the center of a circle or arc on an axis, and the arc ends follow', async () => {
    const circle = await constrain(part([]), 'coincident', 'ring', '@h');
    expect(circle.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    expect(at(circle.document, 'k')[1]).toBeCloseTo(0, 9);
    const arc = await constrain(part([]), 'coincident', '@v', 'arc');
    expect(arc.diagnostics).toMatchObject({ status: 'success', redundantIds: [], issues: [] });
    const [center, start, end] = ['m', 's', 'e'].map(id => at(arc.document, id));
    expect(center[0]).toBeCloseTo(0, 9);
    expect(Math.hypot(start[0] - center[0], start[1] - center[1])).toBeCloseTo(Math.hypot(end[0] - center[0], end[1] - center[1]), 9);
  });
});
