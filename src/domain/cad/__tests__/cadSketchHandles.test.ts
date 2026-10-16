import { describe, expect, it } from 'vitest';
import type { CadProfile, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { inspectCadSketchHandles, moveCadSketchHandle } from '../cadSketchHandles';

const profile = (geometry: CadProfile): CadSketchProfile => ({ id: 'outline', name: 'Outline', construction: false, geometry });
const polygon = profile({ kind: 'polygon', points: [[0, 0], [20, 0], [20, 10], [0, 10]] });
const rectangle = profile({ kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 });

describe('revision-scoped sketch handles', () => {
  it('moves one polygon vertex without translating the closed contour or mutating the source', () => {
    const moved = moveCadSketchHandle({ profile: polygon, handle: { kind: 'vertex', index: 1 }, translation: [5, -3], parameters: {} });
    expect(moved.geometry).toEqual({ kind: 'polygon', points: [[0, 0], [25, -3], [20, 10], [0, 10]] });
    expect(polygon.geometry).toEqual({ kind: 'polygon', points: [[0, 0], [20, 0], [20, 10], [0, 10]] });
  });

  it('moves a shared path joint atomically, preserving the other endpoints', () => {
    const path = profile({ kind: 'path', segments: [
      { kind: 'line', start: [0, 0], end: [20, 0] },
      { kind: 'line', start: [20, 0], end: [0, 10] },
      { kind: 'line', start: [0, 10], end: [0, 0] }
    ] });
    expect(moveCadSketchHandle({ profile: path, handle: { kind: 'vertex', index: 1 }, translation: [5, -3], parameters: {} }).geometry).toEqual({ kind: 'path', segments: [
      { kind: 'line', start: [0, 0], end: [25, -3] },
      { kind: 'line', start: [25, -3], end: [0, 10] },
      { kind: 'line', start: [0, 10], end: [0, 0] }
    ] });
  });

  it('stretches a rectangle corner with its opposite corner anchored', () => {
    expect(moveCadSketchHandle({ profile: rectangle, handle: { kind: 'rectangle-corner', index: 0 }, translation: [-4, -2], parameters: {} }).geometry)
      .toEqual({ ...rectangle.geometry, x: -4, y: -2, width: 24, height: 12 });
  });

  it('projects a corner drag onto its free components instead of changing driven width or position', () => {
    const constrained = { ...rectangle, constraints: [{ id: 'w', kind: 'dimension', quantity: 'width' }] } satisfies CadSketchProfile;
    expect(moveCadSketchHandle({ profile: constrained, handle: { kind: 'rectangle-corner', index: 2 }, translation: [5, 3], parameters: {} }).geometry)
      .toEqual({ ...rectangle.geometry, height: 13 });
    const linked = profile({ kind: 'rectangle', x: 'origin', y: 0, width: 20, height: 10, cornerRadius: 0 });
    expect(moveCadSketchHandle({ profile: linked, handle: { kind: 'rectangle-corner', index: 0 }, translation: [5, 3], parameters: { origin: 0 } }).geometry)
      .toEqual({ ...linked.geometry, y: 3, height: 7 });
  });

  it('moves a circle center independently of its dimensioned radius and resizes a free radius', () => {
    const circle = profile({ kind: 'circle', x: 0, y: 0, radius: 5 });
    expect(moveCadSketchHandle({ profile: circle, handle: { kind: 'center' }, translation: [2, 3], parameters: {} }).geometry)
      .toEqual({ kind: 'circle', x: 2, y: 3, radius: 5 });
    expect(moveCadSketchHandle({ profile: circle, handle: { kind: 'radius' }, translation: [3, 0], parameters: {} }).geometry)
      .toEqual({ kind: 'circle', x: 0, y: 0, radius: 8 });
    const fixed = { ...circle, constraints: [{ id: 'diameter', kind: 'dimension', quantity: 'diameter' }] } satisfies CadSketchProfile;
    expect(inspectCadSketchHandles(fixed, {}).find(item => item.handle.kind === 'radius')).toMatchObject({ draggable: false });
    expect(moveCadSketchHandle({ profile: fixed, handle: { kind: 'radius' }, translation: [3, 0], parameters: {} })).toEqual(fixed);
  });

  it('keeps coordinate expressions intact while moving the free axis of a polygon point', () => {
    const driven = profile({ kind: 'polygon', points: [[0, 0], ['width', 0], [0, 10]] });
    expect(moveCadSketchHandle({ profile: driven, handle: { kind: 'vertex', index: 1 }, translation: [5, -3], parameters: { width: 20 } }).geometry)
      .toEqual({ kind: 'polygon', points: [[0, 0], ['width', -3], [0, 10]] });
  });

  it('validates geometry at the shared edit boundary and rolls back a degenerate batch', () => {
    const sketch = { id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [polygon] } satisfies CadSketchFeature;
    const document = parseCadDocument({ ...createCadDocument('Part', 'part'), features: [sketch] });
    const move = { kind: 'move-sketch-handle', sketchId: 'sketch', profileId: 'outline', handle: { kind: 'vertex', index: 1 }, translation: [5, -3] } as const;
    const moved = applyCadEdits(document, [move]);
    expect(moved.features[0]).toMatchObject({ profiles: [{ geometry: { points: [[0, 0], [25, -3], [20, 10], [0, 10]] } }] });
    expect(() => applyCadEdits(document, [{ kind: 'rename-document', name: 'Changed' }, { ...move, translation: [-20, 0] }])).toThrow();
    expect(document.name).toBe('Part'); expect(document.features[0]).toEqual(sketch);
  });

  it('rejects missing or incompatible handles rather than targeting a different entity', () => {
    expect(() => moveCadSketchHandle({ profile: polygon, handle: { kind: 'vertex', index: 99 }, translation: [1, 0], parameters: {} })).toThrow();
    expect(() => moveCadSketchHandle({ profile: polygon, handle: { kind: 'radius' }, translation: [1, 0], parameters: {} })).toThrow();
    expect(() => moveCadSketchHandle({ profile: rectangle, handle: { kind: 'rectangle-corner', index: 2 }, translation: [-30, 0], parameters: {} })).toThrow();
  });
});
