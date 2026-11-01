// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { createCadFreshSketchGraph } from '@/domain/cad/cadFreshSketchGraph';
import { cadSketchGraphWithoutPlacement } from '@/domain/cad/cadSketchPlacedDimensions';
import { createCadSketchPointLineDistance } from '@/domain/cad/cadSketchPointLineDistanceRelations';
import type { Point2 } from '@/domain/path-intel/types';
import {
  cadSketchDimensionAngleSectorAt, cadSketchDimensionBatchAt, cadSketchDimensionCandidateAt, planCadSketchDimension, type CadSketchDimensionForm, type CadSketchDimensionOperand
} from './cadSketchDimensionPlacement';
import {
  cadSketchDimensionMove, cadSketchGraphDimensionLabel, layoutCadSketchGraphDimensions, placeCadSketchDimensions,
  type CadSketchDimensionMove, type CadSketchGraphDimensionLayout
} from './cadSketchGraphDimensionLayout';
import { isCadSketchDimensionRelation } from './cadSketchDimensionSelection';

const scale = .1;
const point = (id: string): CadSketchDimensionOperand => ({ kind: 'point', id });
const entity = (id: string): CadSketchDimensionOperand => ({ kind: 'entity', id });
/** The origin is a point and the axes are lines, named by their reserved ids. */
const origin = point('@origin'), hAxis = entity('@h'), vAxis = entity('@v');
/** What a dimension draws, apart from its relation, with numbers rounded so the same marks reached by other arithmetic compare equal. */
const marks = (layout: object) => {
  const { line, arc, label, labelAngle, arrows, extensions } = layout as CadSketchGraphDimensionLayout & { readonly arc?: unknown };
  return JSON.parse(JSON.stringify({ line, arc, label, labelAngle, arrows, extensions }, (_key, value) => typeof value === 'number' ? Math.round(value * 1e8) / 1e8 + 0 : value));
};
const of = (graph: CadSketchGraph, id: string, parameters: Readonly<Record<string, number>> = {}) => {
  const found = layoutCadSketchGraphDimensions(graph, parameters, scale).find(layout => layout.relation.id === id); if (!found) throw new Error(`${id} is not drawn.`);
  return found;
};
const mover = (graph: CadSketchGraph, id: string, side: 0 | 1 = 0, parameters: Readonly<Record<string, number>> = {}) => {
  const found = cadSketchDimensionMove(graph, parameters, scale, id, side); if (!found) throw new Error(`${id} cannot move.`);
  return found;
};
/** The graph holding what a drag of `move` leaves. */
const dropped = (graph: CadSketchGraph, move: CadSketchDimensionMove, placement: Parameters<CadSketchDimensionMove['relationAt']>[0]) => {
  const relation = move.relationAt(placement);
  return parseCadSketchGraph({ ...graph, relations: graph.relations.map(item => item.id === relation.id ? relation : item) });
};
const withRelations = (graph: CadSketchGraph, relations: readonly unknown[]) => parseCadSketchGraph({ ...graph, relations: [...graph.relations, ...relations] });

