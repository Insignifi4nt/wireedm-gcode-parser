import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph } from '../cadSketchGraph';
import type { CadSketchGraphSelection } from '../cadSketchGraphSelection';
import { cadSketchRelationOffers, type CadSketchRelationOffer } from '../sketch-relations/cadSketchRelationOffers';
import { CAD_SKETCH_RELATION_DEFINITIONS } from '../sketch-relations/cadSketchRelationRegistry';

const point = (id: string): CadSketchGraphSelection => ({ kind: 'point', id });
const edge = (id: string): CadSketchGraphSelection => ({ kind: 'entity', id });
const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line', construction: false, startPointId, endPointId });
// A square a-b-c-d with a loose point m, an axis line u-v, two circles and an arc that starts where line bc ends.
const sketch = (relations: readonly unknown[] = [], extraPoints: readonly unknown[] = []) => parseCadSketchGraph({
  points: [
    { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }, { id: 'd', position: [0, 10] },
    { id: 'm', position: [5, 3] }, { id: 'u', position: [-5, -5] }, { id: 'v', position: [-5, 15] },
    { id: 'o1', position: [30, 0] }, { id: 'o2', position: [40, 0] }, { id: 'q', position: [15, 10] }, { id: 'g', position: [20, 10] },
    { id: 'w', position: ['width', 4] }, ...extraPoints
  ],
  entities: [
    line('ab', 'a', 'b'), line('bc', 'b', 'c'), line('cd', 'c', 'd'), line('axis', 'u', 'v'),
    { id: 'c1', kind: 'circle', construction: false, centerPointId: 'o1', radius: 2 }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'o2', radius: 3 },
    { id: 'arc1', kind: 'arc', construction: false, centerPointId: 'q', startPointId: 'c', endPointId: 'g', direction: 'cw' }
  ],
  relations
});
const kinds = (offers: readonly CadSketchRelationOffer[]) => offers.map(offer => offer.kind);
const find = (offers: readonly CadSketchRelationOffer[], kind: string) => {
  const found = offers.find(offer => offer.kind === kind);
  if (!found) throw new Error(`No ${kind} offer.`);
  return found;
};
// Every available offer's relations, once given identities, must make a graph the parser accepts.
function expectAddable(graph: CadSketchGraph, offers: readonly CadSketchRelationOffer[]) {
  for (const offer of offers) if (offer.state === 'available') {
    const relations = [...graph.relations, ...offer.relations.map((relation, index) => ({ ...relation, id: `added${index}` }))];
    expect(() => parseCadSketchGraph({ ...graph, relations }), offer.kind).not.toThrow();
  }
}

