import { describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import {
  cadSketchDimensionSelectionStatus, cadSketchRelationHighlight, createCadSketchHighlightStore, NO_SKETCH_DIMENSIONS,
  reconcileCadSketchDimensionSelection, selectCadSketchDimension
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
  it('selects one dimension, toggles with Shift and keeps identity when nothing changes', () => {
    const one = selectCadSketchDimension(NO_SKETCH_DIMENSIONS, 'length');
    expect(one).toEqual(['length']);
    expect(selectCadSketchDimension(one, 'length')).toBe(one);
    const two = selectCadSketchDimension(one, 'size', true);
    expect(two).toEqual(['length', 'size']);
    expect(selectCadSketchDimension(two, 'rise')).toEqual(['rise']);
    expect(selectCadSketchDimension(two, 'length', true)).toEqual(['size']);
    expect(selectCadSketchDimension(['size'], 'size', true)).toBe(NO_SKETCH_DIMENSIONS);
    expect(Object.isFrozen(two)).toBe(true);
  });

  it('caps an additive selection', () => {
    let current: readonly string[] = NO_SKETCH_DIMENSIONS;
    for (let index = 0; index < 70; index++) current = selectCadSketchDimension(current, `d${index}`, true);
    expect(current).toHaveLength(64);
  });

  it('reconciles after undo or deletion: removed or non-dimension relations drop out and an intact set keeps its identity', () => {
    const current = Object.freeze(['length', 'size']);
    expect(reconcileCadSketchDimensionSelection(graph, current)).toBe(current);
    const withoutSize = { ...graph, relations: graph.relations.filter(relation => relation.id !== 'size') };
    expect(reconcileCadSketchDimensionSelection(withoutSize, current)).toEqual(['length']);
    // Positional relations and datum coordinates are not canvas dimensions.
    expect(reconcileCadSketchDimensionSelection(graph, ['parallel-free', 'x'])).toBe(NO_SKETCH_DIMENSIONS);
    expect(reconcileCadSketchDimensionSelection(undefined, current)).toBe(NO_SKETCH_DIMENSIONS);
    expect(reconcileCadSketchDimensionSelection(graph, NO_SKETCH_DIMENSIONS)).toBe(NO_SKETCH_DIMENSIONS);
  });

  it('describes the selection for the status line without opening the editor', () => {
    expect(cadSketchDimensionSelectionStatus(graph, ['length'])).toBe('Length selected · Double-click or Enter edits · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['diagonal'])).toBe('Distance selected · Double-click or Enter edits · Delete removes');
    expect(cadSketchDimensionSelectionStatus(graph, ['size', 'rise'])).toBe('2 dimensions selected · Delete removes them');
    expect(cadSketchDimensionSelectionStatus(graph, [])).toBeNull();
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
    expect(cadSketchDimensionToReference(graph, relation('angle'))).toEqual({ relation: null, reason: 'Reference dimensions measure lengths, point distances, radii and diameters.' });
    expect(cadSketchDimensionToReference(graph, relation('rise')).reason).toBe('Reference dimensions measure lengths, point distances, radii and diameters.');
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
