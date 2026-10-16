import { describe, expect, it } from 'vitest';
import type { CadFeature, CadSketchFeature } from '../cadDocument';
import { applyCadEdits } from '../cadOperations';
import { createCadDocument } from '../cadSchema';
import { cadSketchSourceAvailability, cadSketchSourceIssue, cadSketchSourceIssueMessage, pickCadSketchSource, type CadSketchSourcePurpose } from '../cadSketchSources';

const material: CadSketchFeature = { id: 'material', name: 'Material', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 6, y: 0, radius: 2 } }] };
const datum: CadSketchFeature = { ...material, id: 'datum_profile', plane: { kind: 'datum-plane', featureId: 'datum' } };
const unavailable = [
  { ...material, id: 'empty', profiles: [] },
  { ...material, id: 'construction', profiles: material.profiles.map(profile => ({ ...profile, construction: true })) },
  { ...material, id: 'suppressed', suppressed: true }
] satisfies CadSketchFeature[];
const purposes = ['extrude', 'pocket', 'revolve'] satisfies CadSketchSourcePurpose[];

describe('shared material sketch source eligibility', () => {
  it('offers explicit area choice for a graph lens without changing default material eligibility', () => {
    const lens: CadSketchFeature = { ...material, profiles: [], graph: { points: [{ id: 'left', position: [0, 0] }, { id: 'right', position: ['separation', 0] }],
      entities: [{ id: 'left-circle', kind: 'circle', construction: false, centerPointId: 'left', radius: 5 },
        { id: 'right-circle', kind: 'circle', construction: false, centerPointId: 'right', radius: 5 }], relations: [] } };
    expect(cadSketchSourceAvailability(lens, 'extrude', { separation: 6 })).toEqual({ kind: 'choose-areas' });
    expect(cadSketchSourceAvailability(lens, 'pocket', { separation: 6 })).toEqual({ kind: 'choose-areas' });
    expect(cadSketchSourceAvailability(lens, 'revolve', { separation: 6 })).toMatchObject({ kind: 'unavailable', issue: 'no-material' });
    expect(cadSketchSourceIssue(lens, 'extrude', { separation: 6 })).toBe('no-material');
    expect(pickCadSketchSource({ features: [lens], selectedId: lens.id, purpose: 'extrude', parameters: { separation: 6 } })).toBe(lens);
    expect(pickCadSketchSource({ features: [lens], selectedId: null, purpose: 'pocket', parameters: { separation: 6 } })).toBe(lens);
    expect(pickCadSketchSource({ features: [lens], selectedId: lens.id, purpose: 'revolve', parameters: { separation: 6 } })).toBeUndefined();
    expect(cadSketchSourceAvailability({ ...lens, suppressed: true }, 'extrude', { separation: 6 })).toMatchObject({ kind: 'unavailable', issue: 'suppressed' });
    expect(cadSketchSourceAvailability({ ...lens, plane: { kind: 'datum-plane', featureId: 'datum' } }, 'pocket', { separation: 6 })).toMatchObject({ kind: 'unavailable', issue: 'principal-plane-required' });
    expect(cadSketchSourceAvailability(material, 'extrude')).toEqual({ kind: 'default-material' });
  });
  it('uses the current graph cycle and parameters rather than mistaking an empty legacy list for an empty sketch', () => {
    const graph: CadSketchFeature = { ...material, profiles: [], graph: { points: [{ id: 'center', position: [0, 0] }],
      entities: [{ id: 'rim', kind: 'circle', construction: false, centerPointId: 'center', radius: 'radius' }], relations: [] } };
    expect(cadSketchSourceIssue(graph, 'extrude', { radius: 5 })).toBeNull();
    expect(pickCadSketchSource({ features: [graph], selectedId: graph.id, purpose: 'extrude', parameters: { radius: 5 } })).toBe(graph);
    expect(cadSketchSourceIssue({ ...graph, graph: { ...graph.graph!, entities: [{ ...graph.graph!.entities[0], construction: true }] } }, 'extrude', { radius: 5 })).toBe('no-material');
    const open: CadSketchFeature = { ...graph, graph: { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [5, 0] }],
      entities: [{ id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] } };
    expect(cadSketchSourceIssue(open, 'extrude')).toBe('no-material');
  });
  it.each(purposes)('keeps explicit source intent and defaults only when no sketch is selected for %s', purpose => {
    const body: CadFeature = { id: 'body', name: 'Body', kind: 'extrude', suppressed: false, sketchId: material.id, distance: 10, symmetric: false, operation: 'new', targetId: null };
    const second: CadSketchFeature = { ...material, id: 'second' };
    const features: CadFeature[] = [material, second, ...unavailable, body];
    expect(pickCadSketchSource({ features, selectedId: material.id, purpose })?.id).toBe(material.id);
    expect(pickCadSketchSource({ features, selectedId: null, purpose })?.id).toBe(second.id);
    expect(pickCadSketchSource({ features, selectedId: body.id, purpose })?.id).toBe(second.id);
    for (const sketch of unavailable) expect(pickCadSketchSource({ features, selectedId: sketch.id, purpose })).toBeUndefined();
    expect(pickCadSketchSource({ features: unavailable, selectedId: null, purpose })).toBeUndefined();
  });

  it('keeps datum eligibility for signed Distance and Revolve while restricting Through-all to principal sketches', () => {
    expect(cadSketchSourceIssue(datum, 'extrude')).toBeNull(); expect(cadSketchSourceIssue(datum, 'revolve')).toBeNull();
    expect(cadSketchSourceIssue(datum, 'pocket')).toBe('principal-plane-required');
    expect(pickCadSketchSource({ features: [material, datum], selectedId: null, purpose: 'revolve' })).toBe(datum);
    expect(pickCadSketchSource({ features: [material, datum], selectedId: null, purpose: 'pocket' })).toBe(material);
    expect(pickCadSketchSource({ features: [material, datum], selectedId: datum.id, purpose: 'pocket' })).toBeUndefined();
    expect(cadSketchSourceIssueMessage(datum, 'pocket')).toBe('Selected sketch "Material" uses a datum plane. Use Distance or choose an XY, XZ or YZ sketch for Through-all Pocket.');
    expect(cadSketchSourceIssueMessage(datum, 'revolve')).toBeNull();
  });

  it('does not persist missing or later Revolve sources even when the feature is suppressed', () => {
    const revolve: CadFeature = { id: 'revolve', name: 'Revolve', kind: 'revolve', suppressed: true, sketchId: material.id, angle: 180, axis: 'x', operation: 'new', targetId: null };
    const initial = createCadDocument('Source validation');
    expect(() => applyCadEdits(initial, [{ kind: 'add-feature', feature: revolve }])).toThrow(/preceding sketch/);
    expect(() => applyCadEdits(initial, [{ kind: 'add-feature', feature: revolve }, { kind: 'add-feature', feature: material }])).toThrow(/preceding sketch/);
    expect(initial.features).toEqual([]);
    expect(applyCadEdits(initial, [{ kind: 'add-feature', feature: material }, { kind: 'add-feature', feature: revolve }]).features).toEqual([material, revolve]);
  });
});
