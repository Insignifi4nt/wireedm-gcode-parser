// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { measureCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { prepareCadEdits } from './cadEditPreparation';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const set = (relation: CadSketchGraphRelation) => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const);
const gap = (value: number | string) => ({ id: 'gap', kind: 'point-line-distance', pointId: 'p', lineId: 'base', value } as const);

function part(graph: object): CadDocument {
  return parseCadDocument({ ...createCadDocument('Line distances', 'line-distances'), schemaVersion: 2, parameters: { depth: 6 }, features: [{
    id: 'sketch', name: 'Distances', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
}
/** A driven 20 mm base line at `origin`, optionally reversed, and a free point 4 mm to the given side of it. */
function based(origin: readonly [number, number], reversed: boolean, side: 1 | -1): CadDocument {
  const [x, y] = origin;
  return part({ points: [{ id: 'a', position: [String(x), String(y)] }, { id: 'b', position: [String(x + 20), String(y)] }, { id: 'p', position: [x + 5, y + side * 4] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: reversed ? 'b' : 'a', endPointId: reversed ? 'a' : 'b' }], relations: [] });
}
function graphOf(document: CadDocument) {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch fixture.'); return sketch.graph;
}
const position = (document: CadDocument, id: string) => graphOf(document).points.find(point => point.id === id)!.position.map(Number);

describe('prepared point to line distance', () => {
  it.each([
    { origin: [0, 0], reversed: false, side: 1 }, { origin: [0, 0], reversed: true, side: 1 }, { origin: [0, 0], reversed: false, side: -1 },
    { origin: [0, 0], reversed: true, side: -1 }, { origin: [1e6, -2e6], reversed: true, side: -1 }, { origin: [-3e6, 1e6], reversed: false, side: 1 }
  ] as const)('holds the point on its starting side through value edits and drags across: %o', async ({ origin, reversed, side }) => {
    const source = based(origin, reversed, side), digits = origin[0] ? 6 : 9;
    const added = await prepareCadEdits(source, [set(gap(4))], runtime);
    expect(added.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], issues: [] });
    const offset = (document: CadDocument) => position(document, 'p')[1] - origin[1];
    // A value edit and an expression move the point away from the line on the side it is on.
    const edited = await prepareCadEdits(added.document, [set(gap(9))], runtime);
    expect(offset(edited.document)).toBeCloseTo(side * 9, digits);
    const driven = await prepareCadEdits(edited.document, [set(gap(' depth '))], runtime);
    expect(offset(driven.document)).toBeCloseTo(side * 6, digits);
    // A drag across the line slides the point along its side instead of flipping it over.
    const p = position(driven.document, 'p');
    const dragged = await prepareCadEdits(driven.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'p', translation: [3, -side * 30] }], runtime);
    expect(offset(dragged.document)).toBeCloseTo(side * 6, digits);
    expect(position(dragged.document, 'p')[0]).toBeCloseTo(p[0] + 3, digits);
    expect(checkCadSketchGraph(graphOf(dragged.document), dragged.document.parameters)).toEqual([]);
    expect(graphOf(dragged.document).relations).toEqual([gap(' depth ')]);
  });

  it('measures as a reference without driving the point', async () => {
    const measured = { id: 'measured', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'p', lineId: 'base' } } as const;
    const added = await prepareCadEdits(based([0, 0], false, 1), [set(measured)], runtime);
    expect(added.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 2, issues: [] });
    const dragged = await prepareCadEdits(added.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'p', translation: [1, -11] }], runtime);
    expect(position(dragged.document, 'p')).toEqual([6, -7]);
    expect(measureCadSketchReferenceDimension(graphOf(dragged.document), {}, measured)).toBe(7);
  });

  it('judges a parallel between two vertical lines redundant, and holds their distance without it', async () => {
    const source = part({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [0, 10] }, { id: 'c', position: [10, 0] }, { id: 'd', position: [10, 10] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'other', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'up', kind: 'vertical', pointIds: ['a', 'b'] }, { id: 'up-too', kind: 'vertical', pointIds: ['c', 'd'] }] });
    const distance = { id: 'gap', kind: 'point-line-distance', pointId: 'c', lineId: 'base', value: 10 } as const;
    const failure = await prepareCadEdits(source, [set(distance), set({ id: 'parallel', kind: 'parallel', lineIds: ['base', 'other'] })], runtime).catch(error => error);
    expect(failure).toBeInstanceOf(CadSketchPreparationError);
    if (!(failure instanceof CadSketchPreparationError)) throw failure;
    const subjects = failure.feedback.subjects.filter(subject => subject.source.kind === 'relation' && subject.source.id === 'parallel');
    expect(subjects.map(subject => subject.category)).toContainEqual(expect.stringMatching(/redundant/));
    expect(subjects.some(subject => subject.category === 'conflicting')).toBe(false);
    const held = await prepareCadEdits(source, [set(distance)], runtime);
    expect(held.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], issues: [] });
    const wider = await prepareCadEdits(held.document, [set({ ...distance, value: 15 })], runtime);
    expect(position(wider.document, 'c')[0] - position(wider.document, 'a')[0]).toBeCloseTo(15, 9);
    expect(position(wider.document, 'd')[0] - position(wider.document, 'a')[0]).toBeCloseTo(15, 9);
  });
});
