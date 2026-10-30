import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph } from '../cadSketchGraph';
import {
  cadSketchDimensionAngleSectorAt, cadSketchDimensionCandidateAt, cadSketchDimensionPickEligibility, cadSketchDimensionPreselection, cadSketchDimensionRelationsAt,
  cadSketchDimensionRetry, cadSketchPointPairDimensionForm,
  planCadSketchDimension, type CadSketchDimensionCandidate, type CadSketchDimensionOperand, type CadSketchDimensionPlan
} from '@/features/cad/cadSketchDimensionPlacement';
import { layoutCadSketchDimensionPreview } from '@/features/cad/cadSketchGraphDimensionLayout';

const ids = () => { let next = 0; return () => `new-${++next}`; };
const point = (id: string): CadSketchDimensionOperand => ({ kind: 'point', id });
const entity = (id: string): CadSketchDimensionOperand => ({ kind: 'entity', id });
const datum = (id: 'origin' | 'x-axis' | 'y-axis'): CadSketchDimensionOperand => ({ kind: 'datum', id });
const plan = (graph: CadSketchGraph, operands: readonly CadSketchDimensionOperand[], parameters: Record<string, number> = {}) =>
  planCadSketchDimension(graph, parameters, operands, ids());
const candidate = (result: CadSketchDimensionPlan, form: CadSketchDimensionCandidate['form']) => {
  const found = result.candidates.find(item => item.form === form);
  if (!found) throw new Error(`No ${form} candidate.`);
  return found;
};
const available = (result: CadSketchDimensionPlan, form: CadSketchDimensionCandidate['form']) => {
  const found = candidate(result, form);
  if (found.state !== 'available') throw new Error(`${form} is ${found.state}: ${'reason' in found ? found.reason : ''}`);
  return found;
};

