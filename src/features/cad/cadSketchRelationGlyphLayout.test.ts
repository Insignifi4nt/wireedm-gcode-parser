import { describe, expect, it } from 'vitest';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchDimensionKeys } from './cadSketchDimensionSelection';
import { cadSketchRelationGlyphEntries, layoutCadSketchRelationGlyphs, placeCadSketchRelationGlyphs } from './cadSketchRelationGlyphLayout';

const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
/** A 40 × 20 rectangle a-b-c-d with bottom, right, top and left edges. */
const rectangle = (relations: CadSketchGraph['relations'] = [
  { id: 'h1', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'v1', kind: 'vertical', pointIds: ['b', 'c'] },
  { id: 'h2', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'v2', kind: 'vertical', pointIds: ['d', 'a'] }]): CadSketchGraph => ({
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }],
  entities: [line('bottom', 'a', 'b'), line('right', 'b', 'c'), line('top', 'c', 'd'), line('left', 'd', 'a')], relations });
const summary = (graph: CadSketchGraph) => layoutCadSketchRelationGlyphs(graph, {}).map(glyph => ({ relationIds: glyph.relationIds, operand: glyph.operand, kind: glyph.kind }));

describe('relation glyph layout', () => {
  it('draws Horizontal and Vertical between a line\'s own endpoints once, on that line, inside the sketch', () => {
    const glyphs = layoutCadSketchRelationGlyphs(rectangle(), {});
    expect(glyphs.map(glyph => [glyph.operand, glyph.kind, glyph.label])).toEqual([
      ['entity:bottom', 'horizontal', 'Horizontal: Point 1 and Point 2'], ['entity:right', 'vertical', 'Vertical: Point 2 and Point 3'],
      ['entity:top', 'horizontal', 'Horizontal: Point 3 and Point 4'], ['entity:left', 'vertical', 'Vertical: Point 4 and Point 1']]);
    // At each edge's middle, 12 screen pixels toward the inside, which leaves the outside to the dimensions; screen y runs down.
    expect(glyphs.map(glyph => [glyph.anchor, glyph.offset])).toEqual([[[20, 0], [0, -12]], [[40, 10], [-12, 0]], [[20, 20], [0, 12]], [[0, 10], [12, 0]]]);
  });

  it('marks both points of a Horizontal or Vertical between points of different edges, diagonally beside each', () => {
    const glyphs = layoutCadSketchRelationGlyphs(rectangle([{ id: 'level', kind: 'horizontal', pointIds: ['a', 'c'] }]), {});
    expect(glyphs.map(glyph => [glyph.key, glyph.anchor, glyph.offset])).toEqual([['level@point:a', [0, 0], [10, -10]], ['level@point:c', [40, 20], [10, -10]]]);
  });

  it('stacks the glyphs of one edge side by side about its middle, and those of one point in a row, in relation order', () => {
    const base = rectangle([{ id: 'p', kind: 'parallel', lineIds: ['bottom', 'top'] }, { id: 'h', kind: 'horizontal', pointIds: ['a', 'b'] },
      { id: 'e', kind: 'equal-length', lineIds: ['bottom', 'top'] }, { id: 'fix', kind: 'fixed-point', pointId: 'a', position: [0, 0] },
      { id: 'join', kind: 'coincident', pointIds: ['a', 'a2'] }]);
    const graph: CadSketchGraph = { ...base, points: [...base.points, { id: 'a2', position: [0, 0] }] };
    const glyphs = layoutCadSketchRelationGlyphs(graph, {}), on = (operand: string) => glyphs.filter(glyph => glyph.operand === operand);
    expect(on('entity:bottom').map(glyph => [glyph.relationIds[0], glyph.offset])).toEqual([['p', [-15, -12]], ['h', [0, -12]], ['e', [15, -12]]]);
    expect(on('entity:top').map(glyph => [glyph.relationIds[0], glyph.offset])).toEqual([['p', [-7.5, 12]], ['e', [7.5, 12]]]);
    expect(on('point:a').map(glyph => [glyph.relationIds[0], glyph.kind, glyph.offset])).toEqual([['fix', 'fix', [10, -10]], ['join', 'coincident', [25, -10]]]);
    // The layout is the same for the same sketch.
    expect(layoutCadSketchRelationGlyphs(graph, {})).toEqual(glyphs);
  });

  it('labels a Coincident between two curve centres Concentric, on each curve: a circle at its top, an arc at mid-sweep', () => {
    const graph: CadSketchGraph = {
      points: [{ id: 'o1', position: [0, 0] }, { id: 'o2', position: [0, 0] }, { id: 's', position: [10, 0] }, { id: 'e', position: [0, 10] }],
      entities: [{ id: 'ring', kind: 'circle', construction: false, centerPointId: 'o1', radius: 'r' }, { id: 'bend', kind: 'arc', construction: false, centerPointId: 'o2', startPointId: 's', endPointId: 'e', direction: 'ccw' }],
      relations: [{ id: 'same', kind: 'coincident', pointIds: ['o1', 'o2'] }, { id: 'size', kind: 'equal-radius', curveIds: ['ring', 'bend'] }] };
    const glyphs = layoutCadSketchRelationGlyphs(graph, { r: 5 });
    expect(glyphs.map(glyph => [glyph.operand, glyph.kind, glyph.name])).toEqual([['entity:ring', 'concentric', 'Concentric'], ['entity:bend', 'concentric', 'Concentric'],
      ['entity:ring', 'equal-radius', 'Equal radius'], ['entity:bend', 'equal-radius', 'Equal radius']]);
    expect(glyphs[0].label).toBe('Concentric: Circle 2 and Arc 1');
    expect(glyphs[0].anchor).toEqual([0, 5]);
    const mid = glyphs[1].anchor;
    expect(mid[0]).toBeCloseTo(Math.SQRT1_2 * 10); expect(mid[1]).toBeCloseTo(Math.SQRT1_2 * 10);
    // Glyphs on one curve stack across its radius, outward.
    expect(glyphs[0].offset).toEqual([-7.5, -12]); expect(glyphs[2].offset).toEqual([7.5, -12]);
    // A clockwise arc's middle lies on the other side.
    const clockwise = layoutCadSketchRelationGlyphs({ ...graph, entities: [graph.entities[0], { ...graph.entities[1], direction: 'cw' } as CadSketchGraph['entities'][number]] }, { r: 5 });
    expect(clockwise[1].anchor[0]).toBeCloseTo(-Math.SQRT1_2 * 10); expect(clockwise[1].anchor[1]).toBeCloseTo(-Math.SQRT1_2 * 10);
  });

  it('draws Fix X and Fix Y on one point as one Fixed glyph, and a single axis fix by its own name', () => {
    const graph = rectangle([{ id: 'x', kind: 'fixed-axis', pointId: 'b', axis: 'x', value: 40 }, { id: 'y', kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 0 },
      { id: 'cx', kind: 'fixed-axis', pointId: 'c', axis: 'x', value: 40 }, { id: 'origin', kind: 'fixed-point', pointId: 'a', position: [0, 0] }]);
    expect(layoutCadSketchRelationGlyphs(graph, {}).map(glyph => [glyph.relationIds, glyph.operand, glyph.kind, glyph.label])).toEqual([
      [['x', 'y'], 'point:b', 'fix', 'Fixed: Point 2'], [['cx'], 'point:c', 'fix', 'Fix X: Point 3'], [['origin'], 'point:a', 'fix', 'Fixed at the origin: Point 1']]);
  });

  it('places point relations at their point, Symmetric on both points and its axis, and Tangent at the joint', () => {
    const graph: CadSketchGraph = {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'm', position: [10, 0] }, { id: 'p', position: [-5, 5] }, { id: 'q', position: [25, 5] },
        { id: 'top', position: [10, 10] }, { id: 'o', position: [20, 5] }, { id: 'e', position: [25, 0] }],
      entities: [line('base', 'a', 'b'), line('axis', 'm', 'top'), { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'b', endPointId: 'e', direction: 'ccw' }],
      relations: [{ id: 'mid', kind: 'midpoint', pointId: 'm', lineId: 'base' }, { id: 'mirror', kind: 'symmetric', pointIds: ['p', 'q'], lineId: 'axis' },
        { id: 'smooth', kind: 'tangent-joint', endpoints: [{ entityId: 'base', pointId: 'b' }, { entityId: 'arc', pointId: 'b' }] },
        { id: 'on', kind: 'point-on-line', pointId: 'top', lineId: 'axis' }, { id: 'curve', kind: 'point-on-curve', pointId: 'e', curveId: 'arc' }] };
    expect(summary(graph)).toEqual([
      { relationIds: ['mid'], operand: 'point:m', kind: 'midpoint' },
      { relationIds: ['mirror'], operand: 'point:p', kind: 'symmetric' }, { relationIds: ['mirror'], operand: 'point:q', kind: 'symmetric' }, { relationIds: ['mirror'], operand: 'entity:axis', kind: 'symmetric' },
      { relationIds: ['smooth'], operand: 'point:b', kind: 'tangent' }, { relationIds: ['on'], operand: 'point:top', kind: 'point-on-line' },
      { relationIds: ['curve'], operand: 'point:e', kind: 'point-on-curve' }, { relationIds: ['curve'], operand: 'entity:arc', kind: 'point-on-curve' }]);
    expect(layoutCadSketchRelationGlyphs(graph, {})[4].label).toBe('Tangent: Line 3 at Point 2 and Arc 1 at Point 2');
  });

  it('marks Point on curve on its point and on the circle or arc, where the curve\'s own glyphs sit', () => {
    const graph: CadSketchGraph = {
      points: [{ id: 'o', position: [0, 0] }, { id: 'p', position: [3, 4] }, { id: 'q', position: [20, 0] }],
      entities: [{ id: 'ring', kind: 'circle', construction: false, centerPointId: 'o', radius: 'r' }, { id: 'hole', kind: 'circle', construction: false, centerPointId: 'q', radius: 'r' }],
      relations: [{ id: 'same', kind: 'equal-radius', curveIds: ['ring', 'hole'] }, { id: 'on', kind: 'point-on-curve', pointId: 'p', curveId: 'ring' }] };
    const glyphs = layoutCadSketchRelationGlyphs(graph, { r: 5 }).filter(glyph => glyph.relationIds[0] === 'on');
    // The point keeps its diagonal mark; the circle's mark stacks beside its other glyph at the top of the circle.
    expect(glyphs.map(glyph => [glyph.operand, glyph.anchor, glyph.offset])).toEqual([['point:p', [3, 4], [10, -10]], ['entity:ring', [0, 5], [7.5, -12]]]);
    expect(glyphs[0].holds).toEqual({ points: ['p'], entities: ['ring'] });
  });

  it('places the relations of points that Coincident joins in one place by that place, keeping each relation\'s own ID', () => {
    const base = rectangle([{ id: 'join', kind: 'coincident', pointIds: ['a', 'aa'] }, { id: 'fix', kind: 'fixed-point', pointId: 'aa', position: [0, 0] },
      { id: 'on', kind: 'point-on-line', pointId: 'a', lineId: 'top' }]);
    const graph: CadSketchGraph = { ...base, points: [...base.points, { id: 'aa', position: [0, 0] }] };
    // One row of glyphs on the shared place, not two glyphs drawn over each other.
    expect(layoutCadSketchRelationGlyphs(graph, {}).map(glyph => [glyph.relationIds, glyph.operand, glyph.offset])).toEqual([
      [['join'], 'point:a', [10, -10]], [['fix'], 'point:a', [25, -10]], [['on'], 'point:a', [40, -10]]]);
  });

  it('draws Fix X and Fix Y on points that Coincident joins as one Fixed glyph that names both relations', () => {
    const base = rectangle([{ id: 'x', kind: 'fixed-axis', pointId: 'b', axis: 'x', value: 40 }, { id: 'join', kind: 'coincident', pointIds: ['bb', 'b'] },
      { id: 'y', kind: 'fixed-axis', pointId: 'bb', axis: 'y', value: 0 }]);
    const graph: CadSketchGraph = { ...base, points: [...base.points, { id: 'bb', position: [40, 0] }] };
    expect(layoutCadSketchRelationGlyphs(graph, {}).map(glyph => [glyph.relationIds, glyph.operand, glyph.kind, glyph.label])).toEqual([
      [['x', 'y'], 'point:b', 'fix', 'Fixed: Point 2'], [['join'], 'point:b', 'coincident', 'Coincident: Point 5 and Point 2']]);
  });

  it('draws Horizontal or Vertical between points joined to a line\'s ends as one mark on that line, holding the line and both places', () => {
    const base = rectangle([{ id: 'ja', kind: 'coincident', pointIds: ['a', 'a2'] }, { id: 'jb', kind: 'coincident', pointIds: ['b2', 'b'] },
      { id: 'level', kind: 'horizontal', pointIds: ['a2', 'b2'] }]);
    const graph: CadSketchGraph = { ...base, points: [...base.points, { id: 'a2', position: [0, 0] }, { id: 'b2', position: [40, 0] }] };
    const level = layoutCadSketchRelationGlyphs(graph, {}).filter(glyph => glyph.relationIds[0] === 'level');
    expect(level.map(glyph => [glyph.operand, glyph.anchor, glyph.offset])).toEqual([['entity:bottom', [20, 0], [0, -12]]]);
    expect(level[0].holds.points).toEqual(['a', 'b']);
  });

  it('leaves dimensions, linear patterns and linked references to their own controls, and keeps a broken relation\'s glyphs on the operands that remain, so it can be removed', () => {
    const graph = rectangle([{ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 }, { id: 'measured', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'top' } },
      { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'bottom', towardPointId: 'b' }, { lineId: 'right', towardPointId: 'c' }], sense: 'ccw', value: 90 },
      { id: 'row', kind: 'linear-pattern', seed: { kind: 'circle', entityId: 'hole', centerPointId: 'a' }, idPrefix: 'row', direction: '+x', count: 2, spacing: 5, omittedInstances: [] },
      { id: 'link', kind: 'external-reference', entityId: 'top', sourceSketchId: 'other', source: { kind: 'line', entityId: 'edge', startPointId: 's', endPointId: 'e' } },
      { id: 'lost', kind: 'parallel', lineIds: ['bottom', 'gone'] }, { id: 'ghost', kind: 'horizontal', pointIds: ['a', 'missing'] }]);
    expect(summary(graph)).toEqual([{ relationIds: ['lost'], operand: 'entity:bottom', kind: 'parallel' }, { relationIds: ['ghost'], operand: 'point:a', kind: 'horizontal' }]);
  });

  it('keeps each glyph a drag leaves in place as the same object, and places the moved ones afresh', () => {
    const graph = rectangle(), entries = cadSketchRelationGlyphEntries(graph), resting = placeCadSketchRelationGlyphs(graph, {}, entries);
    // Point c moves up: the right and top edges carry their glyphs with them, the bottom and left keep theirs.
    const dragged = { ...graph, points: graph.points.map(point => point.id === 'c' ? { ...point, position: [40, 30] as [number, number] } : point) };
    const placed = placeCadSketchRelationGlyphs(dragged, {}, entries, resting);
    expect(placed.map(glyph => resting.includes(glyph))).toEqual([true, false, false, true]);
    expect(placed).toEqual(placeCadSketchRelationGlyphs(dragged, {}, entries));
    // Entries named again, as after an edit, place new glyphs even where they lie, so a glyph never keeps an earlier name or label.
    expect(placeCadSketchRelationGlyphs(graph, {}, cadSketchRelationGlyphEntries(graph), resting).some(glyph => resting.includes(glyph))).toBe(false);
  });

  it('gives a relation that reuses an ID for other operands a new mount key, so it never inherits hover, focus or selection', () => {
    const keys = createCadSketchDimensionKeys(), graph = rectangle([{ id: 'p', kind: 'parallel', lineIds: ['bottom', 'top'] }]);
    const first = keys(graph).get('p');
    expect(keys({ ...graph, points: graph.points.map(point => point.id === 'c' ? { ...point, position: [41, 20] } : point) }).get('p')).toBe(first);
    expect(keys({ ...graph, relations: [{ id: 'p', kind: 'parallel', lineIds: ['left', 'right'] }] }).get('p')).not.toBe(first);
  });
});