/** A 40 × 20 rectangle at (10, 5), two of its sides parallel lines, plus a slanted line, a circle and an arc. */
function sketch() {
  return parseCadSketchGraph({ points: [
    { id: 'a', position: [10, 5] }, { id: 'b', position: [50, 5] }, { id: 'c', position: [50, 25] }, { id: 'd', position: [10, 25] },
    { id: 's0', position: [60, 0] }, { id: 's1', position: [70, 10] },
    { id: 'o', position: [80, 40] }, { id: 'arc-center', position: [0, 60] }, { id: 'arc-start', position: [5, 60] }, { id: 'arc-end', position: [0, 65] }
  ], entities: [
    { id: 'bottom', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'right', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
    { id: 'top', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
    { id: 'slant', kind: 'line', startPointId: 's0', endPointId: 's1', construction: false },
    { id: 'hole', kind: 'circle', centerPointId: 'o', radius: 4, construction: false },
    { id: 'bend', kind: 'arc', centerPointId: 'arc-center', startPointId: 'arc-start', endPointId: 'arc-end', direction: 'ccw', construction: false }
  ], relations: [] });
}

const ids = () => { let next = 0; return () => `new-${++next}`; };
/**
 * A click of the Dimension tool at `pointer` as the workbench places it, for the form a menu names or the one the pointer chooses: the
 * marks its preview draws there, the marks the sketch it leaves draws for what the click placed, and that sketch.
 */
function click(graph: CadSketchGraph, operands: readonly CadSketchDimensionOperand[], pointer: Point2, options: { readonly form?: CadSketchDimensionForm; readonly reference?: boolean } = {}) {
  const plan = planCadSketchDimension(graph, {}, operands, ids());
  const candidate = options.form ? plan.candidates.find(item => item.form === options.form) : cadSketchDimensionCandidateAt(plan, pointer);
  if (!candidate) throw new Error('No dimension to place.');
  const batch = cadSketchDimensionBatchAt(plan, candidate, pointer, options.reference);
  if (!batch.added) throw new Error(batch.reason);
  const { relations, marks: preview } = placeCadSketchDimensions(graph, {}, [...batch.added, ...batch.moved], pointer, scale);
  const next = parseCadSketchGraph({ ...graph, relations: [...graph.relations.map(item => relations.find(placed => placed.id === item.id) ?? item),
    ...relations.filter(placed => !graph.relations.some(item => item.id === placed.id))] });
  const layouts = layoutCadSketchGraphDimensions(next, {}, scale);
  const drawn = relations.filter(isCadSketchDimensionRelation).flatMap(relation => layouts.filter(layout => layout.relation.id === relation.id));
  return { candidate, batch, relations, next, drawn, preview: preview.map(marks), stored: drawn.map(marks) };
}
/** Whether two drawn dimensions' texts, as boxes turned with them, are clear of each other. */
const apart = (a: CadSketchGraphDimensionLayout, b: CadSketchGraphDimensionLayout) => {
  const reach = (layout: CadSketchGraphDimensionLayout) => {
    const { width, height } = cadSketchGraphDimensionLabel(layout.kind === 'angle' ? layout.valueDegrees : layout.valueMm, layout.kind, layout.relation.kind === 'reference-dimension');
    const cos = Math.abs(Math.cos(layout.labelAngle)), sin = Math.abs(Math.sin(layout.labelAngle));
    return { x: (cos * width + sin * height) * scale / 2, y: (sin * width + cos * height) * scale / 2 };
  };
  const first = reach(a), second = reach(b);
  return Math.abs(a.label[0] - b.label[0]) >= first.x + second.x || Math.abs(a.label[1] - b.label[1]) >= first.y + second.y;
};

describe('a dimension placed where the preview drew it', () => {
  it.each([
    ['an aligned point distance', [point('a'), point('c')], { x: 20, y: 20 }, false],
    ['a horizontal point distance', [point('a'), point('c')], { x: 30, y: 40 }, false],
    ['a vertical point distance', [point('a'), point('c')], { x: 70, y: 15 }, false],
    ['a line length', [entity('slant')], { x: 60, y: 12 }, false],
    ['a reference line length', [entity('slant')], { x: 75, y: -4 }, true],
    ['a point to line distance', [point('o'), entity('bottom')], { x: 95, y: 30 }, false],
    ['a reference point to line distance', [point('o'), entity('bottom')], { x: 60, y: 22 }, true],
    ['the distance between parallel lines', [entity('bottom'), entity('top')], { x: 30, y: 15 }, false],
    ['a distance from the origin', [origin, point('c')], { x: 20, y: 10 }, false],
    ['a distance from an axis', [vAxis, point('c')], { x: 25, y: 40 }, false],
    ['an arc radius', [entity('bend')], { x: 0, y: 80 }, false],
    ['a circle diameter inside the circle', [entity('hole')], { x: 81, y: 41 }, false],
    ['a reference diameter outside the circle', [entity('hole')], { x: 60, y: 60 }, true],
    ['an angle', [entity('bottom'), entity('slant')], { x: 80, y: 9 }, false]
  ] as const)('draws %s as previewed and stores that placement', (_name, operands, pointer, reference) => {
    const graph = sketch(), placed = click(graph, operands, pointer, { reference });
    expect(placed.candidate.state).toBe('available');
    const dimensions = placed.relations.filter(isCadSketchDimensionRelation);
    expect(dimensions.length).toBeGreaterThan(0);
    for (const relation of dimensions) expect(relation).toMatchObject({ annotation: expect.any(Object) });
    // Implied relations, such as Parallel, are placed as they are.
    expect(placed.relations.filter(relation => !isCadSketchDimensionRelation(relation))).toEqual(placed.batch.added!.filter(relation => !isCadSketchDimensionRelation(relation)));
    expect(placed.stored).toEqual(placed.preview);
    // Laid out automatically, the same dimension is drawn elsewhere: the placement is what keeps it where it was clicked.
    const automatic = withRelations(graph, placed.batch.added!);
    expect(dimensions.map(relation => marks(of(automatic, relation.id)))).not.toEqual(placed.preview);
  });

  it('places nothing without a finite pointer or zoom, and keeps a dimension it cannot resolve laid out automatically', () => {
    const graph = sketch(), relations: readonly CadSketchGraphRelation[] = [{ id: 'new-1', kind: 'distance', pointIds: ['a', 'c'], value: 1 }];
    expect(placeCadSketchDimensions(graph, {}, relations, { x: Number.NaN, y: 0 }, scale)).toEqual({ relations, marks: [] });
    expect(placeCadSketchDimensions(graph, {}, relations, { x: 0, y: 0 }, 0).relations).toBe(relations);
    const missing: readonly CadSketchGraphRelation[] = [{ id: 'new-1', kind: 'distance', pointIds: ['a', 'missing'], value: 1 }];
    expect(placeCadSketchDimensions(graph, {}, missing, { x: 0, y: 0 }, scale)).toEqual({ relations: missing, marks: [] });
  });
});

describe('a click that moves or reuses a dimension the sketch holds', () => {
  /** Two lines crossing at the origin, which the angle between them divides into four sectors. */
  const cross = (relations: readonly unknown[] = []) => parseCadSketchGraph({ points: [{ id: 'w', position: [-20, 0] }, { id: 'e', position: [20, 0] }, { id: 's', position: [0, -20] }, { id: 'n', position: [0, 20] }],
    entities: [{ id: 'level', kind: 'line', startPointId: 'w', endPointId: 'e', construction: false }, { id: 'upright', kind: 'line', startPointId: 's', endPointId: 'n', construction: false }], relations });
  const quadrants = [{ x: 10, y: 10 }, { x: -10, y: 10 }, { x: -10, y: -10 }, { x: 10, y: -10 }];

  it('draws an existing angle in the sector it measures, wherever the pointer is, and stores it as drawn', () => {
    const angle = planCadSketchDimension(cross(), {}, [entity('level'), entity('upright')], ids()).candidates.find(item => item.form === 'angle');
    if (angle?.state !== 'available' || angle.preview.kind !== 'angle') throw new Error('Expected the angle\'s sectors.');
    expect(angle.preview.sectors).toHaveLength(4);
    for (const sector of angle.preview.sectors) {
      const measured = { kind: 'angle' as const, sectors: [sector], fallback: null }, graph = cross([{ ...sector.relation, id: 'angle' }]);
      for (const pointer of quadrants) {
        const placed = click(graph, [entity('level'), entity('upright')], pointer);
        expect(placed.candidate).toMatchObject({ state: 'existing', relationIds: ['angle'] });
        expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
        // Its text stays in the sector it measures, at the pointer's distance from the corner.
        const [drawn] = placed.drawn;
        expect(cadSketchDimensionAngleSectorAt(measured, { x: drawn.label[0], y: drawn.label[1] })).toBe(sector);
        expect(drawn.kind === 'angle' && drawn.arc?.radius).toBeCloseTo(Math.hypot(10, 10), 9);
      }
    }
  });

  it('draws an existing angle between near-parallel lines as its leader, and stores it as drawn', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 100] }, { id: 'd', position: [10, 100 + 1e-7] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'b' }, { lineId: 'top', towardPointId: 'd' }], sense: 'ccw', value: Math.atan2(1e-7, 10) * 180 / Math.PI }] });
    const placed = click(graph, [entity('base'), entity('top')], { x: 20, y: 50 }, { form: 'angle' });
    expect(placed.candidate).toMatchObject({ state: 'existing', relationIds: ['angle'] });
    expect(placed.drawn[0].line).toBeDefined(); expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
  });

  it('draws a distance reused with what keeps it measuring the picks where it is stored, on either side', () => {
    const graph = sketch(), gap = createCadSketchPointLineDistance({ graph, parameters: {}, pointId: 'd', lineId: 'bottom', relationId: 'gap' });
    // Between two lines, the distance from one to an end of the other, which Parallel keeps measuring them.
    const lines = withRelations(graph, [gap]);
    for (const operands of [[entity('bottom'), entity('top')], [entity('top'), entity('bottom')]] as const)
      for (const pointer of [{ x: 30, y: 15 }, { x: 0, y: 15 }, { x: 70, y: 30 }, { x: 30, y: -10 }]) {
        const placed = click(lines, operands, pointer);
        expect(placed.candidate).toMatchObject({ state: 'available', reuses: 'gap' });
        expect(placed.batch.moved.map(relation => relation.id)).toEqual(['gap']);
        expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
      }
    // A line held from the X axis at one end, which Horizontal keeps measuring the line.
    const end = withRelations(graph, [{ id: 'held', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 5 }]);
    for (const pointer of [{ x: 30, y: -10 }, { x: 60, y: 2 }, { x: 5, y: 3 }]) {
      const placed = click(end, [hAxis, entity('bottom')], pointer);
      expect(placed.candidate).toMatchObject({ state: 'available', reuses: 'held' });
      expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
    }
    // A point that keeps its X: the horizontal distance from the origin is that X, drawn where it is stored on either side.
    const position = withRelations(graph, [{ id: 'x', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 50 }]);
    for (const pointer of [{ x: 25, y: -10 }, { x: 25, y: 35 }]) {
      const placed = click(position, [origin, point('c')], pointer);
      expect(placed.candidate).toMatchObject({ form: 'horizontal', state: 'existing', relationIds: ['x'] });
      expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
    }
  });

  it('draws an existing size of a curve, another quantity or a fillet, and distances stored the other way round, as they are stored', () => {
    const graph = sketch(), sized = withRelations(graph, [{ id: 'radius', kind: 'radial-size', entityId: 'hole', quantity: 'radius', value: 4 }]);
    // The hole's diameter is picked; its radius is what the sketch holds, and what the click moves.
    for (const pointer of [{ x: 90, y: 50 }, { x: 81, y: 39 }]) {
      const placed = click(sized, [entity('hole')], pointer, { form: 'diameter' });
      expect(placed.candidate).toMatchObject({ state: 'existing', relationIds: ['radius'],
        reason: 'This curve already has a radius dimension. Placing selects it and moves it where the preview shows it.' });
      expect(placed.drawn.map(layout => layout.kind)).toEqual(['radius']); expect(placed.stored).toEqual(placed.preview);
    }
    const rectangle = createCadFreshSketchGraph({ geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 }, construction: false,
      createId: (() => { let n = 0; return () => `r_${++n}`; })() });
    const filleted = createCadSketchCornerTreatment({ graph: rectangle, parameters: {}, pointId: 'r_1', treatment: { kind: 'fillet', radius: 2 }, createId: (() => { let n = 0; return () => `f_${++n}`; })() });
    const arc = filleted.graph.entities.find(item => item.kind === 'arc')!, fillet = click(filleted.graph, [entity(arc.id)], { x: -5, y: -5 });
    expect(fillet.candidate).toMatchObject({ state: 'existing', relationIds: [filleted.graph.relations.at(-1)!.id] });
    expect(fillet.preview).toHaveLength(1); expect(fillet.stored).toEqual(fillet.preview);
    // Distances whose points the sketch holds in the other order from the picks.
    const reversed = withRelations(graph, [{ id: 'span', kind: 'distance', pointIds: ['c', 'a'], value: Math.hypot(40, 20) },
      { id: 'across', kind: 'axis-distance', pointIds: ['a', 'c'], axis: 'x', value: 40 }, { id: 'measured', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['s1', 'o'] } }]);
    for (const [operands, pointer, id] of [[[point('a'), point('c')], { x: 20, y: 20 }, 'span'], [[point('a'), point('c')], { x: 40, y: 10 }, 'span'],
      [[point('c'), point('a')], { x: 30, y: 40 }, 'across'], [[point('c'), point('a')], { x: 30, y: -10 }, 'across'], [[point('o'), point('s1')], { x: 72, y: 28 }, 'measured']] as const) {
      const placed = click(reversed, operands, pointer);
      expect(placed.candidate).toMatchObject({ state: 'existing', relationIds: [id] });
      expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
    }
  });

  it('keeps a dimension clicked again where it already is as it is, so the click edits nothing', () => {
    for (const [operands, pointer] of [[[point('a'), point('c')], { x: 20, y: 20 }], [[point('o'), entity('bottom')], { x: 95, y: 30 }], [[entity('bottom'), entity('slant')], { x: 80, y: 9 }],
      [[entity('hole')], { x: 60, y: 60 }], [[origin, point('c')], { x: 20, y: 10 }]] as const) {
      const first = click(sketch(), operands, pointer), again = click(first.next, operands, pointer, { form: first.candidate.form });
      expect(again.candidate.state).toBe('existing'); expect(again.relations.length).toBeGreaterThan(0);
      for (const [index, relation] of again.relations.entries()) expect(relation).toBe(again.batch.moved[index]);
    }
  });

  it('draws a reference that only a reference can measure, at zero, as it is stored', () => {
    const graph = withRelations(parseCadSketchGraph({ ...sketch(), points: [...sketch().points, { id: 'twin', position: [50, 25] }, { id: 'on', position: [30, 5] }] }), []);
    for (const [operands, pointer] of [[[point('c'), point('twin')], { x: 60, y: 30 }], [[point('on'), entity('bottom')], { x: 25, y: 8 }]] as const) {
      const placed = click(graph, operands, pointer);
      expect(placed.candidate.state).toBe('blocked'); expect(placed.relations).toMatchObject([{ kind: 'reference-dimension' }]);
      expect(placed.preview).toHaveLength(1); expect(placed.stored).toEqual(placed.preview);
    }
  });
});

