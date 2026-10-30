import { describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import {
  cadSketchDimensionIds, cadSketchDimensionPick, cadSketchDimensionSelectionStatus, cadSketchRelationHighlight, createCadSketchDimensionKeys, createCadSketchHighlightStore,
  isCadSketchDimensionPickCurrent, isCadSketchDimensionRelation, isCadSketchGlyphRelation, keepCadSketchDimensionPicks, NO_SKETCH_DIMENSION_IDS, NO_SKETCH_DIMENSIONS,
  reconcileCadSketchDimensionSelection, selectCadSketchAnnotations, selectCadSketchDimension, type CadSketchDimensionPick
} from './cadSketchDimensionSelection';
import { cadSketchDimensionToDriving, cadSketchDimensionToReference } from './cadSketchDimensionCommands';

const graph = parseCadSketchGraph({
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 30] }, { id: 'o', position: [10, 10] }],
  entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
    { id: 'hole', kind: 'circle', centerPointId: 'o', radius: 4, construction: false }],
  relations: [
    { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 },
    { id: 'diagonal', kind: 'distance', pointIds: ['a', 'c'], value: 50 },
    { id: 'rise', kind: 'axis-distance', pointIds: ['b', 'c'], axis: 'y', value: 30 },
    { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'a' }, { lineId: 'side', towardPointId: 'c' }], sense: 'cw', value: 90 },
    { id: 'size', kind: 'radial-size', entityId: 'hole', quantity: 'diameter', value: 8 },
    { id: 'x', kind: 'fixed-axis', pointId: 'o', axis: 'x', value: 10 },
    { id: 'y', kind: 'fixed-axis', pointId: 'o', axis: 'y', value: 10 },
    { id: 'parallel-free', kind: 'horizontal', pointIds: ['a', 'b'] }
  ]
});

