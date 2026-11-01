import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph } from '../cadSketchGraph';
import type { CadSketchGraphSelection } from '../cadSketchGraphSelection';
import { cadSketchRelationOffers, type CadSketchRelationOffer } from '../sketch-relations/cadSketchRelationOffers';
import { CAD_SKETCH_RELATION_DEFINITIONS } from '../sketch-relations/cadSketchRelationRegistry';

const point = (id: string): CadSketchGraphSelection => ({ kind: 'point', id });
const edge = (id: string): CadSketchGraphSelection => ({ kind: 'entity', id });
const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line', construction: false, startPointId, endPointId });
// A square a-b-c-d with a loose point m, an axis line u-v, two circles and an arc that starts where line bc ends.
const sketch = (relations: readonly unknown[] = [], extraPoints: readonly unknown[] = [], extraEntities: readonly unknown[] = []) => parseCadSketchGraph({
  points: [
    { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }, { id: 'd', position: [0, 10] },
    { id: 'm', position: [5, 3] }, { id: 'u', position: [-5, -5] }, { id: 'v', position: [-5, 15] },
    { id: 'o1', position: [30, 0] }, { id: 'o2', position: [40, 0] }, { id: 'q', position: [15, 10] }, { id: 'g', position: [20, 10] },
    { id: 'w', position: ['width', 4] }, ...extraPoints
  ],
  entities: [
    line('ab', 'a', 'b'), line('bc', 'b', 'c'), line('cd', 'c', 'd'), line('axis', 'u', 'v'),
    { id: 'c1', kind: 'circle', construction: false, centerPointId: 'o1', radius: 2 }, { id: 'c2', kind: 'circle', construction: false, centerPointId: 'o2', radius: 3 },
    { id: 'arc1', kind: 'arc', construction: false, centerPointId: 'q', startPointId: 'c', endPointId: 'g', direction: 'cw' }, ...extraEntities
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
    expect(kinds(one)).toEqual(['horizontal', 'vertical', 'fixed-point']);
    expect(find(one, 'horizontal')).toMatchObject({ state: 'applied', relationIds: ['level'] });
    // A level line cannot also stand upright, as the Constrain tool says.
    expect(find(one, 'vertical')).toMatchObject({ state: 'blocked', reason: 'This is already horizontal.' });
    expect(find(cadSketchRelationOffers(graph, [edge('bc')]), 'vertical')).toMatchObject({ state: 'available', relations: [{ kind: 'vertical', pointIds: ['b', 'c'] }] });
    const three = cadSketchRelationOffers(graph, [edge('ab'), edge('bc'), edge('cd')]);
    // One already level: the others are added and the existing one named.
    expect(find(three, 'horizontal')).toEqual({ kind: 'horizontal', state: 'available', operands: [[edge('bc')], [edge('cd')]],
      relations: [{ kind: 'horizontal', pointIds: ['b', 'c'] }, { kind: 'horizontal', pointIds: ['c', 'd'] }], relationIds: ['level'] });
    expectAddable(graph, three);
  });

  it('refuse a direction other relations already rule out, directly or through a chain of them', () => {
    // ab is level and bc perpendicular to it, so bc stands upright, and cd, parallel to ab, is level too.
    const graph = sketch([{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'square', kind: 'perpendicular', lineIds: ['ab', 'bc'] },
      { id: 'across', kind: 'parallel', lineIds: ['cd', 'ab'] }]);
    expect(find(cadSketchRelationOffers(graph, [edge('bc')]), 'horizontal')).toMatchObject({ state: 'blocked', reason: 'This is already vertical through other relations.' });
    expect(find(cadSketchRelationOffers(graph, [edge('cd')]), 'horizontal')).toMatchObject({ state: 'blocked', reason: 'This is already horizontal through other relations.' });
    expect(find(cadSketchRelationOffers(graph, [point('c'), point('d')]), 'vertical')).toMatchObject({ state: 'blocked', reason: 'This is already horizontal through other relations.' });
    // Lines that keep one relation of direction, or an angle, take no other until it is removed; the same one is applied.
    const pair = cadSketchRelationOffers(graph, [edge('bc'), edge('ab')]);
    expect(find(pair, 'parallel')).toMatchObject({ state: 'blocked', reason: 'These lines already have a perpendicular relation. Remove it first.' });
    expect(find(pair, 'collinear')).toMatchObject({ state: 'blocked', reason: 'These lines already have a perpendicular relation. Remove it first.' });
    expect(find(pair, 'perpendicular')).toMatchObject({ state: 'applied', relationIds: ['square'] });
    const angled = sketch([{ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'ab', towardPointId: 'a' }, { lineId: 'bc', towardPointId: 'c' }], sense: 'ccw', value: 90 }]);
    expect(find(cadSketchRelationOffers(angled, [edge('ab'), edge('bc')]), 'perpendicular')).toMatchObject({ state: 'blocked', reason: 'These lines already have an angle. Remove it first.' });
  });

  it('pair the first of several lines with each later one', () => {
    const graph = sketch([{ id: 'kept', kind: 'parallel', lineIds: ['cd', 'ab'] }]);
    const offers = cadSketchRelationOffers(graph, [edge('ab'), edge('bc'), edge('cd')]);
    // Three lines also mirror the first two about the last; here bc ends at c, an end of cd, which only mirrors onto itself.
    expect(kinds(offers)).toEqual(['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'symmetric', 'equal-length', 'fixed-point']);
    expect(find(offers, 'symmetric')).toMatchObject({ state: 'blocked', operands: [[edge('ab'), edge('bc'), edge('cd')]],
      reason: 'A point at an end of the axis line can only mirror onto itself, so both curves need to share it.' });
    expect(find(offers, 'parallel')).toEqual({ kind: 'parallel', state: 'available', operands: [[edge('ab'), edge('bc')]],
      relations: [{ kind: 'parallel', lineIds: ['ab', 'bc'] }], relationIds: ['kept'] });
    expect(find(offers, 'equal-length').relations).toEqual([{ kind: 'equal-length', lineIds: ['ab', 'bc'] }, { kind: 'equal-length', lineIds: ['ab', 'cd'] }]);
    expectAddable(graph, offers);
  });

  it('put a point on a line or at its middle, in slot order whatever the pick order, unless it is one of its ends', () => {
    const graph = sketch();
    const offers = cadSketchRelationOffers(graph, [edge('ab'), point('m')]);
    expect(kinds(offers)).toEqual(['midpoint', 'point-on-line', 'fixed-point']);
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

  it('join a line and an arc smoothly at the one end they share, each end in the order of its pick', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [edge('arc1'), edge('bc')]);
    expect(find(offers, 'tangent-joint')).toMatchObject({ state: 'available', operands: [[edge('arc1'), edge('bc')]],
      relations: [{ kind: 'tangent-joint', endpoints: [{ entityId: 'arc1', pointId: 'c' }, { entityId: 'bc', pointId: 'c' }] }] });
    expect(find(cadSketchRelationOffers(graph, [edge('bc'), edge('arc1')]), 'tangent-joint').relations).toEqual([
      { kind: 'tangent-joint', endpoints: [{ entityId: 'bc', pointId: 'c' }, { entityId: 'arc1', pointId: 'c' }] }]);
    expectAddable(graph, offers);
    // Two lines are not a tangent's operands.
    expect(kinds(cadSketchRelationOffers(graph, [edge('ab'), edge('bc')]))).not.toContain('tangent-joint');
    // A stored joint lists its curves in either order.
    const joined = sketch([{ id: 'smooth', kind: 'tangent-joint', endpoints: [{ entityId: 'arc1', pointId: 'c' }, { entityId: 'bc', pointId: 'c' }] }]);
    expect(find(cadSketchRelationOffers(joined, [edge('bc'), edge('arc1')]), 'tangent-joint')).toMatchObject({ state: 'applied', relationIds: ['smooth'] });
    expect(find(cadSketchRelationOffers(graph, [edge('ab'), edge('arc1')]), 'tangent-joint')).toMatchObject({ state: 'blocked',
      reason: 'Join these endpoints with Coincident before adding Tangent.' });
  });

  it('mirror two points, or a circle by its centre, about a line', () => {
    const graph = sketch(), offers = cadSketchRelationOffers(graph, [point('a'), edge('axis'), point('b')]);
    // The axis line and the points also take a Fix for each.
    expect(offers).toEqual([{ kind: 'symmetric', state: 'available', operands: [[point('a'), point('b'), edge('axis')]],
      relations: [{ kind: 'symmetric', pointIds: ['a', 'b'], lineId: 'axis' }], relationIds: [] }, expect.objectContaining({ kind: 'fixed-point', state: 'available' })]);
    expect(find(cadSketchRelationOffers(graph, [edge('c1'), point('m'), edge('axis')]), 'symmetric').relations).toEqual([{ kind: 'symmetric', pointIds: ['o1', 'm'], lineId: 'axis' }]);
    expectAddable(graph, offers);
    expect(find(cadSketchRelationOffers(graph, [point('a'), point('u'), edge('axis')]), 'symmetric')).toMatchObject({ state: 'blocked',
      reason: 'Symmetric points and axis endpoints need four distinct declared identities.' });
  });

  it('never name a relation of a centre two picks share as holding Concentric or Symmetric, so removing it cannot delete an unrelated one', () => {
    // c2 and c3 are both centred on o2. Coincident r joins o2 to m, and Symmetric s mirrors o2 and a about the axis line.
    const graph = sketch([{ id: 'r', kind: 'coincident', pointIds: ['o2', 'm'] }, { id: 's', kind: 'symmetric', pointIds: ['o2', 'a'], lineId: 'axis' }], [],
      [{ id: 'c3', kind: 'circle', construction: false, centerPointId: 'o2', radius: 5 }]);
    for (const selection of [[edge('c2'), edge('c3')], [edge('c3'), edge('c2')]]) {
      expect(find(cadSketchRelationOffers(graph, selection), 'coincident')).toEqual({ kind: 'coincident', state: 'blocked', reason: 'These already share a center.',
        operands: [selection], relations: [], relationIds: [] });
    }
    const mirror = 'Symmetric points and axis endpoints need four distinct declared identities.', shared = 'These circles share a center, so they cannot mirror each other.';
    for (const [selection, reason] of [[[point('o2'), edge('c2'), edge('axis')], mirror], [[edge('c3'), edge('axis'), point('o2')], mirror], [[edge('c2'), edge('c3'), edge('axis')], shared]] as const) {
      expect(find(cadSketchRelationOffers(graph, selection), 'symmetric'), selection.map(pick => pick.id).join(' ')).toMatchObject({ state: 'blocked', reason, relations: [], relationIds: [] });
    }
    // Two distinct places still name the relations that hold them, and only those.
    expect(find(cadSketchRelationOffers(graph, [point('o2'), point('m')]), 'coincident')).toMatchObject({ state: 'applied', relationIds: ['r'] });
    expect(find(cadSketchRelationOffers(graph, [edge('c3'), point('a'), edge('axis')]), 'symmetric')).toMatchObject({ state: 'applied', relationIds: ['s'] });
  });

  it('fix a point where it is, or each numeric coordinate that nothing holds yet, and never one joined to a fixed point', () => {
    const graph = sketch([{ id: 'held', kind: 'fixed-point', pointId: 'b', position: [10, 0] }, { id: 'onto', kind: 'coincident', pointIds: ['g', 'b'] },
      { id: 'across', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 10 }, { id: 'up', kind: 'fixed-axis', pointId: 'd', axis: 'x', value: 0 },
      { id: 'over', kind: 'fixed-axis', pointId: 'd', axis: 'y', value: 10 }]);
    expect(cadSketchRelationOffers(graph, [point('a')])).toEqual([{ kind: 'fixed-point', state: 'available', operands: [[point('a')]],
      relations: [{ kind: 'fixed-point', pointId: 'a', position: [0, 0] }], relationIds: [] }]);
    expect(find(cadSketchRelationOffers(graph, [point('b')]), 'fixed-point')).toMatchObject({ state: 'applied', relationIds: ['held'] });
    // A point coincident with a fixed one is held by it.
    expect(find(cadSketchRelationOffers(graph, [point('g')]), 'fixed-point')).toMatchObject({ state: 'applied', relationIds: ['held'] });
    // An expression coordinate follows its expression, and a coordinate held already keeps its relation: the other is held alone.
    expect(find(cadSketchRelationOffers(graph, [point('w')]), 'fixed-point')).toMatchObject({ state: 'available', relations: [{ kind: 'fixed-axis', pointId: 'w', axis: 'y', value: 4 }] });
    expect(find(cadSketchRelationOffers(graph, [point('c')]), 'fixed-point')).toMatchObject({ state: 'available', relations: [{ kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 10 }] });
    expect(find(cadSketchRelationOffers(graph, [point('d')]), 'fixed-point')).toMatchObject({ state: 'applied', relationIds: ['up', 'over'] });
    const free = sketch([], [{ id: 'z', position: ['width', 'width / 2'] }]);
    expect(find(cadSketchRelationOffers(free, [point('z')]), 'fixed-point')).toEqual({ kind: 'fixed-point', state: 'blocked', reason: 'This point is already fixed or follows expressions.',
      operands: [[point('z')]], relations: [], relationIds: [] });
    // One blocked part blocks the offer, and names the parts already held.
    expect(find(cadSketchRelationOffers(sketch([{ id: 'held', kind: 'fixed-point', pointId: 'b', position: [10, 0] }], [{ id: 'z', position: ['width', 'width / 2'] }]),
      [point('a'), point('b'), point('z')]), 'fixed-point')).toMatchObject({ state: 'blocked', relationIds: ['held'] });
    expect(find(cadSketchRelationOffers(graph, [point('a'), point('b'), point('w')]), 'fixed-point')).toMatchObject({ state: 'available', relationIds: ['held'],
      relations: [{ kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { kind: 'fixed-axis', pointId: 'w', axis: 'y', value: 4 }] });
    expectAddable(graph, cadSketchRelationOffers(graph, [point('a'), point('c'), point('w')]));
  });

  it('fix a whole line or arc through its points, shared corners once, and never a circle', () => {
    const graph = sketch();
    expect(find(cadSketchRelationOffers(graph, [edge('ab')]), 'fixed-point')).toEqual({ kind: 'fixed-point', state: 'available', operands: [[edge('ab')]],
      relations: [{ kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { kind: 'fixed-point', pointId: 'b', position: [10, 0] }], relationIds: [] });
    // Two edges that share b fix it once; the arc fixes its centre and both ends, c among them only once.
    const chain = find(cadSketchRelationOffers(graph, [edge('ab'), edge('bc'), edge('arc1')]), 'fixed-point');
    expect(chain.relations.map(relation => relation.kind === 'fixed-point' ? relation.pointId : null)).toEqual(['a', 'b', 'c', 'q', 'g']);
    expectAddable(graph, [chain]);
    // A point and an edge mix in one selection, as a box selection gives them.
    expect(find(cadSketchRelationOffers(graph, [point('m'), edge('cd')]), 'fixed-point').relations).toHaveLength(3);
    const held = sketch([{ id: 'fa', kind: 'fixed-point', pointId: 'a', position: [0, 0] }, { id: 'fb', kind: 'fixed-point', pointId: 'b', position: [10, 0] }]);
    expect(find(cadSketchRelationOffers(held, [edge('ab')]), 'fixed-point')).toMatchObject({ state: 'applied', relationIds: ['fa', 'fb'] });
    expect(find(cadSketchRelationOffers(held, [edge('bc')]), 'fixed-point')).toMatchObject({ state: 'available', relationIds: [], relations: [{ kind: 'fixed-point', pointId: 'c' }] });
    expect(cadSketchRelationOffers(graph, [edge('c1')]).some(offer => offer.kind === 'fixed-point')).toBe(false);
    expect(cadSketchRelationOffers(graph, [edge('ab'), edge('c1')]).some(offer => offer.kind === 'fixed-point')).toBe(false);
  });

  it('plan each part with the relations the parts before it add, as the tool would add them one after another', () => {
    const graph = sketch([{ id: 'joined', kind: 'coincident', pointIds: ['a', 'm'] }]);
    // Fixing a fixes m, which is joined to it.
    expect(find(cadSketchRelationOffers(graph, [point('a'), point('m')]), 'fixed-point')).toEqual({ kind: 'fixed-point', state: 'available', operands: [[point('a')]],
      relations: [{ kind: 'fixed-point', pointId: 'a', position: [0, 0] }], relationIds: [] });
    expect(find(cadSketchRelationOffers(sketch(), [point('b'), point('g'), point('m')]), 'coincident')).toMatchObject({ state: 'available',
      relations: [{ kind: 'coincident', pointIds: ['b', 'g'] }, { kind: 'coincident', pointIds: ['b', 'm'] }] });
    // With g and m joined already, joining b to g joins it to m too.
    expect(find(cadSketchRelationOffers(sketch([{ id: 'end', kind: 'coincident', pointIds: ['g', 'm'] }]), [point('b'), point('g'), point('m')]), 'coincident'))
      .toMatchObject({ state: 'blocked', reason: 'These points are already joined.' });
  });

  it('name the relations that hold the parts in graph order, whatever order the parts come in', () => {
    const first = { id: 'first', kind: 'parallel', lineIds: ['ab', 'cd'] }, second = { id: 'second', kind: 'parallel', lineIds: ['ab', 'bc'] };
    expect(find(cadSketchRelationOffers(sketch([first, second]), [edge('ab'), edge('bc'), edge('cd')]), 'parallel')).toMatchObject({ state: 'applied', relationIds: ['first', 'second'] });
    expect(find(cadSketchRelationOffers(sketch([second, first]), [edge('ab'), edge('bc'), edge('cd')]), 'parallel')).toMatchObject({ state: 'applied', relationIds: ['second', 'first'] });
    expect(find(cadSketchRelationOffers(sketch([first, second]), [edge('ab'), edge('cd'), edge('bc')]), 'parallel')).toMatchObject({ state: 'applied', relationIds: ['first', 'second'] });
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