describe('dimensions one click places', () => {
  it('steps out each one the click would draw over another, and draws the preview as they are stored', () => {
    // A line whose ends are both held from the X axis: a click with the axis selects both distances and moves them to the pointer.
    const held = parseCadSketchGraph({ points: [{ id: 'p', position: [0, 10] }, { id: 'q', position: [40, 10] }], entities: [{ id: 'line', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false }],
      relations: [{ id: 'hp', kind: 'fixed-axis', pointId: 'p', axis: 'y', value: 10 }, { id: 'hq', kind: 'fixed-axis', pointId: 'q', axis: 'y', value: 10 }] });
    const ends = click(held, [hAxis, entity('line')], { x: 48.9, y: 5 });
    expect(ends.candidate).toMatchObject({ state: 'existing', relationIds: ['hp', 'hq'] });
    expect(ends.preview).toHaveLength(2); expect(ends.stored).toEqual(ends.preview);
    // The first runs through the pointer; the second steps out beyond it, clear of its text and line.
    const [first, second] = ends.drawn;
    expect(first.line![0][0]).toBeCloseTo(48.9, 9); expect(second.line![0][0]).toBeGreaterThan(48.9 + cadSketchGraphDimensionLabel(10, 'distance').height * scale);
    expect(apart(first, second)).toBe(true);
  });
});