describe('sketch relation offers', () => {
  it('offer two points Coincident, Horizontal, Vertical and a Fix for each, in slot order', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [point('a'), point('m')]);
    expect(kinds(offers)).toEqual(['coincident', 'horizontal', 'vertical', 'fixed-point']);
    expect(find(offers, 'coincident')).toEqual({ kind: 'coincident', state: 'available', operands: [[point('a'), point('m')]],
      relations: [{ kind: 'coincident', pointIds: ['a', 'm'] }], relationIds: [] });
    expect(find(offers, 'vertical').relations).toEqual([{ kind: 'vertical', pointIds: ['a', 'm'] }]);
    expectAddable(graph, offers);
  });

  it('report a relation stored in either order as applied, with the relations that hold it', () => {
    const graph = sketch([{ id: 'joined', kind: 'coincident', pointIds: ['m', 'a'] }]), offers = cadSketchRelationOffers(graph, [point('a'), point('m')]);
    expect(find(offers, 'coincident')).toEqual({ kind: 'coincident', state: 'applied', operands: [[point('a'), point('m')]], relations: [], relationIds: ['joined'] });
    // Coincident points are one place, so they cannot align either.
    expect(find(offers, 'horizontal')).toMatchObject({ state: 'blocked', reason: 'These points are already joined.' });
  });

  it('block points that other relations already join in one place', () => {
    const graph = sketch([{ id: 'first', kind: 'coincident', pointIds: ['a', 'g'] }, { id: 'second', kind: 'coincident', pointIds: ['g', 'm'] }]);
    const offers = cadSketchRelationOffers(graph, [point('a'), point('m')]);
    expect(find(offers, 'coincident')).toEqual({ kind: 'coincident', state: 'blocked', reason: 'These points are already joined.', operands: [[point('a'), point('m')]], relations: [], relationIds: [] });
  });

  it('align a line by its own ends, and each of several lines', () => {
    const graph = sketch([{ id: 'level', kind: 'horizontal', pointIds: ['b', 'a'] }]);
    const one = cadSketchRelationOffers(graph, [edge('ab')]);
    expect(kinds(one)).toEqual(['horizontal', 'vertical']);
    expect(find(one, 'horizontal')).toMatchObject({ state: 'applied', relationIds: ['level'] });
    expect(find(one, 'vertical')).toMatchObject({ state: 'available', relations: [{ kind: 'vertical', pointIds: ['a', 'b'] }] });
    const three = cadSketchRelationOffers(graph, [edge('ab'), edge('bc'), edge('cd')]);
    // One already level: the others are added and the existing one named.
    expect(find(three, 'horizontal')).toEqual({ kind: 'horizontal', state: 'available', operands: [[edge('bc')], [edge('cd')]],
      relations: [{ kind: 'horizontal', pointIds: ['b', 'c'] }, { kind: 'horizontal', pointIds: ['c', 'd'] }], relationIds: ['level'] });
    expectAddable(graph, three);
  });

  it('pair the first of several lines with each later one', () => {
    const graph = sketch([{ id: 'kept', kind: 'parallel', lineIds: ['cd', 'ab'] }]);
    const offers = cadSketchRelationOffers(graph, [edge('ab'), edge('bc'), edge('cd')]);
    expect(kinds(offers)).toEqual(['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'equal-length']);
    expect(find(offers, 'parallel')).toEqual({ kind: 'parallel', state: 'available', operands: [[edge('ab'), edge('bc')]],
      relations: [{ kind: 'parallel', lineIds: ['ab', 'bc'] }], relationIds: ['kept'] });
    expect(find(offers, 'equal-length').relations).toEqual([{ kind: 'equal-length', lineIds: ['ab', 'bc'] }, { kind: 'equal-length', lineIds: ['ab', 'cd'] }]);
    expectAddable(graph, offers);
  });

  it('put a point on a line or at its middle, in slot order whatever the pick order, unless it is one of its ends', () => {
    const graph = sketch();
    const offers = cadSketchRelationOffers(graph, [edge('ab'), point('m')]);
    expect(kinds(offers)).toEqual(['midpoint', 'point-on-line']);
    expect(find(offers, 'midpoint')).toMatchObject({ state: 'available', operands: [[point('m'), edge('ab')]], relations: [{ kind: 'midpoint', pointId: 'm', lineId: 'ab' }] });
    expectAddable(graph, offers);
    const end = cadSketchRelationOffers(graph, [point('a'), edge('ab')]);
    expect(find(end, 'midpoint')).toMatchObject({ state: 'blocked', reason: 'A midpoint must be distinct from both line endpoints and their declared coincident aliases.' });
    expect(find(end, 'point-on-line')).toMatchObject({ state: 'blocked', reason: 'The point must be distinct from both guide endpoints and their declared coincident aliases.' });
  });

  it('keep a point on an arc or circle, but never its own centre', () => {
    const graph = sketch();
    expect(cadSketchRelationOffers(graph, [point('m'), edge('c1')])).toEqual([{ kind: 'point-on-curve', state: 'available', operands: [[point('m'), edge('c1')]],
      relations: [{ kind: 'point-on-curve', pointId: 'm', curveId: 'c1' }], relationIds: [] }]);
    expect(find(cadSketchRelationOffers(graph, [point('o1'), edge('c1')]), 'point-on-curve')).toMatchObject({ state: 'blocked',
      reason: 'The point must be distinct from the curve center, its arc endpoints and their declared coincident aliases.' });
  });

  it('make two arcs or circles concentric through their centres, and of one radius', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [edge('c1'), edge('c2')]);
    expect(kinds(offers)).toEqual(['coincident', 'equal-radius']);
    expect(find(offers, 'coincident')).toMatchObject({ state: 'available', operands: [[edge('c1'), edge('c2')]], relations: [{ kind: 'coincident', pointIds: ['o1', 'o2'] }] });
    expectAddable(graph, offers);
    const centred = sketch([{ id: 'same', kind: 'coincident', pointIds: ['o2', 'o1'] }]);
    expect(find(cadSketchRelationOffers(centred, [edge('c1'), edge('c2')]), 'coincident')).toMatchObject({ state: 'applied', relationIds: ['same'] });
  });

  it('join a line and an arc smoothly at the one end they share', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [edge('arc1'), edge('bc')]);
    expect(find(offers, 'tangent-joint')).toMatchObject({ state: 'available', operands: [[edge('bc'), edge('arc1')]],
      relations: [{ kind: 'tangent-joint', endpoints: [{ entityId: 'bc', pointId: 'c' }, { entityId: 'arc1', pointId: 'c' }] }] });
    expectAddable(graph, offers);
    // A stored joint lists its curves in either order.
    const joined = sketch([{ id: 'smooth', kind: 'tangent-joint', endpoints: [{ entityId: 'arc1', pointId: 'c' }, { entityId: 'bc', pointId: 'c' }] }]);
    expect(find(cadSketchRelationOffers(joined, [edge('bc'), edge('arc1')]), 'tangent-joint')).toMatchObject({ state: 'applied', relationIds: ['smooth'] });
    expect(find(cadSketchRelationOffers(graph, [edge('ab'), edge('arc1')]), 'tangent-joint')).toMatchObject({ state: 'blocked',
      reason: 'Join these endpoints with Coincident before adding Tangent.' });
  });

  it('mirror two points, or a circle by its centre, about a line', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [point('a'), edge('axis'), point('b')]);
    expect(offers).toEqual([{ kind: 'symmetric', state: 'available', operands: [[point('a'), point('b'), edge('axis')]],
      relations: [{ kind: 'symmetric', pointIds: ['a', 'b'], lineId: 'axis' }], relationIds: [] }]);
    expect(find(cadSketchRelationOffers(graph, [edge('c1'), point('m'), edge('axis')]), 'symmetric').relations).toEqual([{ kind: 'symmetric', pointIds: ['o1', 'm'], lineId: 'axis' }]);
    expectAddable(graph, offers);
    expect(find(cadSketchRelationOffers(graph, [point('a'), point('u'), edge('axis')]), 'symmetric')).toMatchObject({ state: 'blocked',
      reason: 'Symmetric points and axis endpoints need four distinct declared identities.' });
  });

  it('fix a point where it is, unless a coordinate is an expression', () => {
    const graph = sketch([{ id: 'held', kind: 'fixed-point', pointId: 'b', position: [10, 0] }]);
    expect(cadSketchRelationOffers(graph, [point('a')])).toEqual([{ kind: 'fixed-point', state: 'available', operands: [[point('a')]],
      relations: [{ kind: 'fixed-point', pointId: 'a', position: [0, 0] }], relationIds: [] }]);
    expect(find(cadSketchRelationOffers(graph, [point('b')]), 'fixed-point')).toMatchObject({ state: 'applied', relationIds: ['held'] });
    expect(find(cadSketchRelationOffers(graph, [point('w')]), 'fixed-point')).toMatchObject({ state: 'blocked',
      reason: 'A coordinate written as an expression already follows it, so the point cannot be fixed where it is.' });
    // One blocked part blocks the offer, and names the parts already held.
    expect(find(cadSketchRelationOffers(graph, [point('a'), point('b'), point('w')]), 'fixed-point')).toMatchObject({ state: 'blocked', relationIds: ['held'] });
  });

  it('expand several points to Coincident with the first and a Fix for each', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [point('a'), point('m'), point('g')]);
    expect(kinds(offers)).toEqual(['coincident', 'fixed-point']);
    expect(find(offers, 'coincident').relations).toEqual([{ kind: 'coincident', pointIds: ['a', 'm'] }, { kind: 'coincident', pointIds: ['a', 'g'] }]);
    expect(find(offers, 'fixed-point').relations).toHaveLength(3);
  });

  it('offer nothing for an empty selection, a repeated pick, or one the graph lacks, and never a dimension or a composite', () => {
    const graph = sketch();
    expect(cadSketchRelationOffers(graph, [])).toEqual([]);
    expect(cadSketchRelationOffers(graph, [point('a'), point('a')])).toEqual([]);
    expect(cadSketchRelationOffers(graph, [point('a'), point('gone')])).toEqual([]);
    expect(cadSketchRelationOffers(graph, [edge('a')])).toEqual([]);
    expect(cadSketchRelationOffers(graph, [edge('ab'), point('m'), edge('c1'), edge('arc1')])).toEqual([]);
    const selections = [[point('a')], [point('a'), point('b')], [edge('ab')], [edge('ab'), edge('cd')], [edge('c1')], [edge('c1'), edge('arc1')], [point('m'), edge('arc1')]];
    for (const selection of selections) for (const offer of cadSketchRelationOffers(graph, selection)) {
      expect(CAD_SKETCH_RELATION_DEFINITIONS[offer.kind].offers?.length, offer.kind).toBeGreaterThan(0);
      expect(['dimension', 'composite']).not.toContain(CAD_SKETCH_RELATION_DEFINITIONS[offer.kind].family);
    }
  });

  it('read an accepted graph without changing it, and give the same frozen offers each time', () => {
    const graph = sketch([{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }]), before = JSON.stringify(graph);
    const first = cadSketchRelationOffers(graph, [edge('ab'), edge('cd')]), second = cadSketchRelationOffers(graph, [edge('ab'), edge('cd')]);
    expect(second).toEqual(first);
    expect(Object.isFrozen(first) && first.every(Object.isFrozen)).toBe(true);
    expect(JSON.stringify(graph)).toBe(before);
    // A copy the parser never accepted is read afresh and offers the same.
    expect(cadSketchRelationOffers(structuredClone(graph) as CadSketchGraph, [edge('ab'), edge('cd')])).toEqual(first);
  });
});
