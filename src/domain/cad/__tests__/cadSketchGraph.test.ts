import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';

const source = () => ({
  points: [{ id: 'a', position: ['origin', 0] }, { id: 'b', position: [10, 0] }],
  entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
  relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }]
});

describe('owned sketch graph source', () => {
  it('detaches and freezes exact source scalars while allowing an unsolved relation candidate', () => {
    const raw = source(); raw.points[1].position[1] = 3;
    const graph = parseCadSketchGraph(raw);
    raw.points[0].position[0] = 99;
    expect(graph.points[0].position).toEqual(['origin', 0]);
    expect(Object.isFrozen(graph)).toBe(true); expect(Object.isFrozen(graph.points[0].position)).toBe(true);
    expect(Object.isFrozen(graph.relations[0])).toBe(true);
    expect(checkCadSketchGraph(graph, { origin: 0 })).toMatchObject([
      { source: { kind: 'relation', id: 'horizontal' }, code: 'relation-residual', residualMm: 3 }
    ]);
    expect(graph.points[1].position).toEqual([10, 3]);
  });

  it('rejects duplicate identities, dangling references and nonportable data before reading accessors', () => {
    const duplicate = source(); duplicate.entities[0].id = 'a';
    expect(() => parseCadSketchGraph(duplicate)).toThrow('Duplicate');
    const dangling = source(); dangling.entities[0].endPointId = 'missing';
    expect(() => parseCadSketchGraph(dangling)).toThrow('missing');
    const relation = source(); relation.relations[0].pointIds[1] = 'line';
    expect(() => parseCadSketchGraph(relation)).toThrow('point');
    let reads = 0;
    expect(() => parseCadSketchGraph({ ...source(), get points() { reads++; return []; } })).toThrow();
    expect(reads).toBe(0);
    expect(() => parseCadSketchGraph({ ...source(), surprise: true })).toThrow();
  });

  it('returns an accepted graph as it is and parses copies, proxies and frozen lookalikes in full', () => {
    const graph = parseCadSketchGraph(source());
    expect(parseCadSketchGraph(graph)).toBe(graph);
    // A proxy cannot be detached, so it never passes for the graph it wraps.
    expect(() => parseCadSketchGraph(new Proxy(graph, {}))).toThrow();
    for (const copy of [structuredClone(graph), { ...graph }]) {
      const parsed = parseCadSketchGraph(copy);
      expect(parsed).not.toBe(graph); expect(parsed).toEqual(graph);
    }
    const lookalike = Object.freeze({ ...graph, relations: Object.freeze([...graph.relations, graph.relations[0]]) });
    expect(() => parseCadSketchGraph(lookalike)).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    // A proxy that swaps checked data for a Map before the clone leaves a copy that is checked again.
    const raw = source(), entity = raw.entities[0];
    raw.entities[0] = new Proxy(entity, { get(target, key, receiver) {
      (raw.points[1] as { position: unknown }).position = new Map(); raw.entities[0] = entity; return Reflect.get(target, key, receiver);
    } });
    expect(() => parseCadSketchGraph(raw)).toThrowError(expect.objectContaining({ code: 'invalid-sketch-graph' }));
    // Numeric values only need their range: coincident points parse, an out-of-range one does not.
    const coincident = source(); coincident.points[1].position = [0, 0];
    expect(() => parseCadSketchGraph(coincident)).not.toThrow();
    const far = source(); far.points[1].position = [2e9, 0];
    expect(() => parseCadSketchGraph(far)).toThrow();
  });
  it('checks all point relation drivers without modifying expressions or accepting physical gaps', () => {
    const graph = parseCadSketchGraph({
      points: [{ id: 'a', position: [2, 3] }, { id: 'b', position: [2, 8] }, { id: 'c', position: [2, 8] }], entities: [],
      relations: [
        { id: 'x', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 'origin' },
        { id: 'fixed', kind: 'fixed-point', pointId: 'a', position: [2, 'height'] },
        { id: 'vertical', kind: 'vertical', pointIds: ['a', 'b'] },
        { id: 'distance', kind: 'distance', pointIds: ['a', 'b'], value: 'span' },
        { id: 'join', kind: 'coincident', pointIds: ['b', 'c'] }
      ]
    });
    expect(checkCadSketchGraph(graph, { origin: 2, height: 3, span: 5 })).toEqual([]);
    const issues = checkCadSketchGraph(graph, { origin: 2.000001, height: 4, span: -1 });
    expect(issues.map(issue => issue.source.id)).toEqual(['x', 'fixed', 'distance']);
    expect(issues[2].code).toBe('invalid-distance');
    expect(graph.relations[0]).toMatchObject({ value: 'origin' });
    expect(checkCadSketchGraph(graph, {}).some(issue => issue.code === 'invalid-expression')).toBe(true);
  });

  it('separates arc structural residuals and invalid primitive dimensions from graph reference validity', () => {
    const graph = parseCadSketchGraph({
      points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [5, 0] }, { id: 'end', position: [0, 6] }],
      entities: [
        { id: 'arc', kind: 'arc', centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw', construction: false },
        { id: 'circle', kind: 'circle', centerPointId: 'center', radius: 'radius', construction: true }
      ], relations: []
    });
    expect(checkCadSketchGraph(graph, { radius: -2 })).toMatchObject([
      { source: { kind: 'entity', id: 'arc' }, code: 'arc-radius-mismatch', residualMm: 1 },
      { source: { kind: 'entity', id: 'circle' }, code: 'invalid-radius' }
    ]);
    expect(graph.points[2].position).toEqual([0, 6]);
  });
});
