// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { parseCadSketchSolveInput, parseCadSketchSolverReply } from './cadSketchSolverProtocol';
import { circleReferencePart } from '@/domain/cad/__tests__/cadSketchExternalReferenceFixtures';

const source = () => parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] }],
  entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
  relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }] });
const documentWith = (graph: CadSketchGraph) => ({ ...createCadDocument('Precision', 'precision'), schemaVersion: 2, parameters: { span: 10 },
  features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
const replyWith = (graph: CadSketchGraph) => ({ id: 1, kind: 'result', result: { kind: 'solved', graph,
  diagnostics: { status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } });

describe('shared sketch precision at document and worker boundaries', () => {
  it('preserves the exact passive descriptor at the worker boundary without treating its readout as a driver', () => {
    const graph = parseCadSketchGraph({ ...source(), relations: [{ id: 'measure', kind: 'reference-dimension',
      measurement: { kind: 'point-distance', pointIds: ['b', 'a'] } }] });
    const input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
    const moved = parseCadSketchGraph({ ...graph, points: [graph.points[0], { ...graph.points[1], position: [20, 0] }] });
    expect(parseCadSketchSolverReply(replyWith(moved), input)).toMatchObject({ result: { kind: 'solved', graph: moved } });
    const rebound = parseCadSketchGraph({ ...moved, relations: [{ id: 'measure', kind: 'reference-dimension',
      measurement: { kind: 'point-distance', pointIds: ['a', 'b'] } }] });
    expect(() => parseCadSketchSolverReply(replyWith(rebound), input)).toThrow('request');
    expect(() => parseCadSketchSolverReply(replyWith({ ...moved, relations: [] }), input)).toThrow('request');
  });
  it.each(['position', 'radius'] as const)('rejects a forged numeric reference %s even when local equations remain valid', component => {
    const document = circleReferencePart(true), target = document.features[1]; if (target.kind !== 'sketch' || !target.graph) throw new Error('Reference target missing.');
    const graph = target.graph, input = parseCadSketchSolveInput({ graph, parameters: document.parameters });
    const candidate = parseCadSketchGraph({ ...graph,
      ...(component === 'position' ? { points: graph.points.map(point => ({ ...point, position: [Number(point.position[0]) + 1, point.position[1]] })) }
        : { entities: graph.entities.map(entity => entity.kind === 'circle' ? { ...entity, radius: Number(entity.radius) + 1 } : entity) }) });
    expect(() => parseCadSketchSolverReply(replyWith(candidate), input)).toThrow('request');
    expect(() => parseCadSketchSolveInput({ graph, parameters: document.parameters, drag: { pointId: 'ref_c0', position: [12, 8] } })).toThrow();
    expect(parseCadSketchSolveInput({ graph, parameters: document.parameters, drag: { pointId: 'bore-center', position: [12, 8] } }).drag?.pointId).toBe('bore-center');
  });
  it('accepts a within-budget free numeric result through both boundaries without changing drivers or source', () => {
    const graph = source(), before = JSON.stringify(graph), input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
    const candidate = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'b' ? { ...point, position: [10 + 5e-11, 0] } : point) });
    const accepted = parseCadDocument(documentWith(candidate)), reply = parseCadSketchSolverReply(replyWith(candidate), input);
    expect(accepted.features[0]).toMatchObject({ graph: candidate });
    expect(reply).toMatchObject({ result: { kind: 'solved', graph: candidate } });
    expect(JSON.stringify(graph)).toBe(before);
    expect(candidate.points[0].position).toEqual([' 0 ', '0']);
    expect(candidate.relations[0]).toMatchObject({ value: ' span ' });
  });

  it('rejects beyond-budget or exact-driver-changing replies independently of native Success', () => {
    const graph = source(), input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
    const outside = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'b' ? { ...point, position: [10 + 2e-10, 0] } : point) });
    expect(() => parseCadDocument(documentWith(outside))).toThrowError(expect.objectContaining({ code: 'invalid-sketch-graph-geometry' }));
    expect(() => parseCadSketchSolverReply(replyWith(outside), input)).toThrow('constraints');
    const changedDriver = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'a' ? { ...point, position: ['0', '0'] } : point) });
    expect(() => parseCadSketchSolverReply(replyWith(changedDriver), input)).toThrow('request');
    const separated = parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [5e-11, 0] }],
      entities: [], relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'b'] }] });
    expect(() => parseCadDocument(documentWith(separated))).toThrowError(expect.objectContaining({ code: 'invalid-sketch-graph-geometry' }));
    expect(() => parseCadSketchSolverReply(replyWith(separated), parseCadSketchSolveInput({ graph: separated, parameters: { span: 10 } }))).toThrow('constraints');
  });
});