/** A 40 × 20 rectangle at (10, 5), two of its sides parallel lines, plus a slanted line, a circle and an arc. */
function sketch(relations: unknown[] = []) {
  return parseCadSketchGraph({ points: [
    { id: 'a', position: [10, 5] }, { id: 'b', position: [50, 5] }, { id: 'c', position: [50, 25] }, { id: 'd', position: [10, 25] },
    { id: 's0', position: [60, 0] }, { id: 's1', position: [70, 10] },
    { id: 'o', position: [80, 40] }, { id: 'arc-center', position: [0, 60] }, { id: 'arc-start', position: [5, 60] }, { id: 'arc-end', position: [0, 65] }
  ], entities: [
    { id: 'bottom', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'right', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
    { id: 'top', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
    { id: 'slant', kind: 'line', startPointId: 's0', endPointId: 's1', construction: false },
    { id: 'hole', kind: 'circle', centerPointId: 'o', radius: 'bore / 2', construction: false },
    { id: 'bend', kind: 'arc', centerPointId: 'arc-center', startPointId: 'arc-start', endPointId: 'arc-end', direction: 'ccw', construction: false }
  ], relations });
}

describe('dimension type by pointer position', () => {
  const a = { x: 0, y: 0 }, b = { x: 40, y: 20 };
  it.each([
    [{ x: 60, y: 10 }, 'vertical'], [{ x: -5, y: 0 }, 'vertical'], [{ x: 20, y: 30 }, 'horizontal'], [{ x: 40, y: -1 }, 'horizontal'],
    [{ x: 20, y: 10 }, 'aligned'], [{ x: 0, y: 20 }, 'aligned'], [{ x: 60, y: 30 }, 'aligned'], [{ x: -10, y: -10 }, 'aligned']
  ] as const)('reads a pointer at %o as %s', (pointer, form) => {
    expect(cadSketchPointPairDimensionForm(a, b, pointer)).toBe(form);
    expect(cadSketchPointPairDimensionForm(b, a, pointer)).toBe(form);
  });
  it('keeps a level or upright pair aligned wherever the pointer is', () => {
    for (const pointer of [{ x: 20, y: 30 }, { x: 60, y: 0 }, { x: 20, y: 0 }]) {
      expect(cadSketchPointPairDimensionForm({ x: 0, y: 0 }, { x: 40, y: 1e-12 }, pointer)).toBe('aligned');
      expect(cadSketchPointPairDimensionForm({ x: 0, y: 0 }, { x: 0, y: 40 }, pointer)).toBe('aligned');
    }
  });
});

describe('dimension plans per pick kind', () => {
  it('measures one line as its length wherever the pointer is, and names its horizontal and vertical distances', () => {
    const graph = sketch(), exact = JSON.stringify(graph), result = plan(graph, [entity('slant')]);
    const length = available(result, 'aligned');
    expect(length.label).toBe('Length');
    expect(length.relations).toEqual([{ id: 'new-1', kind: 'distance', pointIds: ['s0', 's1'], value: Math.hypot(10, 10) }]);
    expect(length.reference).toEqual({ id: 'new-1', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'slant' } });
    // Only a pair of positions lets the pointer choose; one line's projections are there to name.
    expect(result.defaultForm).toBe('aligned'); expect(result.pair).toBeNull();
    for (const pointer of [null, { x: 65, y: 20 }, { x: 90, y: 5 }, { x: 65, y: -10 }]) expect(cadSketchDimensionCandidateAt(result, pointer)).toBe(length);
    expect(available(result, 'horizontal').relations).toEqual([{ id: 'new-2', kind: 'axis-distance', pointIds: ['s0', 's1'], axis: 'x', value: 10 }]);
    expect(available(result, 'horizontal').referenceReason).toMatch(/no reference form/);
    expect(available(result, 'vertical').relations).toEqual([{ id: 'new-3', kind: 'axis-distance', pointIds: ['s0', 's1'], axis: 'y', value: 10 }]);
    expect(JSON.stringify(graph)).toBe(exact);
  });

  it('places a slanted line\'s length above and beside it, never its horizontal or vertical projection', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'p', position: [0, 0] }, { id: 'q', position: [40, 20] }],
      entities: [{ id: 'line', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false }], relations: [] });
    const result = plan(graph, [entity('line')]);
    for (const pointer of [{ x: 20, y: 40 }, { x: 60, y: 10 }, { x: 20, y: -30 }, { x: -20, y: 10 }]) {
      const placed = cadSketchDimensionCandidateAt(result, pointer);
      if (placed?.state !== 'available') throw new Error('Expected the length.');
      expect(cadSketchDimensionRelationsAt(placed, pointer).relations).toEqual([{ id: 'new-1', kind: 'distance', pointIds: ['p', 'q'], value: Math.hypot(40, 20) }]);
      expect(layoutCadSketchDimensionPreview(placed.preview, pointer, .1).map(mark => [mark.kind, mark.value])).toEqual([['distance', Math.hypot(40, 20)]]);
    }
    expect(candidate(result, 'horizontal')).toMatchObject({ state: 'available', relations: [{ kind: 'axis-distance', axis: 'x', value: 40 }] });
    expect(candidate(result, 'vertical')).toMatchObject({ state: 'available', relations: [{ kind: 'axis-distance', axis: 'y', value: 20 }] });
  });

  it('orders a horizontal distance from its left point so its value reads positive', () => {
    const result = plan(sketch(), [point('c'), point('a')]);
    expect(available(result, 'horizontal').relations[0]).toMatchObject({ kind: 'axis-distance', pointIds: ['a', 'c'], axis: 'x', value: 40 });
    expect(available(result, 'vertical').relations[0]).toMatchObject({ kind: 'axis-distance', pointIds: ['a', 'c'], axis: 'y', value: 20 });
    expect(available(result, 'aligned')).toMatchObject({ label: 'Aligned distance', reference: { measurement: { kind: 'point-distance', pointIds: ['c', 'a'] } } });
  });

  it('blocks the horizontal distance of an upright pair and keeps the pointer on the aligned one', () => {
    const result = plan(sketch(), [entity('right')]);
    expect(candidate(result, 'horizontal')).toMatchObject({ state: 'blocked', reason: 'These points are upright, so they have no horizontal distance.' });
    expect(result.candidates.map(item => item.state)).toEqual(['available', 'blocked', 'available']);
    expect(cadSketchDimensionCandidateAt(result, { x: 50, y: 40 })?.form).toBe('aligned');
  });

  it('selects an existing dimension instead of planning a second one', () => {
    const result = plan(sketch([{ id: 'width', kind: 'distance', pointIds: ['b', 'a'], value: 40 }]), [entity('bottom')]);
    expect(candidate(result, 'aligned')).toMatchObject({ state: 'existing', relationId: 'width' });
    const referenced = plan(sketch([{ id: 'measured', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'slant' } }]), [entity('slant')]);
    expect(candidate(referenced, 'aligned')).toMatchObject({ state: 'existing', relationId: 'measured' });
  });

  it('sizes a circle as a diameter and an arc as a radius, each with its other form and its reference', () => {
    const circle = plan(sketch(), [entity('hole')], { bore: 12 });
    expect(circle.defaultForm).toBe('diameter');
    expect(candidate(circle, 'diameter')).toMatchObject({ state: 'blocked', reason: 'The circle radius follows its source expression. Edit that expression instead.' });
    const arc = plan(sketch(), [entity('bend')]);
    expect(arc.defaultForm).toBe('radius');
    expect(available(arc, 'radius').relations).toEqual([{ id: 'new-1', kind: 'radial-size', entityId: 'bend', quantity: 'radius', value: 5 }]);
    expect(available(arc, 'diameter')).toMatchObject({ relations: [{ quantity: 'diameter', value: 10 }], reference: { measurement: { kind: 'radial-size', quantity: 'diameter' } } });
    expect(cadSketchDimensionCandidateAt(arc, { x: 100, y: 100 })?.form).toBe('radius');
    expect(planCadSketchDimension(sketch(), {}, [entity('bend')], ids(), [])).toEqual(expect.objectContaining({ candidates: [] }));
  });

  it('measures a point to a line and gives two parallel lines a distance with an implied Parallel', () => {
    const graph = sketch(), pointLine = plan(graph, [point('s1'), entity('bottom')]);
    expect(available(pointLine, 'point-line')).toMatchObject({ relations: [{ kind: 'point-line-distance', pointId: 's1', lineId: 'bottom', value: 5 }],
      reference: { kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 's1', lineId: 'bottom' } }, preview: { kind: 'point-line', value: 5 } });
    const lines = plan(graph, [entity('bottom'), entity('top')]), distance = available(lines, 'point-line');
    expect(lines.defaultForm).toBe('point-line');
    expect(distance.relations).toHaveLength(2);
    expect(distance.relations[0]).toMatchObject({ kind: 'point-line-distance', value: 20 });
    expect(distance.relations[1]).toMatchObject({ id: distance.implied, kind: 'parallel', lineIds: ['bottom', 'top'] });
    expect(candidate(lines, 'angle')).toMatchObject({ state: 'blocked', reason: 'These lines are parallel, so they have no angle.' });
    const kept = plan(sketch([{ id: 'p', kind: 'parallel', lineIds: ['top', 'bottom'] }]), [entity('bottom'), entity('top')]);
    expect(available(kept, 'point-line')).toMatchObject({ implied: null, relations: [{ kind: 'point-line-distance' }] });
  });

  it('reuses a distance to one end of the other line and adds the Parallel that keeps it measuring the gap', () => {
    const gap = { id: 'gap', kind: 'point-line-distance', pointId: 'c', lineId: 'bottom', side: 'left', value: 20 };
    const reused = available(plan(sketch([gap]), [entity('top'), entity('bottom')]), 'point-line');
    expect(reused).toMatchObject({ reuses: 'gap', relations: [{ id: reused.implied, kind: 'parallel', lineIds: ['top', 'bottom'] }], reference: null, preview: { value: 20 } });
    // Once Parallel holds the lines, the distance already keeps the gap.
    expect(candidate(plan(sketch([gap, { id: 'p', kind: 'parallel', lineIds: ['bottom', 'top'] }]), [entity('top'), entity('bottom')]), 'point-line'))
      .toMatchObject({ state: 'existing', relationId: 'gap' });
    // A reference keeps nothing, so it is only selected.
    expect(candidate(plan(sketch([{ id: 'ref', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'c', lineId: 'bottom' } }]), [entity('bottom'), entity('top')]), 'point-line'))
      .toMatchObject({ state: 'existing', relationId: 'ref' });
  });

  it('offers the reference of a zero distance that no driving dimension can take', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'p', position: [0, 0] }, { id: 'q', position: [40, 0] }, { id: 'on', position: [15, 0] }, { id: 'twin', position: [40, 0] }, { id: 'joined', position: [0, 0] }],
      entities: [{ id: 'line', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false }], relations: [{ id: 'join', kind: 'coincident', pointIds: ['p', 'joined'] }] });
    // A distinct point lying on the line.
    const onLine = candidate(plan(graph, [point('on'), entity('line')]), 'point-line');
    expect(onLine).toMatchObject({ state: 'blocked', reason: 'The point lies on the line. Use Point on line to keep it there.',
      reference: { kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'on', lineId: 'line' } }, preview: { kind: 'point-line', value: 0 } });
    if (onLine.state !== 'blocked' || !onLine.preview) throw new Error('Expected a reference preview.');
    expect(layoutCadSketchDimensionPreview(onLine.preview, { x: 15, y: 5 }, .1)).toHaveLength(1);
    // Two distinct points at one position.
    const twins = plan(graph, [point('q'), point('twin')]), aligned = candidate(twins, 'aligned');
    expect(aligned).toMatchObject({ state: 'blocked', reason: 'These points share one position, so they have no distance.',
      reference: { kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['q', 'twin'] } }, preview: { kind: 'pair', value: 0 } });
    expect(cadSketchDimensionCandidateAt(twins, { x: 50, y: 10 })).toBe(aligned);
    expect(candidate(twins, 'horizontal')).not.toHaveProperty('reference');
    if (aligned.state !== 'blocked' || !aligned.preview) throw new Error('Expected a reference preview.');
    expect(layoutCadSketchDimensionPreview(aligned.preview, { x: 40, y: 6 }, .1).map(mark => [mark.kind, mark.value])).toEqual([['distance', 0]]);
    // Joined points are one point, so they take nothing; an existing reference of the zero distance is selected.
    expect(plan(graph, [point('p'), point('joined')]).candidates.every(item => item.state === 'blocked' && !item.reference)).toBe(true);
    const measured = parseCadSketchGraph({ ...graph, relations: [...graph.relations, { id: 'zero', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'on', lineId: 'line' } }] });
    expect(candidate(plan(measured, [point('on'), entity('line')]), 'point-line')).toMatchObject({ state: 'existing', relationId: 'zero', preview: { value: 0 } });
  });

  it('gives other line pairs an angle in the sector holding the pointer', () => {
    const result = plan(sketch(), [entity('bottom'), entity('slant')]), angle = available(result, 'angle');
    expect(result.defaultForm).toBe('angle');
    expect(candidate(result, 'point-line').state).toBe('blocked');
    if (angle.preview.kind !== 'angle') throw new Error('Expected an angle preview.');
    expect(angle.preview.sectors.length).toBeGreaterThanOrEqual(2);
    // The bottom line's support meets the slant at (65, 5): below the bottom line's ray the opening is 45°, above it 135°.
    const acute = cadSketchDimensionRelationsAt(angle, { x: 55, y: 3 });
    expect(acute.relations?.[0]).toMatchObject({ kind: 'line-angle', value: 45 });
    const obtuse = cadSketchDimensionRelationsAt(angle, { x: 60, y: 10 });
    expect(obtuse.relations?.[0]).toMatchObject({ kind: 'line-angle', value: 135 });
    expect(cadSketchDimensionAngleSectorAt(angle.preview, null)).toBe(angle.preview.fallback === null ? null : angle.preview.sectors[angle.preview.fallback]);
    const blocked = plan(sketch([{ id: 'square', kind: 'perpendicular', lineIds: ['bottom', 'right'] }]), [entity('bottom'), entity('right')]);
    expect(candidate(blocked, 'angle')).toMatchObject({ state: 'blocked', reason: 'Remove Perpendicular before adding Angle.' });
  });

  it('measures center distances and blocks a point paired with its own center', () => {
    const result = plan(sketch(), [entity('bend'), point('a')]);
    expect(available(result, 'aligned').relations[0]).toMatchObject({ kind: 'distance', pointIds: ['a', 'arc-center'] });
    expect(candidate(plan(sketch(), [point('arc-center'), entity('bend')]), 'aligned')).toMatchObject({ state: 'blocked', reason: 'This point is the center. Pick another point.' });
  });
});

