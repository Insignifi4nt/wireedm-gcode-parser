import { describe, expect, it } from 'vitest';
import type { CadFeature, CadSketchFeature, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadFeatureWithReference, cadReferenceInput, type CadReferenceCommand, type CadReferenceSelection } from './cadReferenceSelection';

const mount: CadFeature = { kind: 'datum-plane', id: 'mount', name: 'Mount', suppressed: false, definition: { kind: 'world', basePlane: 'XZ', origin: [0, 0, 5], rotation: [0, 15, 0] } };
const profile = { id: 'p', name: 'P', construction: false, geometry: { kind: 'rectangle', x: 20, y: 0, width: 5, height: 5, cornerRadius: 0 } } as const;
const sketchOn = (id: string, plane: CadSketchFeature['plane'], offset = 0): CadSketchFeature => ({ kind: 'sketch', id, name: id, suppressed: false, plane, offset, profiles: [profile] });
const front = sketchOn('front', 'XZ'), raised = sketchOn('raised', 'XY', 4);
const features: readonly CadFeature[] = [mount, front, raised];
const context = { features, parameters: {} };
const plane = (value: CadSketchPlane): CadReferenceSelection => ({ kind: 'plane', plane: value });
const axis = (value: 'x' | 'y' | 'z'): CadReferenceSelection => ({ kind: 'axis', axis: value });
const datum = { kind: 'datum-plane', featureId: 'mount' } as const;

describe('selection to command mapping', () => {
  it('gives sketches, curves and sections any origin or active datum plane', () => {
    for (const command of ['sketch', 'curve', 'section'] satisfies CadReferenceCommand[]) {
      expect(cadReferenceInput(plane('YZ'), command, context)).toEqual({ kind: 'plane', plane: 'YZ' });
      expect(cadReferenceInput(plane(datum), command, context)).toEqual({ kind: 'plane', plane: datum });
    }
  });

  it('starts a datum plane on the selected plane: an origin plane as its base, a datum plane at its own placement', () => {
    expect(cadReferenceInput(plane('XZ'), 'datum-plane', context)).toEqual({ kind: 'datum-definition', definition: { kind: 'world', basePlane: 'XZ', origin: [0, 0, 0], rotation: [0, 0, 0] } });
    expect(cadReferenceInput(plane(datum), 'datum-plane', context)).toEqual({ kind: 'datum-definition', definition: mount.kind === 'datum-plane' ? mount.definition : null });
  });

  it('mirrors about an origin plane and explains why a datum plane cannot be used yet', () => {
    expect(cadReferenceInput(plane('XY'), 'mirror', context)).toEqual({ kind: 'mirror-plane', plane: 'XY' });
    expect(cadReferenceInput(plane(datum), 'mirror', context)).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('"Mount"') });
  });

  it('patterns about any origin axis through the origin', () => {
    for (const name of ['x', 'y', 'z'] as const) expect(cadReferenceInput(axis(name), 'circular-pattern', context)).toEqual({ kind: 'pattern-axis', axis: name, center: [0, 0, 0] });
  });

  it('revolves about an origin axis only when it is one of the sketch’s own axes', () => {
    // On XZ the sketch X axis is world X and its Y axis is world Z.
    expect(cadReferenceInput(axis('x'), 'revolve', { ...context, sketch: front })).toEqual({ kind: 'revolve-axis', axis: 'x' });
    expect(cadReferenceInput(axis('z'), 'revolve', { ...context, sketch: front })).toEqual({ kind: 'revolve-axis', axis: 'y' });
    expect(cadReferenceInput(axis('y'), 'revolve', { ...context, sketch: front })).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('the Y axis') });
    // A sketch lifted off the origin has its own axes beside the world ones, not on them.
    expect(cadReferenceInput(axis('x'), 'revolve', { ...context, sketch: raised })).toMatchObject({ kind: 'unavailable' });
    expect(cadReferenceInput(axis('x'), 'revolve', context)).toEqual({ kind: 'none' });
  });

  it('leaves commands a selection does not feed as they start, and refuses a datum plane that is gone', () => {
    expect(cadReferenceInput(null, 'mirror', context)).toEqual({ kind: 'none' });
    expect(cadReferenceInput({ kind: 'point' }, 'circular-pattern', context)).toEqual({ kind: 'none' });
    expect(cadReferenceInput(plane('XY'), 'revolve', context)).toEqual({ kind: 'none' });
    expect(cadReferenceInput(axis('x'), 'sketch', context)).toEqual({ kind: 'none' });
    for (const gone of [[], [{ ...mount, suppressed: true }]]) {
      expect(cadReferenceInput(plane(datum), 'section', { features: gone, parameters: {} })).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('missing or suppressed') });
    }
  });
});

describe('a new feature from the selection', () => {
  const pattern: CadFeature = { kind: 'circular-pattern', id: 'cp', name: 'Pattern', suppressed: false, sourceId: 'body', count: 4, axis: 'z', center: [1, 2, 3], angle: 360 };
  const revolve: CadFeature = { kind: 'revolve', id: 'rv', name: 'Revolve', suppressed: false, sketchId: 'front', angle: 360, axis: 'y', operation: 'new', targetId: null };
  const mirror: CadFeature = { kind: 'mirror', id: 'mr', name: 'Mirror', suppressed: false, sourceId: 'body', plane: 'YZ' };

  it('takes the selected reference into the field it feeds and keeps every other field', () => {
    expect(cadFeatureWithReference(pattern, axis('x'), context)).toEqual({ ...pattern, axis: 'x', center: [0, 0, 0] });
    expect(cadFeatureWithReference(revolve, axis('x'), context)).toEqual({ ...revolve, axis: 'x' });
    expect(cadFeatureWithReference(mirror, plane('XZ'), context)).toEqual({ ...mirror, plane: 'XZ' });
    expect(cadFeatureWithReference({ kind: 'curve', id: 'c', name: 'C', suppressed: false, plane: 'XY', offset: 0, segments: [] }, plane(datum), context)).toMatchObject({ plane: datum });
  });

  it('throws the reason instead of starting on a default the user did not choose, and leaves other drafts alone', () => {
    expect(() => cadFeatureWithReference(revolve, axis('y'), context)).toThrow(/not one of them/);
    expect(() => cadFeatureWithReference(mirror, plane(datum), context)).toThrow(/cannot mirror about "Mount" yet/);
    expect(cadFeatureWithReference(pattern, null, context)).toBe(pattern);
    expect(cadFeatureWithReference(mirror, axis('x'), context)).toBe(mirror);
    const pad: CadFeature = { kind: 'extrude', id: 'e', name: 'Pad', suppressed: false, sketchId: 'front', distance: 5, symmetric: false, operation: 'new', targetId: null };
    expect(cadFeatureWithReference(pad, plane('XY'), context)).toBe(pad);
  });
});