describe('sketch solver input boundary', () => {
  it('passes an accepted graph through and validates any other graph once', () => {
    const graph = source();
    expect(parseCadSketchSolveInput({ graph, parameters: { span: 10 } }).graph).toBe(graph);
    const copy = parseCadSketchSolveInput({ graph: structuredClone(graph), parameters: { span: 10 } }).graph;
    expect(copy).not.toBe(graph); expect(copy).toEqual(graph); expect(parseCadSketchGraph(copy)).toBe(copy);
  });
  it('reads each input field once and refuses accessors, extra or missing fields and malformed graphs', () => {
    const graph = source();
    let reads = 0;
    const getter = { parameters: { span: 10 } };
    Object.defineProperty(getter, 'graph', { enumerable: true, get: () => { reads++; return graph; } });
    expect(() => parseCadSketchSolveInput(getter)).toThrow('Invalid sketch solver input.');
    expect(reads).toBe(0);
    expect(() => parseCadSketchSolveInput({ graph, parameters: { span: 10 }, extra: 1 })).toThrow('Invalid sketch solver input.');
    // Parameters are copied before the graph is parsed, so a proxy in the graph cannot change them.
    const parameters = { span: 10 }, raw = structuredClone(graph) as unknown as { points: unknown[] }, point = raw.points[0] as object;
    raw.points[0] = new Proxy(point, { getOwnPropertyDescriptor(target, key) { parameters.span = Infinity; raw.points[0] = point; return Reflect.getOwnPropertyDescriptor(target, key); } });
    expect(parseCadSketchSolveInput({ graph: raw, parameters }).parameters.span).toBe(10);
    // Transparent proxies around plain fields are read like the fields they wrap.
    const drag = { pointId: 'b', position: new Proxy([10, 1], {}) };
    expect(parseCadSketchSolveInput({ graph, parameters: new Proxy({ span: 10 }, {}), drag: new Proxy(drag, {}) })).toEqual({ graph, parameters: { span: 10 }, drag: { pointId: 'b', position: [10, 1] } });
    // A `__proto__` field is copied as data, never through the inherited setter.
    const prototypeNamed = parseCadSketchSolveInput({ graph, parameters: JSON.parse('{"span":10,"__proto__":10}') }).parameters;
    expect(Object.getOwnPropertyDescriptor(prototypeNamed, '__proto__')?.value).toBe(10);
    expect(() => parseCadSketchSolveInput(Object.assign(JSON.parse('{"__proto__":1}'), { graph, parameters: { span: 10 } }))).toThrow('Invalid sketch solver input.');
    // An array whose extra named key stands in for an index count is refused, as before the copy.
    const padded = new Proxy(Object.assign([10, 1], { extra: true }), { ownKeys: () => ['0', 'length', 'extra'] });
    expect(() => parseCadSketchSolveInput({ graph, parameters: { span: 10 }, drag: { pointId: 'b', position: padded } })).toThrow('Invalid sketch solver input.');
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    expect(() => parseCadSketchSolveInput(revoked.proxy)).toThrow('Invalid sketch solver input.');
    expect(() => parseCadSketchSolveInput({ parameters: { span: 10 } })).toThrow('Invalid sketch solver input.');
    expect(() => parseCadSketchSolveInput({ graph: { ...graph, points: 'none' }, parameters: { span: 10 } })).toThrow('Invalid sketch solver input.');
    expect(() => parseCadSketchSolveInput({ graph: { ...graph, relations: [...graph.relations, graph.relations[0]] }, parameters: { span: 10 } }))
      .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
  });
  it('keeps the accepted sketch graphs of an accepted document', () => {
    const sketch = parseCadDocument(documentWith(source())).features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch graph missing.');
    expect(parseCadSketchGraph(sketch.graph)).toBe(sketch.graph);
  });
});