describe('sketch dimension selection', () => {
  const pick = (id: string) => { const found = cadSketchDimensionPick(graph, id); if (!found) throw new Error(`${id} is not a dimension`); return found; };
  const withRelation = (relation: (typeof graph.relations)[number]) => ({ ...graph, relations: graph.relations.map(item => item.id === relation.id ? relation : item) });

  it('selects one dimension, toggles with Shift and keeps identity when nothing changes', () => {
    const one = selectCadSketchDimension(NO_SKETCH_DIMENSIONS, pick('length'), graph);
    expect(cadSketchDimensionIds(one)).toEqual(['length']);
    expect(selectCadSketchDimension(one, pick('length'), graph)).toBe(one);
    const two = selectCadSketchDimension(one, pick('size'), graph, true);
    expect(cadSketchDimensionIds(two)).toEqual(['length', 'size']);
    expect(cadSketchDimensionIds(selectCadSketchDimension(two, pick('rise'), graph))).toEqual(['rise']);
    expect(cadSketchDimensionIds(selectCadSketchDimension(two, pick('length'), graph, true))).toEqual(['size']);
    expect(selectCadSketchDimension([pick('size')], pick('size'), graph, true)).toBe(NO_SKETCH_DIMENSIONS);
    expect(Object.isFrozen(two)).toBe(true); expect(cadSketchDimensionIds(NO_SKETCH_DIMENSIONS)).toBe(NO_SKETCH_DIMENSION_IDS);
  });

  it('caps an additive selection', () => {
    let current: readonly CadSketchDimensionPick[] = NO_SKETCH_DIMENSIONS;
    for (let index = 0; index < 70; index++) current = selectCadSketchDimension(current, { id: `d${index}`, form: 'distance', identity: 'pair', measures: { kind: 'own', key: 'pair' } }, graph, true);
    expect(current).toHaveLength(64);
  });

  it('reconciles after undo or deletion: removed or non-dimension relations drop out and an intact set keeps its identity', () => {
    const current = Object.freeze([pick('length'), pick('size')]);
    expect(reconcileCadSketchDimensionSelection(graph, current)).toBe(current);
    const withoutSize = { ...graph, relations: graph.relations.filter(relation => relation.id !== 'size') };
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(withoutSize, current))).toEqual(['length']);
    // Positional relations and fixed coordinates select as relation glyphs, by their own operands; a pick under another form drops out.
    expect(cadSketchDimensionPick(graph, 'parallel-free')?.form).toBe('horizontal'); expect(cadSketchDimensionPick(graph, 'x')?.form).toBe('fixed-axis');
    const glyph = Object.freeze([pick('length'), pick('parallel-free')]);
    expect(reconcileCadSketchDimensionSelection(graph, glyph)).toBe(glyph);
    expect(reconcileCadSketchDimensionSelection(withRelation({ id: 'parallel-free', kind: 'horizontal', pointIds: ['b', 'c'] }), glyph)).toEqual([pick('length')]);
    expect(reconcileCadSketchDimensionSelection(graph, [{ ...pick('length'), id: 'x' }])).toBe(NO_SKETCH_DIMENSIONS);
    expect(reconcileCadSketchDimensionSelection(undefined, current)).toBe(NO_SKETCH_DIMENSIONS);
    expect(reconcileCadSketchDimensionSelection(graph, NO_SKETCH_DIMENSIONS)).toBe(NO_SKETCH_DIMENSIONS);
  });

  it('keeps a dimension whose value changes, but drops an ID that now names a different measurement', () => {
    const current = Object.freeze([pick('length'), pick('size')]);
    // A new value, or an expression, is the same dimension.
    expect(reconcileCadSketchDimensionSelection(withRelation({ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: ' width ' }), current)).toBe(current);
    // An agent edit or undo that reuses the ID for other points, another kind or the other radial quantity does not inherit the selection.
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(withRelation({ id: 'length', kind: 'distance', pointIds: ['a', 'c'], value: 40 }), current))).toEqual(['size']);
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(withRelation({ id: 'length', kind: 'axis-distance', pointIds: ['a', 'b'], axis: 'x', value: 40 }), current))).toEqual(['size']);
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(withRelation({ id: 'size', kind: 'radial-size', entityId: 'hole', quantity: 'radius', value: 4 }), current))).toEqual(['length']);
    const angle = pick('angle');
    expect(reconcileCadSketchDimensionSelection(withRelation({ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'a' }, { lineId: 'side', towardPointId: 'c' }], sense: 'cw', value: 45 }), [angle])).toEqual([angle]);
    expect(reconcileCadSketchDimensionSelection(withRelation({ id: 'angle', kind: 'line-angle', rays: [{ lineId: 'base', towardPointId: 'a' }, { lineId: 'side', towardPointId: 'c' }], sense: 'ccw', value: 90 }), [angle])).toBe(NO_SKETCH_DIMENSIONS);
  });

  it('keeps the selection through Make reference and Make driving, which measure the same thing', () => {
    const current = Object.freeze([pick('length'), pick('diagonal'), pick('size')]);
    const referenced = { ...graph, relations: graph.relations.map(relation => relation.id === 'length' ? { id: 'length', kind: 'reference-dimension' as const, measurement: { kind: 'line-length' as const, entityId: 'base' } }
      : relation.id === 'diagonal' ? { id: 'diagonal', kind: 'reference-dimension' as const, measurement: { kind: 'point-distance' as const, pointIds: ['c', 'a'] as const } }
        : relation.id === 'size' ? { id: 'size', kind: 'reference-dimension' as const, measurement: { kind: 'radial-size' as const, entityId: 'hole', quantity: 'diameter' as const } } : relation) };
    const kept = reconcileCadSketchDimensionSelection(referenced, current);
    expect(cadSketchDimensionIds(kept)).toEqual(['length', 'diagonal', 'size']);
    // The kept picks take the reference form, and Make driving brings them back.
    expect(kept.map(item => item.form)).toEqual(['reference/line-length', 'reference/point-distance', 'reference/radial-size']);
    expect(reconcileCadSketchDimensionSelection(graph, kept)).toEqual(current);
    // A reference to another line under the same ID is a different dimension.
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(withRelation({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'side' } }), current))).toEqual(['diagonal', 'size']);
  });

  it('keeps a line reference selected when Trim or Extend rewrites an endpoint of its line, and through a later Make driving', () => {
    const measured = { id: 'measured', kind: 'reference-dimension' as const, measurement: { kind: 'line-length' as const, entityId: 'base' } };
    const referenced = { ...graph, relations: [...graph.relations.filter(relation => relation.id !== 'length'), measured] };
    const current = Object.freeze([cadSketchDimensionPick(referenced, 'measured')!]);
    // Trim gives the base line a new end point; the reference still names the base line.
    const trimmed = { ...referenced, points: [...referenced.points, { id: 'n', position: [25, 0] as const }],
      entities: referenced.entities.map(entity => entity.id === 'base' && entity.kind === 'line' ? { ...entity, endPointId: 'n' } : entity) };
    const kept = reconcileCadSketchDimensionSelection(trimmed, current);
    expect(cadSketchDimensionIds(kept)).toEqual(['measured']);
    const driving = { ...trimmed, relations: trimmed.relations.map(relation => relation.id === 'measured' ? { id: 'measured', kind: 'distance' as const, pointIds: ['a', 'n'] as const, value: 25 } : relation) };
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(driving, kept))).toEqual(['measured']);
    // Pointing the reference at another line, or a driving length between other points, is a different dimension.
    const repointed = { ...trimmed, relations: trimmed.relations.map(relation => relation.id === 'measured' ? { ...measured, measurement: { kind: 'line-length' as const, entityId: 'side' } } : relation) };
    expect(reconcileCadSketchDimensionSelection(repointed, kept)).toBe(NO_SKETCH_DIMENSIONS);
    const elsewhere = { ...trimmed, relations: trimmed.relations.map(relation => relation.id === 'measured' ? { id: 'measured', kind: 'distance' as const, pointIds: ['a', 'b'] as const, value: 40 } : relation) };
    expect(reconcileCadSketchDimensionSelection(elsewhere, kept)).toBe(NO_SKETCH_DIMENSIONS);
  });

  it('matches a driver and its reference through Coincident joins, and only through them', () => {
    // q is joined to a and r to the center o; loose sits on a without a join.
    const joined = parseCadSketchGraph({
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 30] }, { id: 'q', position: [0, 0] }, { id: 'loose', position: [0, 0] },
        { id: 'o', position: [10, 10] }, { id: 'r', position: [10, 10] }],
      entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false }],
      relations: [{ id: 'joint', kind: 'coincident', pointIds: ['q', 'a'] }, { id: 'center', kind: 'coincident', pointIds: ['r', 'o'] },
        { id: 'length', kind: 'distance', pointIds: ['q', 'b'], value: 40 }, { id: 'clearance', kind: 'point-line-distance', pointId: 'r', lineId: 'base', side: 'left', value: 10 }]
    });
    type Relation = (typeof joined.relations)[number];
    const change = (source: typeof joined, relations: Readonly<Record<string, Relation>>) => ({ ...source, relations: source.relations.map(relation => relations[relation.id] ?? relation) });
    const current = Object.freeze([cadSketchDimensionPick(joined, 'length')!, cadSketchDimensionPick(joined, 'clearance')!]);
    // The line's Dimension editor stores Reference length on the line, and the circle double-pick's reference on the center it picked.
    const referenced = change(joined, { length: { id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } },
      clearance: { id: 'clearance', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'o', lineId: 'base' } } });
    const kept = reconcileCadSketchDimensionSelection(referenced, current);
    expect(cadSketchDimensionIds(kept)).toEqual(['length', 'clearance']);
    // Make driving on the line's endpoints and the center keeps them, and so does a driver back on the aliases.
    const driving = change(referenced, { length: { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: 40 },
      clearance: { id: 'clearance', kind: 'point-line-distance', pointId: 'o', lineId: 'base', side: 'left', value: 10 } });
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(driving, kept))).toEqual(['length', 'clearance']);
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(joined, kept))).toEqual(['length', 'clearance']);
    expect(isCadSketchDimensionPickCurrent(change(joined, { length: { id: 'length', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['b', 'a'] } } }), current[0])).toBe(true);
    // Another line, another point, or a point that only lies on a, is a different measurement under the same ID.
    const replaced = (relation: Relation, pick: CadSketchDimensionPick) => isCadSketchDimensionPickCurrent(change(joined, { [relation.id]: relation }), pick);
    expect(replaced({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'side' } }, current[0])).toBe(false);
    expect(replaced({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['loose', 'b'] } }, current[0])).toBe(false);
    expect(replaced({ id: 'clearance', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'o', lineId: 'side' } }, current[1])).toBe(false);
    expect(replaced({ id: 'clearance', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'c', lineId: 'base' } }, current[1])).toBe(false);
    // Without the join, the line's reference measures other points than the driver on q did.
    const unjoined = { ...joined, relations: joined.relations.filter(relation => relation.id !== 'joint') };
    expect(reconcileCadSketchDimensionSelection(change(unjoined, { length: referenced.relations.find(relation => relation.id === 'length')! }), [cadSketchDimensionPick(unjoined, 'length')!])).toBe(NO_SKETCH_DIMENSIONS);
    // A line reference keeps its pick through a Trim that ends the line on a new point, and a later driver on that point's alias still matches it.
    const trimmed = { ...referenced, points: [...referenced.points, { id: 'n', position: [25, 0] as const }, { id: 'm', position: [25, 0] as const }],
      entities: referenced.entities.map(entity => entity.id === 'base' && entity.kind === 'line' ? { ...entity, endPointId: 'n' } : entity),
      relations: [...referenced.relations, { id: 'end', kind: 'coincident' as const, pointIds: ['m', 'n'] as const }] };
    const trimmedKept = reconcileCadSketchDimensionSelection(trimmed, [kept[0]]);
    expect(cadSketchDimensionIds(trimmedKept)).toEqual(['length']);
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(change(trimmed, { length: { id: 'length', kind: 'distance', pointIds: ['q', 'm'], value: 25 } }), trimmedKept))).toEqual(['length']);
    expect(reconcileCadSketchDimensionSelection(change(trimmed, { length: { id: 'length', kind: 'distance', pointIds: ['q', 'b'], value: 40 } }), trimmedKept)).toBe(NO_SKETCH_DIMENSIONS);
  });

  describe('across one edit that converts a dimension and removes or adds its Coincident joins', () => {
    const sketch = (points: Readonly<Record<string, readonly [number, number]>>, relations: readonly object[]) => parseCadSketchGraph({
      points: Object.entries(points).map(([id, position]) => ({ id, position })),
      entities: [{ id: 'base', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }, { id: 'side', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false }],
      relations
    });
    // A length on q and a point to line distance on r. Together, q sits on a and r on the center o; apart, both have moved.
    const together = { a: [0, 0], b: [40, 0], c: [40, 30], q: [0, 0], o: [10, 10], r: [10, 10] } as const, apart = { ...together, q: [-20, 5], r: [30, 25] } as const;
    const joints = [{ id: 'joint', kind: 'coincident', pointIds: ['q', 'a'] }, { id: 'center', kind: 'coincident', pointIds: ['r', 'o'] }];
    const drivers = [{ id: 'length', kind: 'distance', pointIds: ['q', 'b'], value: 40 }, { id: 'clearance', kind: 'point-line-distance', pointId: 'r', lineId: 'base', side: 'left', value: 10 }];
    const references = [{ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } },
      { id: 'clearance', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'o', lineId: 'base' } }];
    const joined = sketch(together, [...joints, ...drivers]), detached = sketch(apart, references), loose = sketch(apart, drivers), attached = sketch(together, [...joints, ...references]);

    // The review's repro: the edit removes the joins, moves q and r away and makes each dimension, under its ID, a reference on the line and on o.
    it.each(['length', 'clearance'])('drops the %s, renews its key and selects its successor afresh when the edit removes its join', id => {
      const picked = Object.freeze([cadSketchDimensionPick(joined, id)!]), successor = cadSketchDimensionPick(detached, id)!;
      expect(reconcileCadSketchDimensionSelection(detached, picked)).toBe(NO_SKETCH_DIMENSIONS);
      expect(isCadSketchDimensionPickCurrent(detached, picked[0])).toBe(false);
      expect(selectCadSketchDimension(picked, successor, detached, true)).toEqual([picked[0], successor]);
      const keys = createCadSketchDimensionKeys(), before = keys(joined).get(id);
      expect(keys(detached).get(id)).not.toBe(before);
    });
    it.each(['length', 'clearance'])('keeps the %s and its key when the edit adds the join it is measured through', id => {
      const picked = Object.freeze([cadSketchDimensionPick(loose, id)!]);
      expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(attached, picked))).toEqual([id]);
      expect(isCadSketchDimensionPickCurrent(attached, picked[0])).toBe(true);
      expect(selectCadSketchDimension(picked, cadSketchDimensionPick(attached, id)!, attached, true)).toBe(NO_SKETCH_DIMENSIONS);
      const keys = createCadSketchDimensionKeys(), before = keys(loose).get(id);
      expect(keys(attached).get(id)).toBe(before);
      // A pick keeps the operands it was authored on, so the graph it was picked in has no say.
      expect(cadSketchDimensionPick(joined, id)).toEqual(picked[0]);
    });
  });

  it('keeps a mount key while the ID names the same dimension and renews it when a replacement takes the ID', () => {
    const keys = createCadSketchDimensionKeys(), first = keys(graph).get('length');
    expect(keys(withRelation({ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: 41 })).get('length')).toBe(first);
    expect(keys(withRelation({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } })).get('length')).toBe(first);
    expect(keys(graph).get('length')).toBe(first);
    const replaced = keys(withRelation({ id: 'length', kind: 'distance', pointIds: ['a', 'c'], value: 50 })).get('length');
    expect(replaced).not.toBe(first);
    // Restoring the first dimension replaces the one shown, so it mounts afresh too.
    expect(keys(graph).get('length')).not.toBe(replaced);
    // The dimensions layer keys only dimensions, the glyph layer only the others; both share one key rule.
    expect(keys(graph).has('parallel-free')).toBe(true);
    expect(createCadSketchDimensionKeys(isCadSketchDimensionRelation)(graph).has('parallel-free')).toBe(false);
    expect([...createCadSketchDimensionKeys(isCadSketchGlyphRelation)(graph).keys()]).toEqual(['x', 'y', 'parallel-free']);
    expect(isCadSketchDimensionPickCurrent(graph, pick('length'))).toBe(true);
    expect(isCadSketchDimensionPickCurrent(withRelation({ id: 'length', kind: 'distance', pointIds: ['a', 'c'], value: 50 }), pick('length'))).toBe(false);
    expect(isCadSketchDimensionPickCurrent(undefined, pick('length'))).toBe(false);
  });

  it('describes the selection for the status line without opening the editor', () => {
    expect(cadSketchDimensionSelectionStatus(graph, ['length'])).toBe('Length selected · Double-click or Enter edits · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['diagonal'])).toBe('Distance selected · Double-click or Enter edits · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['size', 'rise'])).toBe('2 dimensions selected · Delete removes them');
    expect(cadSketchDimensionSelectionStatus(graph, [])).toBeNull();
    expect(cadSketchDimensionSelectionStatus(graph, ['gone'])).toBeNull();
  });

  it('describes a relation glyph selection by the relation names, Fix X and Fix Y on one point as Fixed, and a mixed one by its counts', () => {
    expect(cadSketchDimensionSelectionStatus(graph, ['parallel-free'])).toBe('Horizontal selected · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['x'])).toBe('Fix X selected · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['x', 'y'])).toBe('Fixed selected · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['length', 'x', 'y'])).toBe('1 dimension and 2 relations selected · Delete removes them');
    expect(cadSketchDimensionSelectionStatus(graph, ['parallel-free', 'x', 'y'])).toBe('3 relations selected · Delete removes them');
  });

  it('selects the relations of one glyph together: a click replaces the selection, Shift adds them or, when all are selected, removes them', () => {
    const fixed = [pick('x'), pick('y')], one = selectCadSketchAnnotations(NO_SKETCH_DIMENSIONS, [pick('length')], graph);
    expect(cadSketchDimensionIds(selectCadSketchAnnotations(one, fixed, graph))).toEqual(['x', 'y']);
    const both = selectCadSketchAnnotations(one, fixed, graph, true);
    expect(cadSketchDimensionIds(both)).toEqual(['length', 'x', 'y']);
    expect(selectCadSketchAnnotations(both, [pick('y'), pick('x')], graph)).not.toBe(both);
    expect(cadSketchDimensionIds(selectCadSketchAnnotations(both, fixed, graph, true))).toEqual(['length']);
    expect(selectCadSketchAnnotations(selectCadSketchAnnotations(NO_SKETCH_DIMENSIONS, fixed, graph), fixed, graph, true)).toBe(NO_SKETCH_DIMENSIONS);
    // Hiding relation glyphs keeps the dimensions selected, and an unchanged set keeps its identity.
    expect(cadSketchDimensionIds(keepCadSketchDimensionPicks(both, item => item.id === 'length'))).toEqual(['length']);
    expect(keepCadSketchDimensionPicks(both, () => true)).toBe(both);
  });
});

