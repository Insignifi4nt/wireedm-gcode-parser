import { expect, it } from 'vitest';
import type { CadDocument, CadFeature, CadPlane } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { inspectCadExtrudeDepth } from './cadExtrudeDepthInteraction';

function part(plane: CadPlane = 'XY', distance: number | string = ' depth ', symmetric = false): CadDocument {
  return { ...createCadDocument('Depth interaction', 'depth_interaction'), parameters: { depth: 20 }, features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane, offset: 5, profiles: [
      { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance, symmetric, operation: 'new', targetId: null }
  ] };
}
const normals = { XY: [0, 0, 1], XZ: [0, -1, 0], YZ: [1, 0, 0] } as const;
const scaled = (normal: readonly number[], value: number) => normal.map(component => component * value || 0);

it.each(['XY', 'XZ', 'YZ'] as const)('places signed and symmetric depth endpoints on the actual %s normal', plane => {
  for (const distance of [20, -20]) for (const symmetric of [false, true]) {
    const document = part(plane, distance, symmetric), source = JSON.stringify(document);
    const model = inspectCadExtrudeDepth(document, document.features[1]);
    expect(model).toMatchObject({ quantityMm: distance, symmetric, capability: { kind: 'editable' } });
    expect(model?.normalWorld).toEqual(normals[plane]);
    expect(model?.originMm).toEqual(scaled(normals[plane], 5));
    expect(model?.startMm).toEqual(scaled(normals[plane], 5 - (symmetric ? distance / 2 : 0)));
    expect(model?.endMm).toEqual(scaled(normals[plane], 5 + (symmetric ? distance / 2 : distance)));
    expect(JSON.stringify(document)).toBe(source);
  }
});

it('resolves actual coupled offset geometry while explicitly locking named-depth dragging', () => {
  const document = part(), sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch');
  const coupled = { ...document, features: [{ ...sketch, offset: 'depth' }, document.features[1]] };
  const model = inspectCadExtrudeDepth(coupled, coupled.features[1]);
  expect(model?.capability).toMatchObject({ kind: 'locked', reason: expect.stringContaining('depth') });
  expect(model?.originMm).toEqual([0, 0, 20]); expect(model?.endMm).toEqual([0, 0, 40]);
  const changed = { ...coupled, parameters: { depth: 30 } };
  expect(inspectCadExtrudeDepth(changed, changed.features[1])?.endMm).toEqual([0, 0, 60]);
  const pad = coupled.features[1]; if (pad.kind !== 'extrude') throw new Error('Expected Pad');
  expect(inspectCadExtrudeDepth(coupled, { ...pad, distance: 20 })?.capability).toEqual({ kind: 'editable' });
});

it.each(['origin', 'rotation'] as const)('resolves a driver-coupled datum %s without using a frozen principal plane', field => {
  const document = part(), sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch');
  const datum = { id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY',
    origin: field === 'origin' ? ['depth', 2, 3] : [1, 2, 3], rotation: field === 'rotation' ? [0, 'depth', 0] : [0, 90, 0] } } satisfies CadFeature;
  const candidate = { ...document, parameters: { depth: 90 }, features: [datum, { ...sketch, offset: 5, plane: { kind: 'datum-plane', featureId: 'datum' } }, document.features[1]] } satisfies CadDocument;
  const model = inspectCadExtrudeDepth(candidate, candidate.features[2]);
  expect(model?.capability).toMatchObject({ kind: 'locked', reason: expect.stringContaining('depth') });
  expect(model?.normalWorld).toEqual([1, 0, 0]);
  expect(model?.originMm).toEqual(field === 'origin' ? [95, 2, 3] : [6, 2, 3]);
  expect(model?.endMm).toEqual(field === 'origin' ? [185, 2, 3] : [96, 2, 3]);
});