describe('moving a placed dimension', () => {
  /** A 40 × 30 corner at the origin with its length placed 5 mm below it, a hole and their angle. */
  const corner = () => parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 30] }, { id: 'o', position: [10, 10] }],
    entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'hole', kind: 'circle', centerPointId: 'o', radius: 4, construction: false }],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40, annotation: { kind: 'linear', offset: -5, along: 0.5 } },
      { id: 'gap', kind: 'point-line-distance', pointId: 'o', lineId: 'base', side: 'left', value: 10 },
      { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'a' }, { lineId: 'side', towardPointId: 'c' }], sense: 'cw', value: 90 },
      { id: 'size', kind: 'radial-size', entityId: 'hole', quantity: 'diameter', value: 8 }] });

  it('moves a distance\'s text along and away from its line, and its line only away, from where it was placed', () => {
    const graph = corner(), move = mover(graph, 'length'), from = { x: move.layout.label[0], y: move.layout.label[1] };
    expect(move.start).toEqual({ kind: 'linear', offset: -5, along: 0.5 }); expect(marks(move.layoutAt(move.start))).toEqual(marks(of(graph, 'length')));
    // The text follows the pointer, setting both components; the line keeps its text where it was along it.
    const label = move.placementAt('label', from, { x: from.x + 4, y: from.y - 2 });
    expect(label).toEqual({ kind: 'linear', offset: expect.closeTo(-7, 9), along: expect.closeTo(0.6, 9) });
    expect(move.placementAt('line', from, { x: from.x + 4, y: from.y - 2 })).toEqual({ kind: 'linear', offset: expect.closeTo(-7, 9), along: 0.5 });
    // What the drag draws is what the stored placement draws once the edit applies.
    expect(marks(of(dropped(graph, move, label), 'length'))).toEqual(marks(move.layoutAt(label)));
    expect(of(dropped(graph, move, label), 'length').label).toEqual([expect.closeTo(from.x + 4, 9), expect.closeTo(from.y - 2, 9)]);
  });

  it('runs the line on beneath text taken past an extension line, with the arrows where they were', () => {
    const graph = corner(), move = mover(graph, 'length'), from = { x: move.layout.label[0], y: move.layout.label[1] };
    const beyond = move.placementAt('label', from, { x: from.x + 40, y: from.y });
    expect(beyond).toEqual({ kind: 'linear', offset: expect.closeTo(-5, 9), along: expect.closeTo(1.5, 9) });
    const drawn = move.layoutAt(beyond), half = cadSketchGraphDimensionLabel(40, 'distance').width * scale / 2;
    expect(drawn.label[0]).toBeCloseTo(60, 9); expect(drawn.line![1][0]).toBeCloseTo(60 + half, 9); expect(drawn.line![0][0]).toBeCloseTo(0, 9);
    expect(drawn.arrows.map(arrow => arrow[0][0])).toEqual([expect.closeTo(0, 9), expect.closeTo(40, 9)]);
    const before = move.layoutAt(move.placementAt('label', from, { x: from.x - 40, y: from.y }));
    expect(before.label[0]).toBeCloseTo(-20, 9); expect(before.line![0][0]).toBeCloseTo(-20 - half, 9); expect(before.line![1][0]).toBeCloseTo(40, 9);
  });

  it('starts an automatically laid out dimension from where it is drawn, and slides a point to line distance along its line', () => {
    const graph = corner(), move = mover(graph, 'gap'), drawn = of(graph, 'gap'), from = { x: drawn.label[0], y: drawn.label[1] };
    expect(marks(move.layoutAt(move.start))).toEqual(marks(drawn));
    const label = move.placementAt('label', from, { x: from.x - 3, y: from.y + 2 }), line = move.placementAt('line', from, { x: from.x - 3, y: from.y + 2 });
    if (label.kind !== 'linear' || line.kind !== 'linear' || move.start.kind !== 'linear') throw new Error('Expected linear placements.');
    expect(label.offset).toBeCloseTo(move.start.offset - 3, 9); expect(label.along).toBeCloseTo(move.start.along + 0.2, 9);
    expect(line).toEqual({ kind: 'linear', offset: expect.closeTo(move.start.offset - 3, 9), along: move.start.along });
    expect(move.layoutAt(line).line).toEqual([[expect.closeTo(7, 9), expect.closeTo(0, 9)], [expect.closeTo(7, 9), expect.closeTo(10, 9)]]);
  });

  it('moves an angle\'s text along its arc and past its sweep, and its arc only out from the corner', () => {
    const graph = corner(), move = mover(graph, 'angle'), start = move.layout;
    if (start.kind !== 'angle' || !start.arc || move.start.kind !== 'angle') throw new Error('Expected an arc.');
    // The corner is at b, the arc sweeping from the base, toward a, to the side, toward c.
    expect(start.arc.center).toEqual([40, 0]);
    const from = { x: start.label[0], y: start.label[1] }, turned = (angle: number, reach: number) => ({ x: 40 + Math.cos(angle) * reach, y: Math.sin(angle) * reach });
    const reach = Math.hypot(from.x - 40, from.y);
    const along = move.placementAt('label', from, turned(Math.PI * 0.6, reach));
    // The text lands under the pointer, its arc as far in as its box needs there.
    expect(along).toMatchObject({ kind: 'angle', along: expect.closeTo(0.8, 9) });
    expect(move.layoutAt(along).label).toEqual([expect.closeTo(turned(Math.PI * 0.6, reach).x, 9), expect.closeTo(turned(Math.PI * 0.6, reach).y, 9)]);
    const beyond = move.placementAt('label', from, turned(Math.PI / 4, reach)), past = move.layoutAt(beyond);
    if (beyond.kind !== 'angle') throw new Error('Expected an angle placement.');
    expect(beyond.along).toBeCloseTo(1.5, 9);
    if (past.kind !== 'angle' || !past.arc) throw new Error('Expected an arc.');
    // Past the side, the arc runs on to the text; the arrows stay on the rays.
    expect(past.arc.end).toEqual([expect.closeTo(40 + Math.cos(Math.PI / 4) * beyond.radius, 6), expect.closeTo(Math.sin(Math.PI / 4) * beyond.radius, 6)]);
    expect(past.arrows.map(arrow => arrow[0])).toEqual([[expect.closeTo(40 - beyond.radius, 6), expect.closeTo(0, 6)], [expect.closeTo(40, 6), expect.closeTo(beyond.radius, 6)]]);
    const out = move.placementAt('line', from, turned(Math.PI * 0.6, reach + 3));
    expect(out).toEqual({ kind: 'angle', radius: expect.closeTo(move.start.radius + 3, 9), along: 0.5 });
    expect(marks(of(dropped(graph, move, out), 'angle'))).toEqual(marks(move.layoutAt(out)));
  });

  it('moves a diameter\'s text anywhere round its circle, and turns its leader keeping the text\'s distance', () => {
    const graph = corner(), move = mover(graph, 'size'), from = { x: move.layout.label[0], y: move.layout.label[1] };
    expect(move.placementAt('label', from, { x: 10, y: 22 })).toEqual({ kind: 'radial', angle: expect.closeTo(Math.PI / 2, 9), distance: expect.closeTo(12, 9) });
    if (move.start.kind !== 'radial') throw new Error('Expected a radial placement.');
    const turned = move.placementAt('line', from, { x: 10 - (from.x - 10), y: 10 + (from.y - 10) });
    expect(turned).toEqual({ kind: 'radial', angle: expect.closeTo(Math.PI - move.start.angle, 9), distance: move.start.distance });
    const drawn = of(dropped(graph, move, turned), 'size');
    expect(drawn.label).toEqual([expect.closeTo(10 - (from.x - 10), 9), expect.closeTo(from.y, 9)]);
  });

  it('moves each chamfer setback alone and a fillet radius like any radius', () => {
    const rectangle = createCadFreshSketchGraph({ geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 }, construction: false,
      createId: (() => { let n = 0; return () => `r_${++n}`; })() });
    const chamfered = createCadSketchCornerTreatment({ graph: rectangle, parameters: {}, pointId: 'r_1', treatment: { kind: 'chamfer', setbacks: [2, 3] }, createId: (() => { let n = 0; return () => `c_${++n}`; })() });
    const relation = chamfered.graph.relations.at(-1)!, move = mover(chamfered.graph, relation.id, 1), from = { x: move.layout.label[0], y: move.layout.label[1] };
    const placed = move.relationAt(move.placementAt('line', from, { x: from.x + 1, y: from.y + 1 }));
    expect(placed).toMatchObject({ annotation: { kind: 'setbacks', sides: [null, { offset: expect.any(Number), along: 0.5 }] } });
    const graph = parseCadSketchGraph({ ...chamfered.graph, relations: chamfered.graph.relations.map(item => item.id === placed.id ? placed : item) });
    const sides = layoutCadSketchGraphDimensions(graph, {}, scale).filter(layout => layout.relation.id === relation.id);
    const before = layoutCadSketchGraphDimensions(chamfered.graph, {}, scale).filter(layout => layout.relation.id === relation.id);
    expect(marks(sides[0])).toEqual(marks(before[0])); expect(marks(sides[1])).not.toEqual(marks(before[1]));
    const filleted = createCadSketchCornerTreatment({ graph: rectangle, parameters: {}, pointId: 'r_1', treatment: { kind: 'fillet', radius: 2 }, createId: (() => { let n = 0; return () => `f_${++n}`; })() });
    const fillet = mover(filleted.graph, filleted.graph.relations.at(-1)!.id), at = { x: fillet.layout.label[0], y: fillet.layout.label[1] };
    expect(fillet.placementAt('label', at, { x: at.x + 1, y: at.y })).toMatchObject({ kind: 'radial' });
  });

  it('moves a dimension at 0 along and away from its line, and keeps it where it was put as its length goes through 0', () => {
    // Points at one position measured by a reference, a coordinate and a horizontal distance a parameter takes to 0, and a point on a line.
    const zero = (gap: number, annotations: Readonly<Record<string, object>> = {}) => parseCadSketchGraph({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'p', position: [10, 10] }, { id: 'q', position: [10 + gap, 10] },
        { id: 'e', position: [gap, 20] }, { id: 'r', position: [20, gap] }],
      entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
      relations: [{ id: 'twin', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['p', 'q'] } },
        { id: 'coordinate', kind: 'fixed-axis', pointId: 'e', axis: 'x', value: 'gap' }, { id: 'level', kind: 'axis-distance', pointIds: ['p', 'q'], axis: 'x', value: 'gap' },
        { id: 'onLine', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'r', lineId: 'base' } }]
        .map(relation => annotations[relation.id] ? { ...relation, annotation: annotations[relation.id] } : relation) });
    const placements: Record<string, object> = {};
    for (const id of ['twin', 'coordinate', 'level', 'onLine']) {
      const move = mover(zero(0), id, 0, { gap: 0 }), from = { x: move.layout.label[0], y: move.layout.label[1] }, to = { x: from.x + 1.5, y: from.y - 2 };
      const label = move.placementAt('label', from, to);
      if (label.kind !== 'linear' || move.start.kind !== 'linear') throw new Error('Expected linear placements.');
      // The text follows the pointer both along the line and away from it.
      expect(label.offset).not.toBeCloseTo(move.start.offset, 3); expect(label.along).not.toBeCloseTo(move.start.along, 3);
      expect(move.layoutAt(label).label).toEqual([expect.closeTo(to.x, 9), expect.closeTo(to.y, 9)]);
      expect(marks(of(dropped(zero(0), move, label), id, { gap: 0 }))).toEqual(marks(move.layoutAt(label)));
      placements[id] = label;
    }
    // Placed, each keeps its text where it was as its length goes through 0. An aligned distance takes its frame from its points, which
    // turns over as they pass each other, so it is taken to 0 from one side.
    for (const id of ['twin', 'coordinate', 'level', 'onLine']) {
      const at = of(zero(0, placements), id, { gap: 0 });
      for (const gap of id === 'twin' ? [1e-7] : [1e-7, -1e-7]) {
        const near = of(zero(gap, placements), id, { gap });
        expect(near.label).toEqual([expect.closeTo(at.label[0], 6), expect.closeTo(at.label[1], 6)]); expect(near.labelAngle).toBeCloseTo(at.labelAngle, 9);
      }
    }
  });

  it('moves the leader of an angle between near-parallel lines along and past their ends', () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 100] }, { id: 'd', position: [10, 100 + 1e-7] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'b' }, { lineId: 'top', towardPointId: 'd' }], sense: 'ccw', value: Math.atan2(1e-7, 10) * 180 / Math.PI }] });
    const move = mover(graph, 'angle'), from = { x: move.layout.label[0], y: move.layout.label[1] };
    expect(move.layout.line).toBeDefined(); expect(move.start).toMatchObject({ kind: 'linear' });
    const line = move.placementAt('line', from, { x: from.x + 3, y: from.y + 20 });
    if (line.kind !== 'linear' || move.start.kind !== 'linear') throw new Error('Expected a leader.');
    expect(line.offset).toBeCloseTo(move.start.offset + 3, 6); expect(line.along).toBe(move.start.along);
    const label = move.placementAt('label', from, { x: from.x + 3, y: from.y + 20 });
    if (label.kind !== 'linear') throw new Error('Expected a leader.');
    expect(label.along).toBeCloseTo(move.start.along + .2, 6);
    expect(marks(of(dropped(graph, move, label), 'angle'))).toEqual(marks(move.layoutAt(label)));
  });
});