describe('sketch relation highlight', () => {
  const highlight = (id: string) => cadSketchRelationHighlight(graph, graph.relations.find(relation => relation.id === id)!);
  it('names the measured points and the line they span for a length', () => {
    expect(highlight('length')).toEqual({ pointIds: ['a', 'b'], entityIds: ['base'], datums: [] });
    expect(highlight('diagonal')).toEqual({ pointIds: ['a', 'c'], entityIds: [], datums: [] });
    expect(highlight('rise')).toEqual({ pointIds: ['b', 'c'], entityIds: ['side'], datums: [] });
  });
  it('names the lines of an angle and the curve of a radius or diameter', () => {
    expect(highlight('angle')).toEqual({ pointIds: [], entityIds: ['base', 'side'], datums: [] });
    expect(highlight('size')).toEqual({ pointIds: [], entityIds: ['hole'], datums: [] });
  });
  it('names the datum a coordinate is measured from', () => {
    expect(highlight('x')).toEqual({ pointIds: ['o'], entityIds: [], datums: ['y-axis'] });
    expect(highlight('y')).toEqual({ pointIds: ['o'], entityIds: [], datums: ['x-axis'] });
  });
  it('names every line between the two points in graph order, whichever way each runs, and each graph from its own geometry', () => {
    const lines = parseCadSketchGraph({
      points: [{ id: 'p', position: [0, 0] }, { id: 'q', position: [10, 0] }, { id: 'r', position: [10, 10] }],
      entities: [{ id: 'z', kind: 'line', startPointId: 'q', endPointId: 'p', construction: false }, { id: 'other', kind: 'line', startPointId: 'q', endPointId: 'r', construction: false },
        { id: 'a', kind: 'line', startPointId: 'p', endPointId: 'q', construction: true }],
      relations: [{ id: 'level', kind: 'horizontal', pointIds: ['p', 'q'] }, { id: 'upright', kind: 'vertical', pointIds: ['r', 'q'] }]
    });
    expect(cadSketchRelationHighlight(lines, lines.relations[0])).toEqual({ pointIds: ['p', 'q'], entityIds: ['z', 'a'], datums: [] });
    expect(cadSketchRelationHighlight(lines, lines.relations[1])).toEqual({ pointIds: ['r', 'q'], entityIds: ['other'], datums: [] });
    const removed = { ...lines, entities: lines.entities.filter(entity => entity.id !== 'z') };
    expect(cadSketchRelationHighlight(removed, removed.relations[0]).entityIds).toEqual(['a']);
  });
});