describe('dimension pick rules', () => {
  const edges = ['bottom', 'right', 'top', 'slant', 'hole', 'bend'], corners = ['a', 'b', 'c', 'd', 's0', 's1', 'o', 'arc-center', 'arc-start', 'arc-end'];
  // `top` stands for a linked edge: it can be picked, but takes no size of its own.
  const targets = { entityIds: edges, sizedEntityIds: edges.filter(id => id !== 'top'), pointIds: corners };
  const next = (operands: readonly CadSketchDimensionOperand[]) => cadSketchDimensionPickEligibility(sketch(), targets, operands);

  it('offers each next pick the rules allow, and nothing once two are picked', () => {
    expect(next([])).toEqual({ entityIds: edges, pointIds: corners, datums: ['origin', 'x-axis', 'y-axis'] });
    // A point skips the lines it ends and itself; a line skips its own ends and the origin, and may be picked again for its length.
    expect(next([point('a')])).toEqual({ entityIds: ['right', 'top', 'slant', 'hole', 'bend'], pointIds: corners.filter(id => id !== 'a'), datums: ['origin', 'x-axis', 'y-axis'] });
    expect(next([entity('bottom')])).toEqual({ entityIds: edges, pointIds: corners.filter(id => id !== 'a' && id !== 'b'), datums: ['x-axis', 'y-axis'] });
    expect(next([entity('hole')])).toEqual({ entityIds: edges, pointIds: corners.filter(id => id !== 'o'), datums: ['origin', 'x-axis', 'y-axis'] });
    expect(next([datum('origin')])).toEqual({ entityIds: ['hole', 'bend'], pointIds: corners, datums: [] });
    expect(next([datum('y-axis')])).toEqual({ entityIds: edges, pointIds: corners, datums: [] });
    expect(next([point('a'), point('c')])).toEqual({ entityIds: [], pointIds: [], datums: [] });
  });

  it('pairs a linked edge with other picks but never sizes it on its own', () => {
    expect(next([entity('top')]).entityIds).toEqual(edges.filter(id => id !== 'top'));
    expect(planCadSketchDimension(sketch(), {}, [entity('top')], ids(), targets.sizedEntityIds).candidates).toEqual([]);
    expect(available(planCadSketchDimension(sketch(), {}, [entity('top'), entity('bottom')], ids(), targets.sizedEntityIds), 'point-line').preview).toMatchObject({ value: 20 });
    expect(available(planCadSketchDimension(sketch(), {}, [entity('bottom')], ids(), targets.sizedEntityIds), 'aligned').preview).toMatchObject({ value: 40 });
  });

  it('starts from a preselection the tool takes in its own order, and from none it cannot take', () => {
    const preselect = (operands: readonly CadSketchDimensionOperand[]) => cadSketchDimensionPreselection(sketch(), targets, operands);
    expect(preselect([datum('x-axis'), point('c')])).toEqual([datum('x-axis'), point('c')]);
    expect(preselect([entity('bottom'), datum('y-axis')])).toEqual([entity('bottom'), datum('y-axis')]);
    expect(preselect([point('a'), entity('slant')])).toEqual([point('a'), entity('slant')]);
    expect(preselect([entity('bottom'), datum('origin')])).toEqual([]);
    expect(preselect([point('a'), entity('bottom')])).toEqual([]);
    expect(preselect([entity('bottom'), entity('bottom')])).toEqual([]);
    expect(preselect([point('a'), point('b'), point('c')])).toEqual([]);
  });
});

