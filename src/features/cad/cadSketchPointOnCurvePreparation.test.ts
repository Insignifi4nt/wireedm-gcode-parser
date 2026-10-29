// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadSketchTrim } from '@/domain/cad/cadSketchTrimExtend';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
const onArc = { id: 'on-arc', kind: 'point-on-curve', pointId: 'p', curveId: 'arc' } as const;
const onRing = { id: 'on-ring', kind: 'point-on-curve', pointId: 'q', curveId: 'ring' } as const;
const set = (relation: typeof onArc | typeof onRing) => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation } as const);

/** A quarter arc of radius `span` with a free end, a free ring of radius `ringRadius`, and a free point beside each. */
function curvesPart(): CadDocument {
  return parseCadDocument({ ...createCadDocument('Points on curves', 'points-on-curves'), schemaVersion: 2, parameters: { span: 10, ringRadius: 5 }, features: [{
    id: 'sketch', name: 'Curves', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'o', position: ['0', '0'] }, { id: 's', position: ['span', '0'] }, { id: 'e', position: [0, 10] },
        { id: 'p', position: [6, 8] }, { id: 'c', position: [30, 0] }, { id: 'q', position: [30, 5] }],
      entities: [{ id: 'arc', kind: 'arc', construction: true, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw' },
        { id: 'ring', kind: 'circle', construction: false, centerPointId: 'c', radius: 'ringRadius' }], relations: []
    }
  }] });
}
function graphOf(document: CadDocument) {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing curve fixture.'); return sketch.graph;
}
const position = (document: CadDocument, id: string) => graphOf(document).points.find(point => point.id === id)!.position.map(Number);
const distance = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('prepared point on a curve', () => {
  it('removes exactly one freedom per relation and keeps the point on the full circle through drags, moves and resizes', async () => {
    const source = curvesPart(), baseline = await runtime.solve({ graph: graphOf(source), parameters: source.parameters });
    expect(baseline.diagnostics.degreesOfFreedom).toBe(7);
    const arc = await prepareCadEdits(source, [set(onArc)], runtime);
    expect(arc.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 6, issues: [] });
    const both = await prepareCadEdits(arc.document, [set(onRing)], runtime);
    expect(both.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 5, conflictingIds: [], redundantIds: [], issues: [] });
    // A drag far past the arc's end still lands on its circle.
    const p = position(both.document, 'p');
    const dragged = await prepareCadEdits(both.document, [{ kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'p', translation: [-20 - p[0], -20 - p[1]] }], runtime);
    const moved = position(dragged.document, 'p');
    expect(distance(moved, [0, 0])).toBeCloseTo(10, 9); expect(moved[0]).toBeCloseTo(moved[1], 9); expect(moved[0]).toBeLessThan(0);
    // The arc's radius and the ring's center and radius carry their points along.
    const c = position(dragged.document, 'c');
    const changed = await prepareCadEdits(dragged.document, [{ kind: 'set-parameter', name: 'span', value: 14 }, { kind: 'set-parameter', name: 'ringRadius', value: 7 },
      { kind: 'move-sketch-point', sketchId: 'sketch', pointId: 'c', translation: [40 - c[0], 10 - c[1]] }], runtime);
    expect(changed.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', degreesOfFreedom: 5, issues: [] });
    expect(distance(position(changed.document, 'p'), [0, 0])).toBeCloseTo(14, 9);
    expect(distance(position(changed.document, 'q'), position(changed.document, 'c'))).toBeCloseTo(7, 9);
    expect(checkCadSketchGraph(graphOf(changed.document), changed.document.parameters)).toEqual([]);
    expect(graphOf(changed.document).points.slice(0, 2)).toEqual(graphOf(source).points.slice(0, 2));
    expect(distance(position(changed.document, 'e'), [0, 0])).toBeCloseTo(14, 9);
    expect(graphOf(changed.document).relations).toEqual([onArc, onRing]);
  });

  it('keeps a trim cut on its arc cutter while that arc later grows', async () => {
    const base = curvesPart(), graph = graphOf(base);
    // A line crosses the quarter arc at 30°; trimming its far end cuts there.
    const source = parseCadDocument({ ...base, features: [{ ...base.features[0], graph: { ...graph,
      points: [...graph.points, { id: 'a', position: [-5, 5] }, { id: 'b', position: [20, 5] }],
      entities: [...graph.entities, { id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }] } }] });
    const prepared = prepareCadSketchTrim({ graph: graphOf(source), parameters: source.parameters, entityId: 'edge', parameter: .9 });
    if (prepared.target.kind !== 'end' || !('attachment' in prepared)) throw new Error('Expected end trim.');
    expect(prepared.attachment).toEqual({ kind: 'point-on-curve', curveId: 'arc' });
    const trim = { ...prepared.target, cutPointId: 'cut', attachRelationId: 'cut-on-arc' };
    const trimmed = await prepareCadEdits(source, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime);
    expect(graphOf(trimmed.document).relations).toEqual([{ id: 'cut-on-arc', kind: 'point-on-curve', pointId: 'cut', curveId: 'arc' }]);
    expect(distance(position(trimmed.document, 'cut'), [Math.sqrt(75), 5])).toBeLessThan(1e-9);
    const grown = await prepareCadEdits(trimmed.document, [{ kind: 'set-parameter', name: 'span', value: 12 }], runtime);
    expect(distance(position(grown.document, 'cut'), [0, 0])).toBeCloseTo(12, 9);
    expect(checkCadSketchGraph(graphOf(grown.document), grown.document.parameters)).toEqual([]);
  });
});