describe('sketch highlight store', () => {
  it('publishes only real changes and lets each owner clear only its own highlight', () => {
    const store = createCadSketchHighlightStore(), listener = vi.fn(), stop = store.subscribe(listener);
    store.show('dimension:length', { kind: 'relation', relationId: 'length' });
    store.show('dimension:length', { kind: 'relation', relationId: 'length' });
    expect(listener).toHaveBeenCalledOnce();
    store.show('row', { kind: 'geometry', pointIds: ['a'], entityIds: [], datums: [] });
    store.hide('dimension:length');
    expect(store.getSnapshot()).toEqual({ kind: 'geometry', pointIds: ['a'], entityIds: [], datums: [] });
    store.hide('row');
    expect(store.getSnapshot()).toBeNull(); expect(listener).toHaveBeenCalledTimes(3);
    stop(); store.show('row', { kind: 'relation', relationId: 'size' });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe('sketch dimension conversions', () => {
  const relation = (id: string) => graph.relations.find(item => item.id === id)!;
  it('turns a driving length, distance or diameter into a reference with the same identity', () => {
    expect(cadSketchDimensionToReference(graph, relation('length'))).toEqual({ reason: null,
      relation: { id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } } });
    expect(cadSketchDimensionToReference(graph, relation('diagonal')).relation).toEqual({ id: 'diagonal', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['a', 'c'] } });
    expect(cadSketchDimensionToReference(graph, relation('size')).relation).toEqual({ id: 'size', kind: 'reference-dimension', measurement: { kind: 'radial-size', entityId: 'hole', quantity: 'diameter' } });
  });
  it('explains why other dimensions cannot become references', () => {
    expect(cadSketchDimensionToReference(graph, relation('angle'))).toEqual({ relation: null, reason: 'Reference dimensions measure lengths, point distances, point to line distances, radii and diameters.' });
    expect(cadSketchDimensionToReference(graph, relation('rise')).reason).toBe('Reference dimensions measure lengths, point distances, point to line distances, radii and diameters.');
    const measured = { ...graph, relations: [...graph.relations, { id: 'measured', kind: 'reference-dimension' as const, measurement: { kind: 'line-length' as const, entityId: 'base' } }] };
    expect(cadSketchDimensionToReference(measured, relation('length')).reason).toBe('A reference dimension already measures this. Delete this dimension instead.');
  });
  it('turns a reference into a driving dimension at its measured value, unless a driver already exists', () => {
    const reference = { id: 'measured', kind: 'reference-dimension' as const, measurement: { kind: 'line-length' as const, entityId: 'side' } };
    const measured = { ...graph, relations: [...graph.relations, reference] };
    expect(cadSketchDimensionToDriving(measured, {}, reference)).toEqual({ reason: null, relation: { id: 'measured', kind: 'distance', pointIds: ['b', 'c'], value: 30 } });
    const driven = { id: 'measured', kind: 'reference-dimension' as const, measurement: { kind: 'line-length' as const, entityId: 'base' } };
    expect(cadSketchDimensionToDriving({ ...graph, relations: [...graph.relations, driven] }, {}, driven).reason).toBe('An existing dimension already drives this distance. Edit that dimension instead.');
    expect(cadSketchDimensionToDriving(graph, {}, relation('length')).reason).toBe('This dimension already drives the geometry.');
  });
});