describe('dimensions to the origin and axes', () => {
  it('holds a point at its distance from an axis in either pick order, and an arc center the same way', () => {
    for (const operands of [[point('c'), datum('x-axis')], [datum('x-axis'), point('c')]]) {
      const fromX = plan(sketch(), operands);
      expect(fromX.candidates).toHaveLength(1);
      // An axis is a line, so the distance from it is named as any other; the axis stays in reasons.
      expect(available(fromX, 'datum')).toMatchObject({ label: 'Distance', relations: [{ kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 25 }],
        reference: null, preview: { kind: 'datum', axes: ['y'] } });
    }
    expect(available(plan(sketch(), [datum('x-axis'), entity('bend')]), 'datum').relations).toEqual([{ id: 'new-1', kind: 'fixed-axis', pointId: 'arc-center', axis: 'y', value: 60 }]);
    // Its preview is drawn as placed: square to the axis, labelled with its size whichever side of the axis the point is on.
    const below = available(plan(parseCadSketchGraph({ ...sketch(), points: sketch().points.map(item => item.id === 'c' ? { ...item, position: [50, -25] } : item) }), [datum('x-axis'), point('c')]), 'datum');
    expect(below.relations).toMatchObject([{ kind: 'fixed-axis', axis: 'y', value: -25 }]);
    expect(layoutCadSketchDimensionPreview(below.preview, { x: 70, y: -10 }, .1).map(mark => [mark.kind, mark.value])).toEqual([['distance', 25]]);
  });

  it('takes no distance from an axis for a point or line on it, and says Coincident keeps it there', () => {
    expect(candidate(plan(sketch(), [datum('y-axis'), entity('bend')]), 'datum')).toEqual({ form: 'datum', label: 'Distance', state: 'blocked',
      reason: 'This point is on the Y axis, so it has no distance from it. Use Coincident to keep it there.' });
    const graph = parseCadSketchGraph({ ...sketch(), points: sketch().points.map(item => item.id === 'b' || item.id === 'c' ? { ...item, position: [0, item.position[1]] } : item) });
    expect(candidate(plan(graph, [entity('right'), datum('y-axis')]), 'datum')).toMatchObject({ state: 'blocked',
      reason: 'This line is on the Y axis, so it has no distance from it. Use Coincident to keep it there.' });
    // A line across the axis keeps its own refusal, even with an end on it.
    expect(candidate(plan(graph, [datum('x-axis'), entity('right')]), 'datum')).toMatchObject({ state: 'blocked', reason: 'This line is not parallel to the X axis, so it has no distance from it.' });
  });

  it('gives a point and the origin its position, or one coordinate by the pointer region', () => {
    const result = plan(sketch(), [datum('origin'), point('c')]);
    expect(result.pair).toEqual([{ x: 0, y: 0 }, { x: 50, y: 25 }]);
    expect(available(result, 'datum').relations.map(relation => relation.kind === 'fixed-axis' && relation.axis)).toEqual(['x', 'y']);
    expect(cadSketchDimensionCandidateAt(result, { x: 20, y: 10 })?.form).toBe('datum');
    expect(cadSketchDimensionCandidateAt(result, { x: 20, y: 40 })?.form).toBe('horizontal');
    expect(cadSketchDimensionCandidateAt(result, { x: 70, y: 10 })?.form).toBe('vertical');
    const held = plan(sketch([{ id: 'x', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 50 }]), [datum('origin'), point('c')]);
    expect(available(held, 'datum').relations).toEqual([{ id: 'new-1', kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 25 }]);
    expect(candidate(held, 'horizontal')).toMatchObject({ state: 'existing', relationId: 'x' });
  });

  it('holds a line along an axis at its distance, in either pick order, and defers the angle to an axis', () => {
    for (const operands of [[entity('top'), datum('x-axis')], [datum('x-axis'), entity('top')]]) {
      const result = plan(sketch(), operands), distance = available(result, 'datum');
      expect(distance.relations).toEqual([{ id: 'new-2', kind: 'fixed-axis', pointId: 'c', axis: 'y', value: 25 }, { id: 'new-1', kind: 'horizontal', pointIds: ['c', 'd'] }]);
      expect(distance.implied).toBe('new-1');
      expect(candidate(result, 'angle')).toMatchObject({ state: 'blocked', reason: expect.stringContaining('angle to the X axis is not available yet') });
    }
    const level = plan(sketch([{ id: 'h', kind: 'horizontal', pointIds: ['d', 'c'] }]), [entity('top'), datum('x-axis')]);
    expect(available(level, 'datum')).toMatchObject({ implied: null, relations: [{ kind: 'fixed-axis' }] });
    expect(candidate(plan(sketch(), [entity('slant'), datum('y-axis')]), 'datum')).toMatchObject({ state: 'blocked', reason: 'This line is not parallel to the Y axis, so it has no distance from it.' });
    expect(candidate(plan(sketch(), [entity('right'), datum('origin')]), 'datum').state).toBe('blocked');
  });

  it('reuses one end held from the axis and adds the Horizontal that keeps the line at that distance', () => {
    const line = (relations: unknown[]) => parseCadSketchGraph({ points: [{ id: 'p', position: [10, 10] }, { id: 'q', position: [50, 10] }],
      entities: [{ id: 'line', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false }], relations });
    // Only the first end's Y is held, so the other end could still move up or down.
    const result = plan(line([{ id: 'held', kind: 'fixed-axis', pointId: 'p', axis: 'y', value: 10 }]), [entity('line'), datum('x-axis')]);
    expect(available(result, 'datum')).toMatchObject({ reuses: 'held', implied: 'new-1', relations: [{ id: 'new-1', kind: 'horizontal', pointIds: ['p', 'q'] }], reference: null });
    // A hold on the other end is reused the same way.
    expect(available(plan(line([{ id: 'held', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 10 }]), [datum('x-axis'), entity('line')]), 'datum'))
      .toMatchObject({ reuses: 'held', relations: [{ kind: 'horizontal' }] });
    // With Horizontal, or both ends held, the hold already keeps the distance, so placing only selects it.
    for (const kept of [[{ id: 'level', kind: 'horizontal', pointIds: ['q', 'p'] }], [{ id: 'other', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 10 }]])
      expect(candidate(plan(line([{ id: 'held', kind: 'fixed-axis', pointId: 'p', axis: 'y', value: 10 }, ...kept]), [entity('line'), datum('x-axis')]), 'datum'))
        .toMatchObject({ state: 'existing', relationId: 'held' });
  });
});

