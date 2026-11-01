import { describe, expect, it } from 'vitest';
import type { CadFeature, CadSketchFeature, CadSketchPlane } from '@/domain/cad/cadDocument';
import { cadFeatureWithReference, cadReferenceInput, cadSameLine, type CadReferenceCommand, type CadReferenceSelection } from './cadReferenceSelection';

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

  it('refuses a sketch axis a hair off the origin axis in angle or position, at native placement precision', () => {
    const on = (id: string, definition: Extract<CadFeature, { kind: 'datum-plane' }>['definition'], offset = 0) => {
      const placed: CadFeature = { kind: 'datum-plane', id, name: id, suppressed: false, definition };
      const sketch = sketchOn(`${id}-sketch`, { kind: 'datum-plane', featureId: id }, offset);
      return (name: 'x' | 'y' | 'z') => cadReferenceInput(axis(name), 'revolve', { features: [placed, sketch], parameters: {}, sketch });
    };
    // Turned 0.002° about Z: at 100 mm its X axis is 0.0035 mm from world X, so it is another line.
    expect(on('tilted', { kind: 'world', basePlane: 'XZ', origin: [0, 0, 0], rotation: [0, 0, 0.002] })('x')).toMatchObject({ kind: 'unavailable', reason: expect.stringContaining('the X axis') });
    // Far out along X, 0.005 mm off the axis: a scale-relative tolerance would have taken it.
    expect(on('far', { kind: 'world', basePlane: 'XZ', origin: [6000000, 0.005, 0], rotation: [0, 0, 0] })('x')).toMatchObject({ kind: 'unavailable' });
    expect(on('offset', { kind: 'world', basePlane: 'XZ', origin: [0, 0, 0], rotation: [0, 0, 0] }, 1e-6)('x')).toMatchObject({ kind: 'unavailable' });
    // The same far line exactly, a quarter turn that lays the sketch X axis on world Y, and a turn that is not a quarter but keeps X.
    expect(on('far-on', { kind: 'world', basePlane: 'XZ', origin: [6000000, 0, 0], rotation: [0, 0, 0] })('x')).toEqual({ kind: 'revolve-axis', axis: 'x' });
    expect(on('quarter', { kind: 'world', basePlane: 'XZ', origin: [0, 0, 0], rotation: [0, 0, 90] })('y')).toEqual({ kind: 'revolve-axis', axis: 'x' });
    expect(on('rolled', { kind: 'world', basePlane: 'XZ', origin: [0, 0, 0], rotation: [30, 0, 0] })('x')).toEqual({ kind: 'revolve-axis', axis: 'x' });
  });

  it('compares lines by direction either way round and by perpendicular distance, counting the angle over the distance between them', () => {
    const line = (point: readonly number[], direction: readonly number[], angularUncertainty = 0) => ({ point, direction, angularUncertainty });
    expect(cadSameLine(line([0, 0, 0], [1, 0, 0]), line([-25, 0, 0], [-1, 0, 0]))).toBe(true);
    expect(cadSameLine(line([0, 0, 0], [1, 0, 0]), line([0, 5e-8, 0], [1, 0, 0]))).toBe(true);
    expect(cadSameLine(line([0, 0, 0], [1, 0, 0]), line([0, 2e-7, 0], [1, 0, 0]))).toBe(false);
    const tilt = 1e-13;
    expect(cadSameLine(line([0, 0, 0], [1, 0, 0]), line([0, 0, 0], [Math.cos(tilt), Math.sin(tilt), 0], 1e-12))).toBe(true);
    // The same small angle within the frames' uncertainty still separates the lines too far 10 km away.
    expect(cadSameLine(line([0, 0, 0], [1, 0, 0]), line([1e7, 0, 0], [Math.cos(tilt), Math.sin(tilt), 0], 1e-12))).toBe(false);
    expect(cadSameLine(line([0, 0, 0], [1, 0, 0]), line([0, 0, 0], [Math.cos(tilt), Math.sin(tilt), 0]))).toBe(false);
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
