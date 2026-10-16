import { describe, expect, it } from 'vitest';
import { createCadFreshSketchGraph } from '../cadFreshSketchGraph';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import { checkCadSketchGraph } from '../cadSketchGraph';
import { measureCadSketch } from '../cadMeasurements';
import type { CadProfile } from '../cadDocument';

function idFactory(prefix = 'fresh') {
  let next = 0;
  return () => `${prefix}_${++next}`;
}

const document = () => parseCadDocument({ ...createCadDocument('Authoring', 'authoring'), features: [{
  id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: []
}] });

describe('fresh numeric sketch graph authoring', () => {
  it('appends an editable axis-aligned rectangle with shared corners and exact material area', () => {
    const geometry = { kind: 'rectangle', x: -5, y: 7, width: 20, height: 10, cornerRadius: 0 } as const;
    const before = JSON.stringify(geometry), source = document();
    const graph = createCadFreshSketchGraph({ geometry, construction: false, createId: idFactory() });
    const accepted = applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: graph }]);
    const sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected authored sketch graph.');
    expect(sketch.profiles).toEqual([]); expect(source.schemaVersion).toBe(1); expect(accepted.schemaVersion).toBe(2);
    expect(graph.points.map(point => point.position)).toEqual([[-5, 7], [15, 7], [15, 17], [-5, 17]]);
    expect(graph.entities).toHaveLength(4);
    expect(graph.relations.map(relation => relation.kind).sort()).toEqual(['horizontal', 'horizontal', 'vertical', 'vertical']);
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    expect(compileCadSketchGraph(graph, {}).cycles).toHaveLength(1);
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 200, boundaryLengthMm: 60 });
    expect(new Set([...graph.points, ...graph.entities, ...graph.relations].map(item => item.id)).size).toBe(12);
    expect(graph.points.every(point => point.position.every(value => typeof value === 'number'))).toBe(true);
    expect(JSON.stringify(geometry)).toBe(before); expect(Object.isFrozen(geometry)).toBe(false);
    expect(Object.isFrozen(graph)).toBe(true); expect(Object.isFrozen(graph.points[0].position)).toBe(true);
    const broken = { ...graph, points: graph.points.map((point, index) => index === 1 ? { ...point, position: [15, 9] as const } : point) };
    expect(checkCadSketchGraph(broken, {}).filter(issue => issue.source.kind === 'relation')).toHaveLength(1);
  });

  it('keeps circles analytic and construction-only while preserving existing expression profiles exactly', () => {
    const base = document(), sketch = base.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const source = parseCadDocument({ ...base, parameters: { oldRadius: 5 }, features: [{ ...sketch,
      profiles: [{ id: 'old', name: 'Existing', construction: false, geometry: { kind: 'circle', x: 100, y: 0, radius: ' oldRadius ' } }]
    }] }), before = JSON.stringify(source), createId = idFactory();
    const circle = createCadFreshSketchGraph({ geometry: { kind: 'circle', x: -3, y: 2, radius: 4 }, construction: false, createId });
    const guide = createCadFreshSketchGraph({ geometry: { kind: 'circle', x: 30, y: 2, radius: 2 }, construction: true, createId });
    const accepted = applyCadEdits(source, [circle, guide].map(geometry => ({ kind: 'append-sketch-entities', sketchId: 'sketch', geometry })));
    expect(circle).toMatchObject({ points: [{ position: [-3, 2] }], entities: [{ kind: 'circle', radius: 4, construction: false }], relations: [] });
    expect(circle.points).toHaveLength(1); expect(circle.entities).toHaveLength(1);
    expect(compileCadSketchGraph(guide, {}).cycles[0].construction).toBe(true);
    expect(measureCadSketch(accepted, 'sketch').materialAreaMm2).toBeCloseTo(41 * Math.PI, 12);
    expect(accepted.features[0]).toMatchObject({ profiles: [{ id: 'old', geometry: { radius: ' oldRadius ' } }] });
    expect(new Set([...circle.points, ...circle.entities, ...guide.points, ...guide.entities].map(item => item.id)).size).toBe(4);
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each([false, true])('retains authored polygon vertices and shared joints without proximity merging, reversed=%s', reversed => {
    const vertices: readonly (readonly [number, number])[] = [[0, 0], [6, 0], [6, 0.000001], [6, 2], [2, 2], [2, 6], [0, 6]];
    const points = reversed ? [...vertices].reverse() : vertices;
    const geometry = { kind: 'polygon', points } as const, before = JSON.stringify(geometry);
    const graph = createCadFreshSketchGraph({ geometry, construction: false, createId: idFactory() });
    const accepted = applyCadEdits(document(), [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: graph }]);
    expect(graph.points.map(point => point.position)).toEqual(points);
    expect(graph.points).toHaveLength(7); expect(graph.entities).toHaveLength(7); expect(graph.relations).toEqual([]);
    for (const point of graph.points) {
      expect(graph.entities.filter(entity => entity.kind === 'line' && (entity.startPointId === point.id || entity.endPointId === point.id))).toHaveLength(2);
    }
    expect(compileCadSketchGraph(graph, {})).toMatchObject({ cycles: [expect.objectContaining({ construction: false })], openEntityIds: [], branchedEntityIds: [], arrangementEntityIds: [] });
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 20, boundaryLengthMm: 24 });
    expect(JSON.stringify(geometry)).toBe(before); expect(Object.isFrozen(points)).toBe(false);
  });

  it.each<CadProfile>([
    { kind: 'rectangle', x: 0, y: 0, width: '20', height: 10, cornerRadius: 0 },
    { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: '0' },
    { kind: 'circle', x: 0, y: 0, radius: ' radius ' },
    { kind: 'polygon', points: [[0, 0], ['5', 0], [0, 5]] }
  ])('refuses scalar strings rather than evaluating or normalizing their ownership: %j', geometry => {
    const before = JSON.stringify(geometry);
    expect(() => createCadFreshSketchGraph({ geometry, construction: false, createId: idFactory() })).toThrowError(expect.objectContaining({ code: 'invalid-fresh-sketch-scalar' }));
    expect(JSON.stringify(geometry)).toBe(before);
  });

  it.each<CadProfile>([
    { kind: 'rectangle', x: 0, y: 0, width: 0, height: 10, cornerRadius: 0 },
    { kind: 'rectangle', x: 0, y: 0, width: -20, height: 10, cornerRadius: 0 },
    { kind: 'rectangle', x: 1e9, y: 0, width: 20, height: 10, cornerRadius: 0 },
    { kind: 'circle', x: 0, y: 0, radius: Number.NaN },
    { kind: 'circle', x: 0, y: 0, radius: 0 },
    { kind: 'circle', x: 0, y: 0, radius: 1e6 + 1 },
    { kind: 'polygon', points: [[0, 0], [2, 0]] },
    { kind: 'polygon', points: [[0, 0], [2, 0], [2, 0], [0, 2]] },
    { kind: 'polygon', points: [[0, 0], [2, 0], [4, 0]] },
    { kind: 'polygon', points: [[0, 0], [5, 4], [0, 4], [3, 0]] }
  ])('rejects invalid fresh geometry without accepting a repaired contour: %j', geometry => {
    expect(() => createCadFreshSketchGraph({ geometry, construction: false, createId: idFactory() })).toThrow();
  });

  it.each<CadProfile>([
    { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 2 },
    { kind: 'slot', x: 0, y: 0, length: 20, width: 10, angle: 30 },
    { kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep: 360 }] }
  ])('leaves unsupported shape semantics on the explicit legacy path: %j', geometry => {
    let allocations = 0;
    expect(() => createCadFreshSketchGraph({ geometry, construction: false, createId: () => `unused_${++allocations}` })).toThrowError(expect.objectContaining({ code: 'unsupported-fresh-sketch-geometry' }));
    expect(allocations).toBe(0);
  });

  it('rejects duplicate factory IDs and append collisions without changing accepted geometry', () => {
    expect(() => createCadFreshSketchGraph({ geometry: { kind: 'circle', x: 0, y: 0, radius: 3 }, construction: false, createId: () => 'duplicate' })).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    const createId = idFactory(), graph = createCadFreshSketchGraph({ geometry: { kind: 'circle', x: 0, y: 0, radius: 3 }, construction: false, createId });
    const accepted = applyCadEdits(document(), [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: graph }]), before = JSON.stringify(accepted);
    expect(() => applyCadEdits(accepted, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: graph }])).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(JSON.stringify(accepted)).toBe(before);
  });
});