describe('preview measurement', () => {
  it('draws the dimension line through the pointer with the measured value', () => {
    const result = plan(sketch(), [point('a'), point('c')]);
    const aligned = available(result, 'aligned'), [mark] = layoutCadSketchDimensionPreview(aligned.preview, { x: 20, y: 20 }, .1);
    expect(mark).toMatchObject({ kind: 'distance', value: Math.hypot(40, 20) });
    const horizontal = available(result, 'horizontal'), [level] = layoutCadSketchDimensionPreview(horizontal.preview, { x: 30, y: 40 }, .1);
    expect(level).toMatchObject({ kind: 'distance-x', value: 40, line: [[10, 40], [50, 40]] });
    const vertical = available(result, 'vertical'), [upright] = layoutCadSketchDimensionPreview(vertical.preview, { x: 70, y: 15 }, .1);
    expect(upright).toMatchObject({ kind: 'distance-y', value: 20, line: [[70, 5], [70, 25]] });
  });

  it('draws a datum per axis and a radial size toward the pointer', () => {
    // Each coordinate from the origin previews as the distance from its axis it places, labelled with its size.
    const position = available(plan(sketch(), [datum('origin'), point('c')]), 'datum');
    expect(layoutCadSketchDimensionPreview(position.preview, { x: 20, y: 10 }, .1).map(mark => [mark.kind, mark.value])).toEqual([['distance', 50], ['distance', 25]]);
    const radius = available(plan(sketch(), [entity('bend')]), 'radius'), [mark] = layoutCadSketchDimensionPreview(radius.preview, { x: 0, y: 80 }, .1);
    expect(mark).toMatchObject({ kind: 'radius', value: 5 });
    expect(layoutCadSketchDimensionPreview(radius.preview, { x: Number.NaN, y: 0 }, .1)).toEqual([]);
  });

  it('puts a radius or diameter label at the pointer\'s distance as well as its direction, inside or outside the curve', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 's', position: [5, 0] }, { id: 'e', position: [0, 5] }],
      entities: [{ id: 'ring', kind: 'circle', centerPointId: 'o', radius: 5, construction: false }, { id: 'bend', kind: 'arc', centerPointId: 'o', startPointId: 's', endPointId: 'e', direction: 'ccw', construction: false }], relations: [] });
    for (const [id, form] of [['ring', 'diameter'], ['ring', 'radius'], ['bend', 'radius'], ['bend', 'diameter']] as const) {
      const size = available(plan(graph, [entity(id)]), form);
      const [near] = layoutCadSketchDimensionPreview(size.preview, { x: 10, y: 0 }, .1), [far] = layoutCadSketchDimensionPreview(size.preview, { x: 50, y: 0 }, .1);
      // Outside the curve the leader runs from the center to the label, with the arrow meeting the curve from outside.
      expect(near.label).toEqual([10, 0]); expect(far.label).toEqual([50, 0]);
      expect(near.line).toEqual([[0, 0], [10, 0]]); expect(far.line).toEqual([[0, 0], [50, 0]]);
      expect(far.arrows[0][0]).toEqual([5, 0]); expect(far.arrows[0][1][0]).toBeGreaterThan(5);
      // Inside it the leader stops at the curve, with the arrow meeting it from the center.
      const [inside] = layoutCadSketchDimensionPreview(size.preview, { x: 0, y: 2 }, .1);
      expect(inside.label[0]).toBeCloseTo(0, 12); expect(inside.label[1]).toBeCloseTo(2, 12);
      expect(inside.line?.[1][0]).toBeCloseTo(0, 12); expect(inside.line?.[1][1]).toBeCloseTo(5, 12); expect(inside.arrows[0][1][1]).toBeLessThan(5);
      // On the center itself the label stays there, as it does a hair away, and the leader keeps its fallback direction to the curve.
      const [centred] = layoutCadSketchDimensionPreview(size.preview, { x: 0, y: 0 }, .1), [beside] = layoutCadSketchDimensionPreview(size.preview, { x: 1e-9, y: 0 }, .1);
      expect(centred.label).toEqual([0, 0]); expect(Math.hypot(centred.label[0] - beside.label[0], centred.label[1] - beside.label[1])).toBeLessThan(1e-8);
      expect(centred.line?.[0]).toEqual([0, 0]); expect(centred.line?.[1][0]).toBeCloseTo(5 * Math.SQRT1_2, 12); expect(centred.line?.[1][1]).toBeCloseTo(5 * Math.SQRT1_2, 12);
    }
  });
});

