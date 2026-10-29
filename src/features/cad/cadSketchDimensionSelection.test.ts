import { describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import {
  cadSketchDimensionIds, cadSketchDimensionPick, cadSketchDimensionSelectionStatus, cadSketchRelationHighlight, createCadSketchDimensionKeys, createCadSketchHighlightStore,
  isCadSketchDimensionPickCurrent, NO_SKETCH_DIMENSION_IDS, NO_SKETCH_DIMENSIONS, reconcileCadSketchDimensionSelection, selectCadSketchDimension, type CadSketchDimensionPick
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
    const one = selectCadSketchDimension(NO_SKETCH_DIMENSIONS, pick('length'));
    expect(cadSketchDimensionIds(one)).toEqual(['length']);
    expect(selectCadSketchDimension(one, pick('length'))).toBe(one);
    const two = selectCadSketchDimension(one, pick('size'), true);
    expect(cadSketchDimensionIds(two)).toEqual(['length', 'size']);
    expect(cadSketchDimensionIds(selectCadSketchDimension(two, pick('rise')))).toEqual(['rise']);
    expect(cadSketchDimensionIds(selectCadSketchDimension(two, pick('length'), true))).toEqual(['size']);
    expect(selectCadSketchDimension([pick('size')], pick('size'), true)).toBe(NO_SKETCH_DIMENSIONS);
    expect(Object.isFrozen(two)).toBe(true); expect(cadSketchDimensionIds(NO_SKETCH_DIMENSIONS)).toBe(NO_SKETCH_DIMENSION_IDS);
  });

  it('caps an additive selection', () => {
    let current: readonly CadSketchDimensionPick[] = NO_SKETCH_DIMENSIONS;
    for (let index = 0; index < 70; index++) current = selectCadSketchDimension(current, { id: `d${index}`, form: 'distance', identity: 'pair', measures: 'pair' }, true);
    expect(current).toHaveLength(64);
  });

  it('reconciles after undo or deletion: removed or non-dimension relations drop out and an intact set keeps its identity', () => {
    const current = Object.freeze([pick('length'), pick('size')]);
    expect(reconcileCadSketchDimensionSelection(graph, current)).toBe(current);
    const withoutSize = { ...graph, relations: graph.relations.filter(relation => relation.id !== 'size') };
    expect(cadSketchDimensionIds(reconcileCadSketchDimensionSelection(withoutSize, current))).toEqual(['length']);
    // Positional relations and datum coordinates are not canvas dimensions.
    expect(cadSketchDimensionPick(graph, 'parallel-free')).toBeNull(); expect(cadSketchDimensionPick(graph, 'x')).toBeNull();
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

  it('keeps a mount key while the ID names the same dimension and renews it when a replacement takes the ID', () => {
    const keys = createCadSketchDimensionKeys(), first = keys(graph).get('length');
    expect(keys(withRelation({ id: 'length', kind: 'distance', pointIds: ['b', 'a'], value: 41 })).get('length')).toBe(first);
    expect(keys(withRelation({ id: 'length', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'base' } })).get('length')).toBe(first);
    expect(keys(graph).get('length')).toBe(first);
    const replaced = keys(withRelation({ id: 'length', kind: 'distance', pointIds: ['a', 'c'], value: 50 })).get('length');
    expect(replaced).not.toBe(first);
    // Restoring the first dimension replaces the one shown, so it mounts afresh too.
    expect(keys(graph).get('length')).not.toBe(replaced);
    expect(keys(graph).has('parallel-free')).toBe(false);
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
