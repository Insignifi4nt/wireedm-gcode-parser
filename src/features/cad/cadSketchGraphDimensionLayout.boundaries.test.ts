// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchDimensionPlacementOf } from '@/domain/cad/cadSketchPlacedDimensions';
import { cadSketchDimensionMove, layoutCadSketchGraphDimensions, placeCadSketchDimensions, type CadSketchGraphDimensionLayout } from './cadSketchGraphDimensionLayout';

function only(graph: CadSketchGraph): CadSketchGraphDimensionLayout {
  const layouts = layoutCadSketchGraphDimensions(graph, {}, 0.1);
  if (layouts.length !== 1) throw new Error(`Expected one dimension, got ${layouts.length}.`);
  return layouts[0];
}

describe('dimension text reading direction near vertical', () => {
  // A 10 mm distance from (0, 10) down to (10 lean, 0) runs along (lean, -1): exactly vertical text reads upward, otherwise toward +X.
  const aligned = (lean: number) => only(parseCadSketchGraph({ points: [{ id: 'a', position: [0, 10] }, { id: 'b', position: [10 * lean, 0] }],
    entities: [], relations: [{ id: 'd', kind: 'distance', pointIds: ['a', 'b'], value: 10 }] }));
  // A point 5 mm right of a line rising `lean` per unit length: its dimension runs from the foot to the point along (lean, -1).
  const pointLine = (lean: number) => only(parseCadSketchGraph({ points: [{ id: 's', position: [0, 0] }, { id: 'e', position: [10, 10 * lean] }, { id: 'p', position: [5, -5] }],
    entities: [{ id: 'base', kind: 'line', construction: false, startPointId: 's', endPointId: 'e' }],
    relations: [{ id: 'd', kind: 'point-line-distance', pointId: 'p', lineId: 'base', side: 'right', value: 5 }] }));

  it('reads an aligned distance 4e-13 off vertical upward, and one 3e-12 off vertical toward its +X end', () => {
    expect(aligned(4e-13).labelAngle).toBeCloseTo(Math.PI / 2, 9);
    expect(aligned(3e-12).labelAngle).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('reads a point to line distance 4e-13 off vertical upward, and one 3e-12 off vertical toward its +X end', () => {
    expect(pointLine(4e-13).labelAngle).toBeCloseTo(Math.PI / 2, 9);
    expect(pointLine(3e-12).labelAngle).toBeCloseTo(-Math.PI / 2, 9);
  });
});

describe('separating parallel dimension lines', () => {
  // Two 10 mm distances from the same point, one level and one rising `slope` per unit length, both standing off below the sketch.
  const pair = (slope: number) => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10 * slope] }, { id: 'z', position: [5, 20] }],
      entities: [], relations: [{ id: 'level', kind: 'distance', pointIds: ['a', 'b'], value: 10 }, { id: 'tilted', kind: 'distance', pointIds: ['a', 'c'], value: 10 }] });
    const [level, tilted] = layoutCadSketchGraphDimensions(graph, {}, 0.1);
    if (level?.kind !== 'distance' || tilted?.kind !== 'distance') throw new Error('Expected two aligned distances.');
    return { level: level.line[0][1], tilted: tilted.line[0][1] };
  };

  it('steps a dimension 4e-13 rad off parallel clear of its neighbour, and leaves one 3e-12 rad off parallel over it', () => {
    const inside = pair(4e-13);
    expect(Math.abs(inside.tilted - inside.level)).toBeGreaterThan(1);
    const outside = pair(3e-12);
    expect(outside.tilted).toBeCloseTo(outside.level, 9);
  });
});

/** A counterclockwise right angle at the origin between rays along +X and +Y. */
function rightAngle(annotation?: { readonly kind: 'angle'; readonly radius: number; readonly along: number }) {
  return parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] }, { id: 'a', position: [10, 0] }, { id: 'b', position: [0, 10] }],
    entities: [{ id: 'first', kind: 'line', construction: false, startPointId: 'v', endPointId: 'a' }, { id: 'second', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }],
    relations: [{ id: 'corner', kind: 'line-angle', rays: [{ lineId: 'first', towardPointId: 'a' }, { lineId: 'second', towardPointId: 'b' }], sense: 'ccw', value: 90,
      ...(annotation ? { annotation } : {}) }] });
}

describe('angle dimension text beyond its sweep', () => {
  // Text `along` the quarter turn at 3 mm reaches round to along * pi / 2.
  const placed = (along: number) => {
    const dimension = only(rightAngle({ kind: 'angle', radius: 3, along }));
    if (dimension.kind !== 'angle' || !dimension.arc) throw new Error('Expected an angle arc.');
    return dimension.arc;
  };

  it('lays out text placed 4.7e-10 rad short of a full turn automatically, and keeps text placed 3.1e-9 rad short where it was put', () => {
    const inside = placed(3.9999999997);
    expect(inside.radius).toBeCloseTo(4, 12); expect(inside.large).toBeUndefined();
    const outside = placed(3.999999998);
    expect(outside.radius).toBeCloseTo(3, 12); expect(outside.large).toBe(true);
  });
});

describe('smallest angle dimension arc radius', () => {
  const graph = rightAngle();
  const clicked = (x: number) => cadSketchDimensionPlacementOf(placeCadSketchDimensions(graph, {}, graph.relations, { x, y: 0 }, 0.1).relations[0]);
  const dragged = (x: number) => {
    const move = cadSketchDimensionMove(graph, {}, 0.1, 'corner');
    if (!move) throw new Error('Expected a drawn angle dimension.');
    return move.placementAt('line', { x: 4, y: 0 }, { x, y: 0 });
  };

  it('places an arc clicked 4e-7 mm from the corner at 1e-6 mm, and one clicked 3e-6 mm from it there', () => {
    expect(clicked(4e-7)).toEqual({ kind: 'angle', radius: 1e-6, along: 0.5 });
    expect(clicked(3e-6)).toEqual({ kind: 'angle', radius: 3e-6, along: 0.5 });
  });

  it('stops an arc dragged to 4e-7 mm from the corner at 1e-6 mm, and leaves one dragged to 3e-6 mm there', () => {
    expect(dragged(4e-7)).toMatchObject({ kind: 'angle', radius: 1e-6 });
    const outside = dragged(3e-6);
    if (outside.kind !== 'angle') throw new Error('Expected an angle placement.');
    expect(outside.radius).toBeCloseTo(3e-6, 14);
  });
});