describe('placement fallback after preparation rejects a dimension', () => {
  const subject = (category: string, id: string) => ({ category, source: { kind: 'relation', id } });
  it('drops a redundant implied relation before trying a reference', () => {
    expect(cadSketchDimensionRetry({ reason: 'redundant', subjects: [subject('redundant', 'implied')] }, { implied: 'implied', reference: false, hasReference: true })).toBe('without-implied');
    expect(cadSketchDimensionRetry({ reason: 'redundant', subjects: [subject('partially-redundant', 'implied')] }, { implied: 'implied', reference: false, hasReference: true })).toBe('without-implied');
  });
  it('places a reference when a driving dimension over-defines or conflicts, and only once', () => {
    for (const reason of ['redundant', 'conflicting']) {
      expect(cadSketchDimensionRetry({ reason, subjects: [subject(reason, 'new')] }, { implied: null, reference: false, hasReference: true })).toBe('reference');
      expect(cadSketchDimensionRetry({ reason, subjects: [subject(reason, 'new')] }, { implied: null, reference: true, hasReference: true })).toBeNull();
    }
    expect(cadSketchDimensionRetry({ reason: 'conflicting', subjects: [subject('redundant', 'implied'), subject('conflicting', 'implied')] },
      { implied: 'implied', reference: false, hasReference: true })).toBe('reference');
  });
  it('keeps the native rejection when no reference form exists or the reason is not over-definition', () => {
    expect(cadSketchDimensionRetry({ reason: 'redundant', subjects: [] }, { implied: null, reference: false, hasReference: false })).toBeNull();
    expect(cadSketchDimensionRetry({ reason: 'not-converged', subjects: [] }, { implied: null, reference: false, hasReference: true })).toBeNull();
    expect(cadSketchDimensionRetry(null, { implied: null, reference: false, hasReference: true })).toBeNull();
  });
});
