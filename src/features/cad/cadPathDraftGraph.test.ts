// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { MAX_CAD_PATH_CONSTRUCTION_EDGES } from '@/domain/cad/cadPathConstruction';
import { createCadPathDraft, updateCadPathDraft, type CadPathDraft } from './cadPathDrawing';
import { createCadPathDraftGraph } from './cadPathDraftGraph';

function idFactory() {
  let next = 0;
  return () => `path_${String(++next).padStart(4, '0')}`;
}
function append(graph: CadSketchGraph) {
  return applyCadEdits(parseCadDocument({ ...createCadDocument('Path', 'path'), features: [{
    id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: []
  }] }), [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry: graph }]);
}
function lines(points: readonly (readonly [number, number])[]) {
  let draft = createCadPathDraft();
  for (const point of points) draft = updateCadPathDraft(draft, { kind: 'point', point });
  return draft;
}
function arcDraft(start: readonly [number, number], end: readonly [number, number], through: readonly [number, number]) {
  let draft = updateCadPathDraft(createCadPathDraft('arc'), { kind: 'point', point: start });
  draft = updateCadPathDraft(draft, { kind: 'point', point: end });
  return updateCadPathDraft(draft, { kind: 'point', point: through });
}

describe('live path draft graph construction', () => {
  it('reconnects existing exact endpoint identities through real append without copying their expression drivers', () => {
    const parameters = { width: 20 }, existingGraph = parseCadSketchGraph({ points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: [' width ', 0] }, { id: 'c', position: [' width ', 10] }, { id: 'd', position: [0, 10] }
    ], entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
      { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }], relations: [] });
    const source = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, parameters, features: [{ id: 'sketch', kind: 'sketch', name: 'Repair',
      suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: existingGraph }] }), before = JSON.stringify(source);
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [20, 0], existingPointId: 'b' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [20, 10], existingPointId: 'c' });
    const geometry = createCadPathDraftGraph({ draft, existingGraph, parameters, closed: false, construction: false, createId: idFactory() });
    expect(geometry.points).toEqual([]);
    expect(geometry.entities).toMatchObject([{ kind: 'line', startPointId: 'b', endPointId: 'c' }]);
    const complete = applyCadEdits(source, [{ kind: 'append-sketch-entities', sketchId: 'sketch', geometry }]);
    expect(measureCadSketch(complete, 'sketch').materialAreaMm2).toBe(200);
    expect(complete.features[0]).toMatchObject({ graph: { points: existingGraph.points } });
    expect(JSON.stringify(source)).toBe(before); expect(Object.isFrozen(geometry)).toBe(true);
  });

  it('uses existing arc endpoints but always authors its own center and never references a through pick', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'start', position: [' radius ', 0] }, { id: 'end', position: [0, 'radius'] },
      { id: 'through', position: [-5, 0] }, { id: 'old-center', position: [0, 0] }], entities: [], relations: [] });
    let draft = updateCadPathDraft(createCadPathDraft('arc'), { kind: 'point', point: [5, 0], existingPointId: 'start' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 5], existingPointId: 'end' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [-5, 0], existingPointId: 'through' });
    const graph = createCadPathDraftGraph({ draft, existingGraph, parameters: { radius: 5 }, closed: false, construction: false, createId: idFactory() });
    expect(graph.points).toHaveLength(1); expect(graph.points[0].position).toEqual([0, 0]); expect(graph.points[0].id).not.toBe('old-center');
    expect(graph.entities).toEqual([{ id: 'path_0002', kind: 'arc', startPointId: 'start', endPointId: 'end', centerPointId: 'path_0001', direction: 'cw', construction: false }]);
    expect(JSON.stringify(graph)).not.toContain('through');
  });

  it('never infers existing identity from equal coordinates and honors only deliberate final return identity', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'old', position: [0, 0] }, { id: 'coincident', position: [0, 0] }], entities: [], relations: [] });
    const unreferenced = createCadPathDraftGraph({ draft: lines([[0, 0], [10, 0]]), existingGraph, closed: false, construction: false, createId: idFactory() });
    expect(unreferenced.points).toHaveLength(2); expect(unreferenced.points.every(point => point.id !== 'old')).toBe(true);
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0], existingPointId: 'old' });
    for (const point of [[10, 0], [10, 10]] as const) draft = updateCadPathDraft(draft, { kind: 'point', point });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 0], existingPointId: 'old' });
    const graph = createCadPathDraftGraph({ draft, existingGraph, closed: false, construction: false, createId: idFactory() });
    expect(graph.entities[graph.entities.length - 1]).toMatchObject({ endPointId: 'old' }); expect(graph.points).toHaveLength(2);
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 0], existingPointId: 'coincident' });
    expect(() => createCadPathDraftGraph({ draft, existingGraph, closed: true, construction: false, createId: idFactory() })).toThrowError(expect.objectContaining({ code: 'ambiguous-path-closure' }));
  });

  it.each(['missing', 'moved', 'changed-driver'] as const)('rejects a %s reference without mutating source or authoring state', cause => {
    const existingGraph = parseCadSketchGraph({ points: cause === 'missing' ? [] : [{ id: 'anchor', position: cause === 'changed-driver' ? ['size', 0] : [1e-12, 0] }], entities: [], relations: [] });
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0], existingPointId: 'anchor' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [10, 0] });
    const before = JSON.stringify({ existingGraph, draft });
    expect(() => createCadPathDraftGraph({ draft, existingGraph, parameters: { size: 1 }, closed: false, construction: false, createId: idFactory() }))
      .toThrowError(expect.objectContaining({ code: 'stale-path-point-reference' }));
    expect(JSON.stringify({ existingGraph, draft })).toBe(before);
  });

  it('closes with a real edge to a borrowed off-grid start and rejects IDs colliding with the existing graph', () => {
    const existingGraph = parseCadSketchGraph({ points: [{ id: 'anchor', position: [' .25 ', '.75'] }], entities: [], relations: [] });
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [.25, .75], existingPointId: 'anchor' });
    for (const point of [[10, .75], [10, 10]] as const) draft = updateCadPathDraft(draft, { kind: 'point', point });
    const graph = createCadPathDraftGraph({ draft, existingGraph, closed: true, construction: false, createId: idFactory() });
    expect(graph.points).toHaveLength(2); expect(graph.entities).toHaveLength(3);
    expect(graph.entities[0]).toMatchObject({ startPointId: 'anchor' }); expect(graph.entities[2]).toMatchObject({ endPointId: 'anchor' });
    expect(() => createCadPathDraftGraph({ draft, existingGraph, closed: false, construction: false, createId: () => 'anchor' }))
      .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(existingGraph.points).toEqual([{ id: 'anchor', position: [' .25 ', '.75'] }]);
  });

  it('preserves mixed analytic support and authored joints through real append and material measurement', () => {
    let draft = lines([[0, 0], [20, 0]]);
    draft = updateCadPathDraft(draft, { kind: 'mode', mode: 'arc' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [20, 20] });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [30, 10] });
    draft = updateCadPathDraft(draft, { kind: 'mode', mode: 'line' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 20] });
    const before = JSON.stringify(draft);
    const graph = createCadPathDraftGraph({ draft, closed: true, construction: false, createId: idFactory() });
    expect(graph.points).toHaveLength(5); expect(graph.entities.map(entity => entity.kind)).toEqual(['line', 'arc', 'line', 'line']);
    const [line, arc, next, closing] = graph.entities;
    if (line.kind !== 'line' || arc.kind !== 'arc' || next.kind !== 'line' || closing.kind !== 'line') throw new Error('Expected mixed chain.');
    expect(line.endPointId).toBe(arc.startPointId); expect(arc.endPointId).toBe(next.startPointId);
    expect(next.endPointId).toBe(closing.startPointId); expect(closing.endPointId).toBe(line.startPointId);
    expect(graph.points.find(point => point.id === arc.centerPointId)?.position).toEqual([20, 10]);
    expect(checkCadSketchGraph(graph, {})).toEqual([]); expect(graph.relations).toEqual([]);
    expect(compileCadSketchGraph(graph, {}).cycles).toHaveLength(1);
    expect(measureCadSketch(append(graph), 'sketch').materialAreaMm2).toBeCloseTo(400 + 50 * Math.PI, 10);
    expect(measureCadSketch(append(graph), 'sketch').boundaryLengthMm).toBeCloseTo(60 + 10 * Math.PI, 10);
    expect(JSON.stringify(draft)).toBe(before); expect(Object.isFrozen(graph)).toBe(true); expect(Object.isFrozen(graph.points[0].position)).toBe(true);
  });

  it.each([{ radius: 6 }, { startAngle: 15 }, { sweep: 90 }, { through: [1, 1] as const }])('rejects an inconsistent live arc support instead of discarding its authoring data: %j', change => {
    const draft = arcDraft([5, 0], [0, 5], [-5, 0]);
    if (draft.kind !== 'ready' || draft.segments[0].kind !== 'arc') throw new Error('Expected live arc.');
    const candidate: CadPathDraft = { ...draft, segments: [{ ...draft.segments[0], ...change }] }, before = JSON.stringify(candidate);
    expect(() => createCadPathDraftGraph({ draft: candidate, closed: false, construction: false, createId: idFactory() })).toThrowError(expect.objectContaining({ code: 'invalid-path-draft-arc' }));
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it.each([
    { start: [5, 0] as const, end: [0, 5] as const, sweep: -270, direction: 'cw' },
    { start: [0, 5] as const, end: [5, 0] as const, sweep: 270, direction: 'ccw' }
  ])('preserves $direction major arcs and exact logical endpoints under source array reorder', ({ start, end, sweep, direction }) => {
    const draft = arcDraft(start, end, [-5, 0]), before = JSON.stringify(draft);
    const graph = createCadPathDraftGraph({ draft, closed: true, construction: false, createId: idFactory() });
    const arc = graph.entities[0]; if (arc.kind !== 'arc') throw new Error('Expected arc.');
    expect(arc.direction).toBe(direction);
    expect(graph.points.find(point => point.id === arc.startPointId)?.position).toEqual(start);
    expect(graph.points.find(point => point.id === arc.endPointId)?.position).toEqual(end);
    const compiled = compileCadSketchGraph(graph, {}), segment = compiled.segments.find(segment => segment.id === arc.id);
    if (segment?.kind !== 'arc') throw new Error('Expected analytic arc.');
    expect(segment.radius).toBe(5); expect(segment.sweepRadians * 180 / Math.PI).toBeCloseTo(sweep, 12);
    expect(compiled.cycles).toHaveLength(1);
    expect(compileCadSketchGraph({ ...graph, points: [...graph.points].reverse(), entities: [...graph.entities].reverse() }, {}).cycles).toEqual(compiled.cycles);
    expect(measureCadSketch(append(graph), 'sketch').materialAreaMm2).toBeCloseTo(18.75 * Math.PI + 12.5, 11);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('keeps an open return separate and closes only the final exact authored return when requested', () => {
    const draft = lines([[2.1, 3.2], [12.1, 3.2], [12.1, 13.2], [2.1, 3.2]]), before = JSON.stringify(draft);
    const open = createCadPathDraftGraph({ draft, closed: false, construction: false, createId: idFactory() });
    const closed = createCadPathDraftGraph({ draft, closed: true, construction: false, createId: idFactory() });
    expect(open.points).toHaveLength(4); expect(closed.points).toHaveLength(3);
    expect(open.entities).toHaveLength(3); expect(closed.entities).toHaveLength(3);
    const lastOpen = open.entities[2], lastClosed = closed.entities[2];
    if (lastOpen.kind !== 'line' || lastClosed.kind !== 'line') throw new Error('Expected closing lines.');
    expect(lastOpen.endPointId).not.toBe(open.points[0].id); expect(lastClosed.endPointId).toBe(closed.points[0].id);
    expect(compileCadSketchGraph(open, {}).cycles).toEqual([]);
    expect(measureCadSketch(append(open), 'sketch').materialAreaMm2).toBe(0);
    expect(measureCadSketch(append(closed), 'sketch').materialAreaMm2).toBeCloseTo(50, 12);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('adds one real closing edge for a nearby endpoint and rejects a degenerate gap without snapping', () => {
    const draft = lines([[0, 0], [10, 0], [10, 10], [0, 0.000001]]);
    const graph = createCadPathDraftGraph({ draft, closed: true, construction: false, createId: idFactory() });
    expect(graph.points).toHaveLength(4); expect(graph.entities).toHaveLength(4);
    expect(graph.points.map(point => point.position)).toContainEqual([0, 0.000001]);
    expect(compileCadSketchGraph(graph, {}).cycles).toHaveLength(1);
    const tooClose = lines([[0, 0], [10, 0], [10, 10], [0, 1e-8]]), before = JSON.stringify(tooClose);
    expect(() => createCadPathDraftGraph({ draft: tooClose, closed: true, construction: false, createId: idFactory() })).toThrowError(expect.objectContaining({ code: 'invalid-path-draft-graph' }));
    expect(JSON.stringify(tooClose)).toBe(before);
    expect(createCadPathDraftGraph({ draft: tooClose, closed: false, construction: false, createId: idFactory() }).points).toHaveLength(4);
  });

  it('retains crossing chains and repeated intermediate coordinates without creating material cells', () => {
    for (const draft of [lines([[0, 0], [10, 10], [0, 10], [10, 0]]), lines([[0, 0], [10, 0], [0, 0], [0, 10], [10, 10]])]) {
      const graph = createCadPathDraftGraph({ draft, closed: true, construction: true, createId: idFactory() });
      expect(graph.entities.every(entity => entity.construction)).toBe(true);
      const compiled = compileCadSketchGraph(graph, {});
      expect(compiled.cycles).toEqual([]); expect(compiled.arrangementEntityIds.length).toBeGreaterThan(0);
      expect(measureCadSketch(append(graph), 'sketch').materialAreaMm2).toBe(0);
      expect(graph.points.filter(point => point.position[0] === 0 && point.position[1] === 0)).toHaveLength(draft.kind === 'ready' && draft.segments.length === 4 ? 2 : 1);
    }
  });

  it('copies mutable authoring arrays and preserves construction cycles without material', () => {
    const start: [number, number] = [0, 0], end: [number, number] = [10, 0];
    const draft: CadPathDraft = { kind: 'ready', mode: 'line', start, segments: [{ kind: 'line', start, end }] };
    const graph = createCadPathDraftGraph({ draft, closed: false, construction: true, createId: idFactory() });
    start[0] = 100; end[0] = 200;
    expect(graph.points.map(point => point.position)).toEqual([[0, 0], [10, 0]]);
    expect(Object.isFrozen(draft)).toBe(false); expect(Object.isFrozen(start)).toBe(false);
    const triangle = createCadPathDraftGraph({ draft: lines([[0, 0], [10, 0], [0, 10]]), closed: true, construction: true, createId: idFactory() });
    expect(compileCadSketchGraph(triangle, {}).cycles).toMatchObject([{ construction: true }]);
    expect(measureCadSketch(append(triangle), 'sketch')).toMatchObject({ cutContourCount: 0, materialAreaMm2: 0, boundaryLengthMm: 0 });
  });

  it.each([
    { draft: createCadPathDraft(), code: 'empty-path' },
    { draft: lines([[0, 0]]), code: 'empty-path' },
    { draft: updateCadPathDraft(updateCadPathDraft(createCadPathDraft('arc'), { kind: 'point', point: [0, 0] }), { kind: 'point', point: [10, 0] }), code: 'incomplete-arc' }
  ])('rejects an empty or unfinished draft with $code and preserves its authoring state', ({ draft, code }) => {
    const before = JSON.stringify(draft); let allocations = 0;
    expect(() => createCadPathDraftGraph({ draft, closed: true, construction: false, createId: () => `unused_${++allocations}` })).toThrowError(expect.objectContaining({ code }));
    expect(JSON.stringify(draft)).toBe(before); expect(allocations).toBe(0);
  });

  it('rejects discontinuous or degenerate authored lines without joining another source', () => {
    const discontinuous: CadPathDraft = { kind: 'ready', mode: 'line', start: [0, 0], segments: [{ kind: 'line', start: [0, 1e-8], end: [10, 0] }] };
    expect(() => createCadPathDraftGraph({ draft: discontinuous, closed: false, construction: false, createId: idFactory() })).toThrowError(expect.objectContaining({ code: 'discontinuous-path-draft' }));
    const zero: CadPathDraft = { kind: 'ready', mode: 'line', start: [0, 0], segments: [{ kind: 'line', start: [0, 0], end: [0, 0] }] };
    expect(() => createCadPathDraftGraph({ draft: zero, closed: false, construction: false, createId: idFactory() })).toThrowError(expect.objectContaining({ code: 'invalid-path-draft-graph' }));
  });

  it('checks duplicate and malformed IDs through the same strict graph parser as append', () => {
    const draft = lines([[0, 0], [10, 0]]), before = JSON.stringify(draft);
    for (const id of ['duplicate', 'invalid id']) {
      expect(() => createCadPathDraftGraph({ draft, closed: false, construction: false, createId: () => id })).toThrowError(expect.objectContaining({ code: id === 'duplicate' ? 'duplicate-sketch-id' : 'invalid-sketch-graph' }));
    }
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('counts an actual closing edge against the existing 2048-edge limit without allocating an oversized graph', () => {
    const segments = Array.from({ length: MAX_CAD_PATH_CONSTRUCTION_EDGES }, (_, index) => ({
      kind: 'line' as const, start: [index, 0] as const, end: [index + 1, 0] as const
    }));
    const draft: CadPathDraft = { kind: 'ready', mode: 'line', start: [0, 0], segments };
    const graph = createCadPathDraftGraph({ draft, closed: false, construction: false, createId: idFactory() });
    expect(graph.entities).toHaveLength(2048); expect(graph.points).toHaveLength(2049);
    let allocations = 0;
    expect(() => createCadPathDraftGraph({ draft, closed: true, construction: false, createId: () => `unused_${++allocations}` })).toThrowError(expect.objectContaining({ code: 'construction-limit' }));
    const tooMany: CadPathDraft = { ...draft, segments: [...segments, { kind: 'line', start: [2048, 0], end: [2049, 0] }] };
    expect(() => createCadPathDraftGraph({ draft: tooMany, closed: false, construction: false, createId: () => `unused_${++allocations}` })).toThrowError(expect.objectContaining({ code: 'construction-limit' }));
    expect(allocations).toBe(0);
    const exactReturn: CadPathDraft = { ...draft, segments: [...segments.slice(0, -1), { kind: 'line', start: [2047, 0], end: [0, 0] }] };
    expect(createCadPathDraftGraph({ draft: exactReturn, closed: true, construction: false, createId: idFactory() }).entities).toHaveLength(2048);
  });
});
