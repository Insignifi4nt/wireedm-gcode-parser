import { describe, expect, it } from 'vitest';
import type { CadProfile, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';
import { inspectCadSketchHandles, moveCadSketchHandle } from '../cadSketchHandles';
import { cadAnalyticSegments, cadPathClosureTolerance, resolveCadPathSegments } from '../cadAnalyticSegments';

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

  it.each([90, -90, 270, -270])('refits a %s degree arc joint through its original midpoint without changing traversal or branch', sweep => {
    const endY = sweep === 90 || sweep === -270 ? 5 : -5;
    const path = profile({ kind: 'path', segments: [
      { kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep },
      { kind: 'line', start: [0, endY], end: [5, 0] }
    ] });
    const original = structuredClone(path);
    expect(inspectCadSketchHandles(path, {})[0].draggable).toBe(true);
    const moved = moveCadSketchHandle({ profile: path, handle: { kind: 'vertex', index: 0 }, translation: [1, 1], parameters: {} });
    if (moved.geometry.kind !== 'path') throw new Error('Path primitive was replaced.');
    const [arc, line] = cadAnalyticSegments(resolveCadPathSegments(moved.geometry.segments, {})).segments;
    if (arc.kind !== 'arc' || line.kind !== 'line') throw new Error('Analytic segment kinds changed.');
    const middleX = Math.abs(sweep) === 270 ? -Math.SQRT1_2 * 5 : Math.SQRT1_2 * 5;
    const middleY = Math.sign(sweep) * Math.SQRT1_2 * 5;
    expect(Math.hypot(middleX - arc.center.x, middleY - arc.center.y)).toBeCloseTo(arc.radius, 12);
    expect(Math.sign(arc.sweepRadians)).toBe(Math.sign(sweep));
    expect(Math.abs(arc.sweepRadians) > Math.PI).toBe(Math.abs(sweep) > 180);
    expect(arc.start.x).toBeCloseTo(6, 12); expect(arc.start.y).toBeCloseTo(1, 12);
    expect(arc.end.x).toBeCloseTo(0, 12); expect(arc.end.y).toBeCloseTo(endY, 12);
    expect(line.end).toEqual({ x: 6, y: 1 }); expect(line.start).toEqual({ x: 0, y: endY });
    expect(path).toEqual(original);
  });

  it('keeps both adjacent arcs analytically closed and rejects a degenerate refit atomically', () => {
    const path = profile({ kind: 'path', segments: [
      { kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep: 180 },
      { kind: 'arc', center: [0, 0], radius: 5, startAngle: 180, sweep: 180 }
    ] });
    const sketch = { id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [path] } satisfies CadSketchFeature;
    const document = parseCadDocument({ ...createCadDocument('Part', 'part'), features: [sketch] });
    const edit = { kind: 'move-sketch-handle', sketchId: 'sketch', profileId: 'outline', handle: { kind: 'vertex', index: 0 }, translation: [1, 0] } as const;
    const moved = applyCadEdits(document, [edit]).features[0];
    if (moved.kind !== 'sketch' || moved.profiles[0].geometry.kind !== 'path') throw new Error('Path missing.');
    const [first, last] = cadAnalyticSegments(resolveCadPathSegments(moved.profiles[0].geometry.segments, {})).segments;
    const tolerance = cadPathClosureTolerance([first.start, first.end, last.start, last.end]);
    expect(Math.hypot(first.start.x - last.end.x, first.start.y - last.end.y)).toBeLessThanOrEqual(tolerance);
    expect(Math.hypot(first.end.x - last.start.x, first.end.y - last.start.y)).toBeLessThanOrEqual(tolerance);
    expect(first.start.x).toBeCloseTo(6, 12); expect(first.end.x).toBeCloseTo(-5, 12);
    expect(() => applyCadEdits(document, [{ kind: 'rename-document', name: 'Changed' }, { ...edit, translation: [-5, 5] }])).toThrow();
    expect(() => applyCadEdits(document, [{ ...edit, translation: [-11, 6] }])).toThrow('branch');
    expect(document.name).toBe('Part'); expect(document.features[0]).toEqual(sketch);
  });

  it('reports expression-driven arc refits as unavailable and preserves the exact driver scalars', () => {
    const path = profile({ kind: 'path', segments: [
      { kind: 'arc', center: ['origin', 0], radius: 5, startAngle: 0, sweep: 180 },
      { kind: 'line', start: [-5, 0], end: [5, 0] }
    ] });
    const parameters = { origin: 0 }, original = structuredClone(path);
    expect(inspectCadSketchHandles(path, parameters)).toEqual(expect.arrayContaining([
      expect.objectContaining({ draggable: false, unavailableReason: expect.stringContaining('expression') })
    ]));
    expect(() => moveCadSketchHandle({ profile: path, handle: { kind: 'vertex', index: 0 }, translation: [1, 1], parameters })).toThrow('expression');
    expect(path).toEqual(original);
  });

  it.each([360, -360])('edits a full-circle path with center/radius grips while retaining its %s degree phase and traversal', sweep => {
    const path = profile({ kind: 'path', segments: [{ kind: 'arc', center: ['origin', 2], radius: 5, startAngle: 'phase', sweep: 'turn' }] });
    const parameters = { origin: 1, phase: 725, turn: sweep };
    const handles = inspectCadSketchHandles(path, parameters);
    expect(handles.map(item => item.handle)).toEqual([{ kind: 'center' }, { kind: 'radius' }]);
    const centered = moveCadSketchHandle({ profile: path, handle: { kind: 'center' }, translation: [4, 3], parameters });
    expect(centered.geometry).toEqual({ kind: 'path', segments: [{ kind: 'arc', center: ['origin', 5], radius: 5, startAngle: 'phase', sweep: 'turn' }] });
    const resized = moveCadSketchHandle({ profile: centered, handle: { kind: 'radius' }, translation: [3, 0], parameters });
    expect(resized.geometry).toEqual({ kind: 'path', segments: [{ kind: 'arc', center: ['origin', 5], radius: 8, startAngle: 'phase', sweep: 'turn' }] });
    expect(() => moveCadSketchHandle({ profile: path, handle: { kind: 'vertex', index: 0 }, translation: [1, 0], parameters })).toThrow();
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

  it('edits slot length, width and angle in the rotated local frame while keeping center and other scalars intact', () => {
    const slot = profile({ kind: 'slot', x: 'origin', y: 2, length: 20, width: '4', angle: 90 }), parameters = { origin: 3 };
    const handles = inspectCadSketchHandles(slot, parameters);
    expect(handles.map(item => item.handle.kind)).toEqual(['center', 'slot-length', 'slot-width', 'slot-angle']);
    expect(handles[1].point[0]).toBeCloseTo(3, 12); expect(handles[1].point[1]).toBeCloseTo(12, 12);
    expect(handles[2].point[0]).toBeCloseTo(1, 12); expect(handles[2].point[1]).toBeCloseTo(2, 12);
    expect(moveCadSketchHandle({ profile: slot, handle: { kind: 'slot-length' }, translation: [0, 3], parameters }).geometry)
      .toEqual({ ...slot.geometry, length: 26 });
    expect(moveCadSketchHandle({ profile: slot, handle: { kind: 'slot-width' }, translation: [-1, 0], parameters }).geometry)
      .toEqual({ ...slot.geometry, width: 6 });
    const rotated = moveCadSketchHandle({ profile: slot, handle: { kind: 'slot-angle' }, translation: [-14, -14], parameters });
    expect(rotated.geometry).toEqual({ ...slot.geometry, angle: 180 });
    expect(slot.geometry).toEqual({ kind: 'slot', x: 'origin', y: 2, length: 20, width: '4', angle: 90 });
  });

  it('keeps slot dimensions and expressions authoritative while center movement stays independent', () => {
    const slot = { ...profile({ kind: 'slot', x: 0, y: 'origin', length: 'span', width: 4, angle: 37 }), constraints: [
      { id: 'width', kind: 'dimension', quantity: 'width' }, { id: 'angle', kind: 'dimension', quantity: 'angle' }
    ] } satisfies CadSketchProfile;
    const parameters = { origin: 2, span: 20 };
    expect(inspectCadSketchHandles(slot, parameters).slice(1).map(item => item.draggable)).toEqual([false, false, false]);
    for (const kind of ['slot-length', 'slot-width', 'slot-angle'] as const) {
      expect(moveCadSketchHandle({ profile: slot, handle: { kind }, translation: [2, 3], parameters })).toBe(slot);
    }
    expect(moveCadSketchHandle({ profile: slot, handle: { kind: 'center' }, translation: [2, 3], parameters }).geometry)
      .toEqual({ ...slot.geometry, x: 2 });
  });

  it('rejects slot size inversion and undefined angle targets without accepting a partial edit batch', () => {
    const slot = profile({ kind: 'slot', x: 0, y: 0, length: 20, width: 4, angle: 0 });
    const sketch = { id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [slot] } satisfies CadSketchFeature;
    const document = parseCadDocument({ ...createCadDocument('Part', 'part'), features: [sketch] });
    const edit = { kind: 'move-sketch-handle', sketchId: 'sketch', profileId: 'outline', handle: { kind: 'slot-width' }, translation: [0, 9] } as const;
    expect(() => applyCadEdits(document, [{ kind: 'rename-document', name: 'Changed' }, edit])).toThrow();
    expect(() => moveCadSketchHandle({ profile: slot, handle: { kind: 'slot-length' }, translation: [-9, 0], parameters: {} })).toThrow();
    expect(() => moveCadSketchHandle({ profile: slot, handle: { kind: 'slot-angle' }, translation: [-14, 0], parameters: {} })).toThrow();
    expect(document.name).toBe('Part'); expect(document.features[0]).toEqual(sketch);
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