describe('a placed dimension and its geometry', () => {
  const graph = (b: readonly [number, number], o: readonly [number, number] = [10, 10], radius = 4) => parseCadSketchGraph({
    points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: b }, { id: 'c', position: [b[0], b[1] + 30] }, { id: 'o', position: o }],
    entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
      { id: 'hole', kind: 'circle', centerPointId: 'o', radius, construction: false }],
    relations: [{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40, annotation: { kind: 'linear', offset: -5, along: 0.25 } },
      { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'a' }, { lineId: 'side', towardPointId: 'c' }], sense: 'cw', value: 90, annotation: { kind: 'angle', radius: 6, along: 0.25 } },
      { id: 'size', kind: 'radial-size', entityId: 'hole', quantity: 'diameter', value: 8, annotation: { kind: 'radial', angle: Math.PI, distance: 9 } }] });

  it('follows its geometry when it moves or is resized', () => {
    const before = graph([40, 0]), after = graph([60, 0], [30, 5], 6);
    // The length stays 5 mm below its line, its text a quarter of the way along, however long the line becomes.
    expect(of(before, 'length').line).toEqual([[0, -5], [40, -5]]); expect(of(after, 'length').line).toEqual([[0, -5], [60, -5]]);
    expect(of(after, 'length').label[0]).toBeCloseTo(15, 9);
    // The arc stays 6 mm from the corner, which moved, and the diameter 9 mm left of the centre, which moved too.
    const arc = of(after, 'angle'); if (arc.kind !== 'angle' || !arc.arc) throw new Error('Expected an arc.');
    expect(arc.arc.center).toEqual([60, 0]); expect(arc.arc.radius).toBeCloseTo(6, 9);
    expect(of(after, 'size').label).toEqual([expect.closeTo(21, 9), expect.closeTo(5, 9)]);
    expect(of(before, 'size').label).toEqual([expect.closeTo(1, 9), expect.closeTo(10, 9)]);
  });

  it('lays out a placement that no longer fits automatically', () => {
    const fits = graph([40, 0]);
    const misfit = (id: string, annotation: object) => parseCadSketchGraph({ ...fits, relations: fits.relations.map(item => item.id === id ? { ...item, annotation } : item) });
    const automatic = (id: string) => marks(of(cadSketchGraphWithoutPlacement(fits), id));
    // A leader's placement on an angle drawn as an arc, and text placed more than a full turn round it.
    expect(marks(of(misfit('angle', { kind: 'linear', offset: 2, along: 0.5 }), 'angle'))).toEqual(automatic('angle'));
    expect(marks(of(misfit('angle', { kind: 'angle', radius: 6, along: 5 }), 'angle'))).toEqual(automatic('angle'));
    expect(marks(of(misfit('angle', { kind: 'angle', radius: 6, along: -3.5 }), 'angle'))).toEqual(automatic('angle'));
    expect(marks(of(misfit('angle', { kind: 'angle', radius: 6, along: 3.9 }), 'angle'))).not.toEqual(automatic('angle'));
    // An arc placement on an angle whose corner cannot be placed, between near-parallel lines, leaves its leader automatic.
    const near = (annotation?: object) => parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 100] }, { id: 'd', position: [10, 100 + 1e-7] }],
      entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
      relations: [{ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'b' }, { lineId: 'top', towardPointId: 'd' }], sense: 'ccw', value: 1e-5, ...annotation ? { annotation } : {} }] });
    expect(marks(of(near({ kind: 'angle', radius: 6, along: 0.5 }), 'angle'))).toEqual(marks(of(near(), 'angle')));
    // An angle annotation on lines whose corner is far out of sight keeps the arc it was placed as.
    const far = (annotation?: object) => parseCadSketchGraph({ ...near(), points: near().points.map(item => item.id === 'd' ? { ...item, position: [10, 100.001] } : item),
      relations: near().relations.map(item => ({ ...item, value: Math.atan2(1e-3, 10) * 180 / Math.PI, ...annotation ? { annotation } : {} })) });
    expect(of(far(), 'angle').line).toBeDefined(); expect(of(far({ kind: 'angle', radius: 6, along: 0.5 }), 'angle')).toMatchObject({ arc: expect.any(Object) });
  });

  it('keeps a placed dimension where it was put, and moves automatic ones clear of it', () => {
    const nested = (annotation?: object) => parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [50, 0] }, { id: 'hole', position: [25, 12.5] }],
      entities: [], relations: [{ id: 'overall', kind: 'distance', pointIds: ['a', 'b'], value: 50, ...annotation ? { annotation } : {} },
        { id: 'bore', kind: 'axis-distance', pointIds: ['a', 'hole'], axis: 'x', value: 25 }] });
    const automatic = nested(), bore = of(automatic, 'bore'), level = bore.line![0][1];
    // The overall length placed on the line the bore distance takes when laid out alone.
    const placed = nested({ kind: 'linear', offset: level, along: 0.5 });
    expect(of(placed, 'overall').line![0][1]).toBeCloseTo(level, 9);
    const moved = of(placed, 'bore').line![0][1];
    expect(Math.abs(moved - level)).toBeGreaterThan(1);
  });
});
