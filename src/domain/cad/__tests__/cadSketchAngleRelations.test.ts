import { describe, expect, it } from 'vitest';
import { checkCadSketchGraph, parseCadSketchGraph } from '../cadSketchGraph';
import { cadSketchLineAngleGeometry, cadSketchLineAngleSectors, createCadSketchLineAngleRelation } from '../cadSketchAngleRelations';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds, mapCadSketchRelationScalars } from '../cadSketchGraphReferences';

const corner = () => parseCadSketchGraph({ points: [{ id: 'v', position: [' origin ', '0'] }, { id: 'a', position: [10, 0] },
  { id: 'b', position: [-5, 5 * Math.sqrt(3)] }], entities: [
  { id: 'incoming', kind: 'line', construction: true, startPointId: 'a', endPointId: 'v' },
  { id: 'outgoing', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [] });
const points = (graph: ReturnType<typeof corner>) => new Map(graph.points.map(point => [point.id,
  { x: Number(point.position[0] === ' origin ' ? 0 : point.position[0]), y: Number(point.position[1]) }]));

describe('explicit conventional line angles', () => {
  it('owns the visible obtuse corner instead of its incoming source-vector supplement', () => {
    const graph = corner(), before = JSON.stringify(graph);
    const relation = createCadSketchLineAngleRelation({ graph, parameters: { origin: 0 }, lineIds: ['incoming', 'outgoing'], relationId: 'angle' });
    expect(relation).toMatchObject({ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'incoming', towardPointId: 'a' },
      { lineId: 'outgoing', towardPointId: 'b' }], sense: 'ccw' });
    expect(relation.value).toBeCloseTo(120, 12);
    const saved = { ...relation, value: ' angle ' }, accepted = parseCadSketchGraph({ ...graph, relations: [saved] });
    expect(checkCadSketchGraph(accepted, { origin: 0, angle: 120 })).toEqual([]);
    const geometry = cadSketchLineAngleGeometry(accepted, saved, points(accepted));
    expect(geometry.vertex).toEqual({ x: 0, y: 0 });
    expect(geometry.first.direction.x).toBe(1); expect(geometry.first.direction.y).toBeCloseTo(0, 15);
    expect(geometry.signedSweepRadians).toBeCloseTo(2 * Math.PI / 3, 14);
    expect(geometry.first.length).toBe(10); expect(geometry.second.length).toBeCloseTo(10, 14);
    expect(JSON.stringify(graph)).toBe(before); expect(Object.isFrozen(relation.rays[0])).toBe(true);
  });

  it('keeps physical ray intent and mathematical CCW sector order when source endpoints and arrays reverse', () => {
    const original = corner(), create = (graph: typeof original) => cadSketchLineAngleSectors({ graph, parameters: { origin: 0 }, lineIds: ['incoming', 'outgoing'], relationId: 'angle' });
    const first = create(original), reversed = parseCadSketchGraph({ ...original, points: [...original.points].reverse(),
      entities: [...original.entities].reverse().map(entity => entity.kind === 'line' ? { ...entity, startPointId: entity.endPointId, endPointId: entity.startPointId } : entity) });
    const next = create(reversed);
    expect(first).toHaveLength(4); expect(next.map(sector => sector.relation)).toEqual(first.map(sector => sector.relation));
    expect(first.map(sector => Math.round(Number(sector.relation.value)))).toEqual([120, 60, 120, 60]);
    expect(first.map(sector => sector.relation.rays.map(ray => ray.lineId))).toEqual(Array.from({ length: 4 }, () => ['incoming', 'outgoing']));
    expect(new Set(first.map(sector => sector.relation.id))).toEqual(new Set(['angle']));
    expect(next.map(sector => sector.geometry.signedSweepRadians)).toEqual(first.map(sector => sector.geometry.signedSweepRadians));
    const saved = { ...first[0].relation, value: ' angle ' };
    expect(checkCadSketchGraph(parseCadSketchGraph({ ...reversed, relations: [saved] }), { origin: 0, angle: 120 })).toEqual([]);
    expect(Object.isFrozen(first[0].geometry.first.direction)).toBe(true);
  });

  it('requires a deliberate quadrant for crossing supports and selects its exact candidate without changing source', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'left', position: [-10, 0] }, { id: 'right', position: [10, 0] },
      { id: 'bottom', position: [0, -10] }, { id: 'top', position: [0, 10] }], entities: [
      { id: 'a', kind: 'line', startPointId: 'left', endPointId: 'right', construction: false },
      { id: 'b', kind: 'line', startPointId: 'bottom', endPointId: 'top', construction: true }], relations: [] });
    const input = { graph, parameters: {}, lineIds: ['a', 'b'] as const, relationId: 'dimension' }, before = JSON.stringify(graph);
    expect(() => createCadSketchLineAngleRelation(input)).toThrowError(expect.objectContaining({ code: 'ambiguous-sketch-angle-sector' }));
    const options = cadSketchLineAngleSectors(input);
    const chosen = [[3, 3], [-3, 3], [-3, -3], [3, -3]].map(([x, y]) => createCadSketchLineAngleRelation({ ...input, placementPoint: { x, y } }));
    expect(chosen).toEqual(options.map(option => option.relation));
    expect(chosen.map(relation => relation.value)).toEqual([90, 90, 90, 90]);
    for (const placementPoint of [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: NaN, y: 1 }])
      expect(() => createCadSketchLineAngleRelation({ ...input, placementPoint })).toThrow();
    expect(JSON.stringify(graph)).toBe(before);
  });

  it('recognizes accepted declared joint aliases and unambiguous disjoint segment sides without proximity welding', () => {
    const source = corner(), alias = parseCadSketchGraph({ ...source, points: [...source.points, { id: 'alias', position: [0, 0] }],
      entities: source.entities.map(entity => entity.id === 'outgoing' && entity.kind === 'line' ? { ...entity, startPointId: 'alias' } : entity),
      relations: [{ id: 'join', kind: 'coincident', pointIds: ['v', 'alias'] }] });
    const relation = createCadSketchLineAngleRelation({ graph: alias, parameters: { origin: 0 }, lineIds: ['incoming', 'outgoing'], relationId: 'angle' });
    expect(relation.rays.map(ray => ray.towardPointId)).toEqual(['a', 'b']); expect(relation.value).toBeCloseTo(120, 12);
    const disjoint = parseCadSketchGraph({ points: [{ id: 'a', position: [5, 0] }, { id: 'b', position: [15, 0] },
      { id: 'c', position: [0, 4] }, { id: 'd', position: [0, 12] }], entities: [
      { id: 'first', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'second', kind: 'line', startPointId: 'd', endPointId: 'c', construction: false }], relations: [] });
    expect(createCadSketchLineAngleRelation({ graph: disjoint, parameters: {}, lineIds: ['first', 'second'], relationId: 'angle' }))
      .toEqual({ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'first', towardPointId: 'b' }, { lineId: 'second', towardPointId: 'd' }], sense: 'ccw', value: 90 });
  });

  it('preserves exact scalar traversal and whole-line ownership while rejecting invalid source operands', () => {
    const graph = corner(), relation = { ...createCadSketchLineAngleRelation({ graph, parameters: { origin: 0 }, lineIds: ['incoming', 'outgoing'], relationId: 'angle' }), value: ' angle ' };
    const candidate = parseCadSketchGraph({ ...graph, relations: [relation] });
    expect(cadSketchRelationEntityIds(relation)).toEqual(['incoming', 'outgoing']);
    expect(cadSketchRelationPointIds(candidate, relation)).toEqual(['a', 'v', 'b']);
    expect(mapCadSketchRelationScalars(relation, value => value === ' angle ' ? ' renamed ' : value)).toEqual({ ...relation, value: ' renamed ' });
    for (const rays of [[relation.rays[0], relation.rays[0]], [{ lineId: 'missing', towardPointId: 'a' }, relation.rays[1]],
      [{ lineId: 'incoming', towardPointId: 'b' }, relation.rays[1]]] as const)
      expect(() => parseCadSketchGraph({ ...graph, relations: [{ ...relation, rays }] })).toThrow();
    for (const value of [0, 180, -30, '180 + 1']) expect(checkCadSketchGraph(parseCadSketchGraph({ ...graph, relations: [{ ...relation, value }] }), { origin: 0 }).length).toBeGreaterThan(0);
    // Unsolved source remains parseable, but the wrong physical sector cannot pass independently.
    expect(checkCadSketchGraph(parseCadSketchGraph({ ...graph, relations: [{ ...relation, sense: 'cw', value: 120 }] }), { origin: 0 }))
      .toMatchObject([{ source: { id: 'angle' }, code: 'relation-residual' }]);
  });

  it('checks the actual angle and longer-line deflection independently at tiny and disparate scales', () => {
    const make = (origin: number, firstLength: number, x: number, y: number, value: number) => parseCadSketchGraph({ points: [
      { id: 'v', position: [origin, origin] }, { id: 'a', position: [origin + firstLength, origin] }, { id: 'b', position: [origin + x, origin + y] }],
      entities: [{ id: 'first', kind: 'line', construction: true, startPointId: 'v', endPointId: 'a' },
        { id: 'second', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [
      { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'first', towardPointId: 'a' }, { lineId: 'second', towardPointId: 'b' }], sense: 'ccw', value }] });
    expect(checkCadSketchGraph(make(0, 1e-6, 0, 2e-6, 90), {})).toEqual([]);
    expect(checkCadSketchGraph(make(1e6, 10, 0, 15, 90), {})).toEqual([]);
    // A half-turn error must not pass merely because its sine is near zero.
    expect(checkCadSketchGraph(make(0, 10, -5 * Math.sqrt(3), -5, 30), {})).toMatchObject([{ source: { id: 'angle' }, code: 'relation-residual' }]);
    const tilted = Math.PI / 6 + 5e-13;
    const disparate = checkCadSketchGraph(make(0, 1e6, 1e-6 * Math.cos(tilted), 1e-6 * Math.sin(tilted), 30), {});
    expect(disparate).toMatchObject([{ source: { id: 'angle' }, code: 'relation-residual' }]);
    expect(disparate[0].residualMm).toBeGreaterThan(1e-7);
    expect(checkCadSketchGraph(make(9e8, 1e-6, 1e-6, 1e-6, 30), {})).toMatchObject([{ source: { id: 'angle' }, code: 'relation-residual' }]);
  });

  it('rejects mirrored, half-turn and underflowed sectors even inside the numeric residual budget', () => {
    const source = corner(), base = createCadSketchLineAngleRelation({ graph: source, parameters: { origin: 0 }, lineIds: ['incoming', 'outgoing'], relationId: 'angle' });
    for (const [position, value] of [[[10, -1e-12], 1e-13 * 180 / Math.PI], [[-10, 0], 179.99999999999], [[10, 1e-12], Number.MIN_VALUE]] as const) {
      const graph = parseCadSketchGraph({ ...source, points: source.points.map(point => point.id === 'b' ? { ...point, position } : point),
        relations: [{ ...base, value }] });
      expect(checkCadSketchGraph(graph, { origin: 0 })).toMatchObject([{ source: { id: 'angle' }, code: 'relation-residual' }]);
    }
  });
});
