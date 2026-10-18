import { describe, expect, it } from 'vitest';
import { placeCadSketchGraph } from '../cadSketchPlacement';
import { parseCadSketchGraph, checkCadSketchGraph } from '../cadSketchGraph';
import { applyCadEdits } from '../cadOperations';
import { createCadSketchCornerTreatment } from '../cadSketchCornerTreatment';
import { circleRow, circleRowPart, rowSketch } from './cadSketchLinearPatternFixtures';
import { lineReferencePart } from './cadSketchExternalReferenceFixtures';
import { dPlacement, placementPart, placementSketch, placementMixedGraph } from './cadSketchPlacementFixtures';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';

describe('exact selected sketch placement', () => {
  it('places a major D by cardinal signed permutation through the ordinary edit while preserving every other source field', () => {
    const source = placementPart(), old = placementSketch(source), before = JSON.stringify(source);
    const result = applyCadEdits(source, [{ kind: 'place-sketch-geometry', sketchId: 'sketch', ...dPlacement }]), next = placementSketch(result);
    expect(next.graph.points.map(point => point.position)).toEqual([[30, 20], [24, 12], [24, 28], [100, 100]]);
    expect({ ...next, graph: old.graph }).toEqual(old); expect(next.graph.entities).toEqual(old.graph.entities);
    expect(result.features[0]).toEqual(source.features[0]); expect(JSON.stringify(source)).toBe(before);
    expect(checkCadSketchGraph(next.graph, source.parameters)).toEqual([]);
  });
  it('retains coordinate strings and fixed axes exactly when that evaluated component stays unchanged', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'p', position: [' 0e0 ', 2] }], entities: [], relations: [
      { id: 'fixed-x', kind: 'fixed-axis', pointId: 'p', axis: 'x', value: ' 0 ' }] });
    const request = { selections: [{ kind: 'point', id: 'p' }], anchor: [0, 0], target: [0, 0], angleDegrees: 180 } as const;
    expect(placeCadSketchGraph({ graph, parameters: {}, ...request }).points[0].position).toEqual([' 0e0 ', -2]);
    expect(() => placeCadSketchGraph({ graph, parameters: {}, ...request, angleDegrees: 90 })).toThrowError(expect.objectContaining({ code: 'dependent-sketch-placement', pointIds: ['p'] }));
    const numeric = parseCadSketchGraph({ ...graph, points: [{ id: 'p', position: [0, 2] }] });
    expect(() => placeCadSketchGraph({ graph: numeric, parameters: {}, ...request, angleDegrees: 90 })).toThrowError(expect.objectContaining({ relationIds: ['fixed-x'] }));
  });
  it('handles pivot rotation, zero-angle anchor translation and exact full-turn no-op without a near-angle threshold', () => {
    const graph = placementSketch(placementPart()).graph;
    expect(placeCadSketchGraph({ graph, parameters: {}, ...dPlacement, target: [0, 0] }).points.slice(0, 3).map(point => point.position)).toEqual([[0, 0], [-6, -8], [-6, 8]]);
    expect(placeCadSketchGraph({ graph, parameters: {}, ...dPlacement, angleDegrees: 0 }).points[1].position).toEqual([22, 26]);
    expect(placeCadSketchGraph({ graph, parameters: {}, ...dPlacement, target: [0, 0], angleDegrees: -720 })).toBe(graph);
    for (const selections of [[], [{ kind: 'entity', id: 'missing' }], [dPlacement.selections[0], dPlacement.selections[0]]] as const)
      expect(() => placeCadSketchGraph({ graph, parameters: {}, ...dPlacement, selections, angleDegrees: 360, target: [0, 0] })).toThrow();
    expect(placeCadSketchGraph({ graph, parameters: {}, selections: [{ kind: 'point', id: 'outside' }], anchor: [0, 0], target: [0, 0], angleDegrees: -1e-8 }).points.at(-1)?.position[1]).not.toBe(100);
  });
  it('requires actual entity atoms, preserves a stationary shared pivot, and never expands Coincident aliases', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 5] }], entities: [
      { id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'ac', kind: 'line', startPointId: 'a', endPointId: 'c', construction: true }], relations: [] });
    const request = { anchor: [0, 0], target: [0, 0], angleDegrees: 90 } as const;
    expect(placeCadSketchGraph({ graph, parameters: {}, ...request, selections: [{ kind: 'entity', id: 'ab' }] }).points.map(point => point.position)).toEqual([[0, 0], [0, 10], [0, 5]]);
    expect(() => placeCadSketchGraph({ graph, parameters: {}, ...request, selections: [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }] }))
      .toThrowError(expect.objectContaining({ entityIds: ['ab'], pointIds: ['b'] }));
    expect(() => placeCadSketchGraph({ graph, parameters: {}, ...request, target: [2, 0], selections: [{ kind: 'entity', id: 'ab' }] }))
      .toThrowError(expect.objectContaining({ entityIds: ['ac'], pointIds: ['a'] }));
    const aliased = parseCadSketchGraph({ ...graph, points: [...graph.points, { id: 'alias', position: [10, 0] }], relations: [{ id: 'join', kind: 'coincident', pointIds: ['b', 'alias'] }] });
    expect(() => placeCadSketchGraph({ graph: aliased, parameters: {}, ...request, selections: [{ kind: 'entity', id: 'ab' }] }))
      .toThrowError(expect.objectContaining({ relationIds: ['join'], pointIds: ['b', 'alias'] }));
    expect(placeCadSketchGraph({ graph: aliased, parameters: {}, ...request, selections: [{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'alias' }] }).points.at(-1)?.position).toEqual([0, 10]);
  });
  it.each(['fillet', 'chamfer'] as const)('includes the virtual %s corner only for the explicit complete treatment selection', kind => {
    let next = 0;
    const graph = createCadSketchCornerTreatment({ graph: parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] }, { id: 'a', position: [20, 0] }, { id: 'b', position: [0, 20] }], entities: [
      { id: 'a-line', kind: 'line', startPointId: 'v', endPointId: 'a', construction: false },
      { id: 'b-line', kind: 'line', startPointId: 'v', endPointId: 'b', construction: false }], relations: [] }),
      parameters: {}, pointId: 'v', treatment: kind === 'fillet' ? { kind, radius: 2 } : { kind, setbacks: [2, 3] }, createId: () => `corner_${++next}` }).graph;
    const placed = placeCadSketchGraph({ graph, parameters: {}, anchor: [0, 0], target: [5, 7], angleDegrees: 90,
      selections: graph.entities.map(entity => ({ kind: 'entity', id: entity.id })) });
    expect(placed.points.find(point => point.id === 'v')?.position).toEqual([5, 7]);
    expect(checkCadSketchGraph(placed, {})).toEqual([]); expect(placed.relations).toEqual(graph.relations);
  });
  it('blocks both pattern seed and member ownership, and linked source supports, with their real relations', () => {
    const row = rowSketch(applyCadEdits(circleRowPart(), [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: circleRow }]));
    for (const id of ['seed', 'holes_i1_e0']) expect(() => placeCadSketchGraph({ graph: row.graph, parameters: { pitch: 15, diameter: 6 }, selections: [{ kind: 'entity', id }], anchor: [0, 0], target: [1, 0], angleDegrees: 0 }))
      .toThrowError(expect.objectContaining({ relationIds: ['row'] }));
    const linked = lineReferencePart(true).features[1]; if (linked.kind !== 'sketch' || !linked.graph) throw new Error('Missing link.');
    const linkedGraph = linked.graph;
    expect(() => placeCadSketchGraph({ graph: linkedGraph, parameters: { span: 40 }, selections: [{ kind: 'entity', id: 'ref_e0' }], anchor: [0, 0], target: [1, 0], angleDegrees: 0 }))
      .toThrowError(expect.objectContaining({ relationIds: ['ref_reference'] }));
  });
  it('rejects unrepresentable small local shape or lost displacement at a distant target', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [1e-6, 0] }], entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }], relations: [] });
    expect(() => placeCadSketchGraph({ graph, parameters: {}, selections: [{ kind: 'entity', id: 'line' }], anchor: [0, 0], target: [9e8, 9e8], angleDegrees: 37 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-placement-precision' }));
    const far = parseCadSketchGraph({ points: [{ id: 'a', position: [9e8, 0] }], entities: [], relations: [] });
    expect(() => placeCadSketchGraph({ graph: far, parameters: {}, selections: [{ kind: 'point', id: 'a' }], anchor: [0, 0], target: [1e-12, 0], angleDegrees: 0 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-placement-precision' }));
    const point = parseCadSketchGraph({ points: [{ id: 'p', position: [1, 0] }], entities: [], relations: [] });
    expect(() => placeCadSketchGraph({ graph: point, parameters: {}, selections: [{ kind: 'point', id: 'p' }], anchor: [0, 0], target: [0, 0], angleDegrees: Number.MIN_VALUE }))
      .toThrowError(expect.objectContaining({ code: 'sketch-placement-precision' }));
    const nearHalf = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [1, 0] }, { id: 'e', position: [-1, 2e-13] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'cw' }], relations: [] });
    expect(() => placeCadSketchGraph({ graph: nearHalf, parameters: {}, selections: [{ kind: 'entity', id: 'arc' }], anchor: [0, 0], target: [0, 1e4], angleDegrees: 0 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-placement-precision' }));
  });
  it('preserves oblique local supports, separate Coincident IDs and signed minor/major arc coverage', () => {
    for (const direction of ['cw', 'ccw'] as const) {
      const source = placementMixedGraph(), graph = parseCadSketchGraph({ ...source, entities: source.entities.map(entity => entity.kind === 'arc' ? { ...entity, direction } : entity) });
      const next = placeCadSketchGraph({ graph, parameters: {}, selections: graph.entities.map(entity => ({ kind: 'entity', id: entity.id })), anchor: [0, 5], target: [12, -9], angleDegrees: 37 });
      const oldArc = compileCadSketchGraph(graph, {}).segments.find(segment => segment.kind === 'arc'), newArc = compileCadSketchGraph(next, {}).segments.find(segment => segment.kind === 'arc');
      if (oldArc?.kind !== 'arc' || newArc?.kind !== 'arc') throw new Error('Missing arc.');
      expect(newArc.radius).toBeCloseTo(oldArc.radius, 12); expect(newArc.sweepRadians).toBeCloseTo(oldArc.sweepRadians, 12);
      expect(next.entities).toEqual(graph.entities); expect(next.relations).toEqual(graph.relations);
      expect(next.points[1].id).not.toBe(next.points[2].id); expect(next.points[1].position).toEqual(next.points[2].position);
      expect(checkCadSketchGraph(next, {})).toEqual([]);
    }
  });
  it('preserves an ordinary neutral semicircle through an oblique placement without inventing a major/minor side', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [-10, 0] }, { id: 'e', position: [10, 0] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw' }], relations: [] });
    const placed = placeCadSketchGraph({ graph, parameters: {}, selections: [{ kind: 'entity', id: 'arc' }], anchor: [0, 0], target: [13, 17], angleDegrees: 37 });
    expect(checkCadSketchGraph(placed, {})).toEqual([]); expect(placed.entities).toEqual(graph.entities);
    const arc = compileCadSketchGraph(placed, {}).segments[0];
    if (arc.kind !== 'arc') throw new Error('Missing semicircle.');
    expect(arc.radius).toBeCloseTo(10, 12); expect(arc.sweepRadians).toBeCloseTo(Math.PI, 14);
  });
});