it('retains a far static oblique datum and negative symmetric depth without locking an independent named driver', () => {
  const document = part('XY', ' depth ', true), sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch');
  const datum = { id: 'datum', name: 'Oblique datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY',
    origin: [500_000, -500_000, 100], rotation: [0, 17, 23] } } satisfies CadFeature;
  const candidate = { ...document, parameters: { depth: -6 }, features: [datum, { ...sketch, plane: { kind: 'datum-plane', featureId: 'datum' } }, document.features[1]] } satisfies CadDocument;
  const source = JSON.stringify(candidate), model = inspectCadExtrudeDepth(candidate, candidate.features[2]);
  const y = 17 * Math.PI / 180, z = 23 * Math.PI / 180;
  const normal = [Math.sin(y) * Math.cos(z), Math.sin(y) * Math.sin(z), Math.cos(y)];
  expect(model?.capability).toEqual({ kind: 'editable' }); expect(model?.binding).toMatchObject({ kind: 'parameter', name: 'depth', quantity: -6 });
  for (let axis = 0; axis < 3; axis++) {
    expect(model?.normalWorld[axis]).toBeCloseTo(normal[axis], 14);
    expect(model?.startMm[axis]).toBeCloseTo(datum.definition.origin[axis] + normal[axis] * 8, 9);
    expect(model?.endMm[axis]).toBeCloseTo(datum.definition.origin[axis] + normal[axis] * 2, 9);
  }
  expect(JSON.stringify(candidate)).toBe(source);
});

it('keeps a compound depth read-only and excludes Through-all rather than inventing a distance', () => {
  const document = part('XY', 'depth / 2'), model = inspectCadExtrudeDepth(document, document.features[1]);
  expect(model?.quantityMm).toBe(10); expect(model?.capability).toMatchObject({ kind: 'locked', reason: expect.stringContaining('formula') });
  const pocket = { id: 'pocket', name: 'Pocket', kind: 'pocket', suppressed: false, sketchId: 'sketch', targetId: 'pad', extent: { kind: 'through-all', direction: 'both' } } satisfies CadFeature;
  expect(inspectCadExtrudeDepth(document, pocket)).toBeNull();
});

it('does not offer a depth gesture for an unavailable source or zero current distance', () => {
  const document = part(), pad = document.features[1]; if (pad.kind !== 'extrude') throw new Error('Expected Pad');
  expect(inspectCadExtrudeDepth(document, { ...pad, sketchId: 'missing' })).toBeNull();
  expect(inspectCadExtrudeDepth(document, { ...pad, distance: 0 })?.capability.kind).toBe('locked');
});

it('anchors only the selected material and reuses its exact bounds through unrelated depth changes', () => {
  const document = part(), sketch = document.features[0], pad = document.features[1];
  if (sketch.kind !== 'sketch' || pad.kind !== 'extrude') throw new Error('Expected source and Pad');
  const source = { ...sketch, profiles: [...sketch.profiles, { id: 'remote', name: 'Remote', construction: false,
    geometry: { kind: 'rectangle', x: 30, y: 10, width: 20, height: 10, cornerRadius: 0 } }] } satisfies typeof sketch;
  const selected = { ...pad, regionSelection: [{ boundaryProfileId: 'remote', voidProfileIds: [], ancestorProfileIds: [] }] };
  // Reuse belongs to the detached immutable source actually supplied by a session.
  const candidate = parseCadDocument({ ...document, features: [source, selected] }), saved = JSON.stringify(candidate);
  const model = inspectCadExtrudeDepth(candidate, selected);
  expect(model?.materialBoundsMm).toEqual({ minX: 30, minY: 10, maxX: 50, maxY: 20 });
  expect(inspectCadExtrudeDepth({ ...candidate, parameters: { depth: 30, other: 5 } }, selected)?.materialBoundsMm).toBe(model?.materialBoundsMm);
  expect(inspectCadExtrudeDepth(candidate, { ...selected, regionSelection: undefined })?.materialBoundsMm).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 20 });
  expect(JSON.stringify(candidate)).toBe(saved);
});

it('updates material bounds for a source parameter relation and still rejects stale selected topology', () => {
  const document = part(), sketch = document.features[0], pad = document.features[1];
  if (sketch.kind !== 'sketch' || pad.kind !== 'extrude') throw new Error('Expected source and Pad');
  const source = { ...sketch, profiles: [{ ...sketch.profiles[0], geometry: { kind: 'rectangle', x: 30, y: 10, width: 'depth', height: 10, cornerRadius: 0 } }] } satisfies typeof sketch;
  const candidate = { ...document, features: [source, pad] };
  expect(inspectCadExtrudeDepth(candidate, pad)?.materialBoundsMm).toEqual({ minX: 30, minY: 10, maxX: 50, maxY: 20 });
  expect(inspectCadExtrudeDepth({ ...candidate, parameters: { depth: 30 } }, pad)?.materialBoundsMm).toEqual({ minX: 30, minY: 10, maxX: 60, maxY: 20 });
  expect(() => inspectCadExtrudeDepth(candidate, { ...pad, regionSelection: [{ boundaryProfileId: 'rectangle', voidProfileIds: ['missing'], ancestorProfileIds: [] }] })).toThrow(/changed/);
});
