// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CAD_SKETCH_SOLVED_LAYOUT_VERSION, cadSketchSolvedValues, parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { parseCadSketchSolveInput, parseCadSketchSolverReply } from './cadSketchSolverProtocol';
import { circleReferencePart } from '@/domain/cad/__tests__/cadSketchExternalReferenceFixtures';
import { cadSketchExternalReferenceComponents } from '@/domain/cad/cadSketchExternalReferences';

const source = () => parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] }],
  entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
  relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }] });
const documentWith = (graph: CadSketchGraph) => ({ ...createCadDocument('Precision', 'precision'), schemaVersion: 2, parameters: { span: 10 },
  features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
// A worker reply carrying the solved values of `graph`, which has the request's structure.
const replyWith = (graph: CadSketchGraph, values: readonly unknown[] = cadSketchSolvedValues(graph), layout: number = CAD_SKETCH_SOLVED_LAYOUT_VERSION) => ({ id: 1, kind: 'result',
  result: { kind: 'solved', layout, values, diagnostics: { status: 'success', degreesOfFreedom: 1, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } });
const solvedGraph = (reply: ReturnType<typeof parseCadSketchSolverReply>) => {
  if (reply.kind !== 'result' || reply.result.kind !== 'solved') throw new Error('Expected a solved reply.');
  return reply.result.graph;
};

describe('shared sketch precision at document and worker boundaries', () => {
  it('preserves the exact passive descriptor at the worker boundary without treating its readout as a driver', () => {
    const graph = parseCadSketchGraph({ ...source(), relations: [{ id: 'measure', kind: 'reference-dimension',
      measurement: { kind: 'point-distance', pointIds: ['b', 'a'] } }] });
    const input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
    const moved = parseCadSketchGraph({ ...graph, points: [graph.points[0], { ...graph.points[1], position: [20, 0] }] });
    const solved = solvedGraph(parseCadSketchSolverReply(replyWith(moved), input));
    expect(solved).toEqual(moved);
    // Only values cross the boundary: relations and drivers are the request's own.
    expect(solved.relations).toBe(input.graph.relations); expect(solved.points[0]).toBe(input.graph.points[0]);
  });
  it.each(['position', 'radius'] as const)('keeps numeric reference %s snapshots out of the solved values', component => {
    const document = circleReferencePart(true), target = document.features[1]; if (target.kind !== 'sketch' || !target.graph) throw new Error('Reference target missing.');
    const graph = target.graph, input = parseCadSketchSolveInput({ graph, parameters: document.parameters });
    const owned = cadSketchExternalReferenceComponents(graph);
    const candidate = parseCadSketchGraph({ ...graph,
      ...(component === 'position' ? { points: graph.points.map(point => owned.pointIds.has(point.id) ? { ...point, position: [Number(point.position[0]) + 1, point.position[1]] } : point) }
        : { entities: graph.entities.map(entity => owned.circleIds.has(entity.id) && entity.kind === 'circle' ? { ...entity, radius: Number(entity.radius) + 1 } : entity) }) });
    expect(candidate).not.toEqual(graph);
    // A forged snapshot has no slot to travel in; the solvers check their fixed values themselves.
    expect(cadSketchSolvedValues(candidate)).toEqual(cadSketchSolvedValues(graph));
    expect(solvedGraph(parseCadSketchSolverReply(replyWith(candidate), input))).toEqual(graph);
    expect(() => parseCadSketchSolverReply(replyWith(candidate, [...cadSketchSolvedValues(graph), 1]), input)).toThrow('request');
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
    expect(solvedGraph(parseCadSketchSolverReply(replyWith(changedDriver), input)).points[0].position).toEqual([' 0 ', '0']);
    const separated = parseCadSketchGraph({ ...graph, points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [5e-11, 0] }],
      entities: [], relations: [{ id: 'join', kind: 'coincident', pointIds: ['a', 'b'] }] });
    expect(() => parseCadDocument(documentWith(separated))).toThrowError(expect.objectContaining({ code: 'invalid-sketch-graph-geometry' }));
    expect(() => parseCadSketchSolverReply(replyWith(separated), parseCadSketchSolveInput({ graph: separated, parameters: { span: 10 } }))).toThrow('constraints');
  });
});

describe('values-only solved replies', () => {
  const graph = source(), input = parseCadSketchSolveInput({ graph, parameters: { span: 10 } });
  it('refuses another layout, a wrong length, holes and values outside the scalar range', () => {
    // Same length, other layout: only the version tells a swapped order apart.
    expect(() => parseCadSketchSolverReply(replyWith(graph, [0, 10], CAD_SKETCH_SOLVED_LAYOUT_VERSION + 1), input)).toThrow('Invalid sketch worker response.');
    const hole: number[] = [10]; hole.length = 2;
    for (const values of [[10], [10, 0, 0], hole, [10, Number.NaN], [10, Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY, 0], [10, 2e9], [10, '0']])
      expect(() => parseCadSketchSolverReply(replyWith(graph, values), input)).toThrow();
  });
  it('accepts a solved reply whose freedom is unknown and refuses negative freedom', () => {
    const withFreedom = (degreesOfFreedom: number | null) => { const reply = replyWith(graph); return { ...reply, result: { ...reply.result, diagnostics: { ...reply.result.diagnostics, degreesOfFreedom } } }; };
    expect(parseCadSketchSolverReply(withFreedom(null), input)).toMatchObject({ result: { kind: 'solved', diagnostics: { degreesOfFreedom: null } } });
    expect(() => parseCadSketchSolverReply(withFreedom(-1), input)).toThrow('constraints');
  });
  it('carries definition only on a solved reply to input that asked, naming each request point and entity once', () => {
    const defining = parseCadSketchSolveInput({ graph, parameters: { span: 10 }, analyseDefinition: true });
    const definition = { definedPointIds: ['a'], underDefinedPointIds: ['b'], definedEntityIds: [], underDefinedEntityIds: ['line'] };
    const solved = (value: unknown) => { const reply = replyWith(graph); return { ...reply, result: { ...reply.result, diagnostics: { ...reply.result.diagnostics, definition: value } } }; };
    expect(parseCadSketchSolverReply(solved(definition), defining)).toMatchObject({ result: { kind: 'solved', diagnostics: { definition } } });
    expect(() => parseCadSketchSolverReply(replyWith(graph), defining)).toThrow('constraints');
    expect(() => parseCadSketchSolverReply(solved(definition), input)).toThrow('constraints');
    for (const wrong of [{ ...definition, definedPointIds: ['a', 'a'] }, { ...definition, definedPointIds: ['a', 'b'] }, { ...definition, definedPointIds: ['line'] },
      { ...definition, underDefinedEntityIds: ['a'] }, { ...definition, definedEntityIds: ['length'] }, { ...definition, definedPointIds: ['missing'] }])
      expect(() => parseCadSketchSolverReply(solved(wrong), defining)).toThrow('constraints');
    for (const malformed of [{ ...definition, extra: [] }, { definedPointIds: ['a'], underDefinedPointIds: ['b'], definedEntityIds: [] }, { ...definition, definedPointIds: 'a' }])
      expect(() => parseCadSketchSolverReply(solved(malformed), defining)).toThrow('Invalid sketch worker response.');
    const rejected = { id: 1, kind: 'result', result: { kind: 'rejected', reason: 'failed', message: 'No.', diagnostics: { ...replyWith(graph).result.diagnostics, status: 'failed', definition } } };
    expect(() => parseCadSketchSolverReply(rejected, defining)).toThrow('Invalid sketch worker response.');
  });
  it('keeps negative zero and survives a structured clone with expressions, references, radii and no slots', () => {
    expect(Object.is(solvedGraph(parseCadSketchSolverReply(replyWith(graph, [10, -0]), input)).points[1].position[1], -0)).toBe(true);
    const document = circleReferencePart(true), target = document.features[1]; if (target.kind !== 'sketch' || !target.graph) throw new Error('Reference target missing.');
    const referenced = parseCadSketchSolveInput({ graph: target.graph, parameters: document.parameters });
    expect(target.graph.entities.some(entity => entity.kind === 'circle' && typeof entity.radius === 'number' && !cadSketchExternalReferenceComponents(target.graph!).circleIds.has(entity.id))).toBe(true);
    expect(solvedGraph(parseCadSketchSolverReply(structuredClone(replyWith(target.graph)), referenced))).toEqual(target.graph);
    const fixed = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', 'span'] }], entities: [], relations: [] });
    expect(cadSketchSolvedValues(fixed)).toEqual([]);
    expect(solvedGraph(parseCadSketchSolverReply(structuredClone(replyWith(fixed)), parseCadSketchSolveInput({ graph: fixed, parameters: { span: 10 } })))).toEqual(fixed);
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
  it('asks for definition only with true, and never with a drag', () => {
    const graph = source();
    expect(parseCadSketchSolveInput({ graph, parameters: { span: 10 }, analyseDefinition: true })).toEqual({ graph, parameters: { span: 10 }, analyseDefinition: true });
    expect(parseCadSketchSolveInput({ graph, parameters: { span: 10 }, analyseDefinition: false })).toEqual({ graph, parameters: { span: 10 } });
    expect(() => parseCadSketchSolveInput({ graph, parameters: { span: 10 }, analyseDefinition: 1 })).toThrow('Invalid sketch solver input.');
    expect(() => parseCadSketchSolveInput({ graph, parameters: { span: 10 }, drag: { pointId: 'b', position: [10, 1] }, analyseDefinition: true }))
      .toThrow('A sketch drag cannot ask which geometry is defined.');
  });
  it('keeps the accepted sketch graphs of an accepted document', () => {
    const sketch = parseCadDocument(documentWith(source())).features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Sketch graph missing.');
    expect(parseCadSketchGraph(sketch.graph)).toBe(sketch.graph);
  });
});
