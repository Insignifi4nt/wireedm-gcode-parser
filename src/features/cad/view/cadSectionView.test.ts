import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { cadPrincipalFrame } from '@/domain/cad/cadDatumPlanes';
import { cadBoundsClipped, cadClipRaycaster, cadSectionClipPlane, cadSectionPlaneAvailable, resolveCadSectionFrame, sameCadSectionFrame } from './cadSectionView';

const mount: CadFeature = { kind: 'datum-plane', id: 'mount', name: 'Mount', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 'lift'], rotation: [0, 0, 0] } };
const kept = (plane: THREE.Plane, point: readonly [number, number, number]) => plane.distanceToPoint(new THREE.Vector3(...point)) >= 0;

describe('section clip sense', () => {
  it.each(['XY', 'XZ', 'YZ'] as const)('removes the side the %s normal points to, and keeps it when flipped', name => {
    const frame = cadPrincipalFrame(name), ahead = frame.normal.map(value => value * 5) as [number, number, number];
    const behind = frame.normal.map(value => value * -5) as [number, number, number];
    const plain = cadSectionClipPlane(frame, false), flipped = cadSectionClipPlane(frame, true);
    expect([kept(plain, ahead), kept(plain, behind)]).toEqual([false, true]);
    expect([kept(flipped, ahead), kept(flipped, behind)]).toEqual([true, false]);
  });

  it('cuts through the plane’s own origin and keeps faces lying on the plane within the tolerance', () => {
    const frame = { ...cadPrincipalFrame('XY'), origin: [0, 0, 3] as const };
    const plane = cadSectionClipPlane(frame, false, 1e-4);
    expect(kept(plane, [0, 0, 2.9])).toBe(true); expect(kept(plane, [0, 0, 3])).toBe(true); expect(kept(plane, [0, 0, 3.1])).toBe(false);
    expect(kept(cadSectionClipPlane(frame, true, 1e-4), [0, 0, 3])).toBe(true);
  });
});

describe('the pick filter through a section', () => {
  const ray = (origin: [number, number, number], direction: [number, number, number]) => {
    const caster = new THREE.Raycaster(); caster.ray.set(new THREE.Vector3(...origin), new THREE.Vector3(...direction).normalize()); return caster;
  };
  const slab = (z: number) => { const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.position.z = z; mesh.updateMatrixWorld(); return mesh; };
  const removeAbove = cadSectionClipPlane({ ...cadPrincipalFrame('XY'), origin: [0, 0, 4] }, false);
  const removeBelow = cadSectionClipPlane({ ...cadPrincipalFrame('XY'), origin: [0, 0, 4] }, true);
  const hits = (caster: THREE.Raycaster) => [...new Set(caster.intersectObjects([slab(8), slab(1)]).map(hit => hit.object.position.z))];

  it('limits the ray to the kept side, from either side of the plane', () => {
    expect(hits(cadClipRaycaster(ray([0, 0, 20], [0, 0, -1]), null))).toEqual([8, 1]);
    expect(hits(cadClipRaycaster(ray([0, 0, 20], [0, 0, -1]), removeAbove))).toEqual([1]);
    expect(hits(cadClipRaycaster(ray([0, 0, 20], [0, 0, -1]), removeBelow))).toEqual([8]);
    expect(hits(cadClipRaycaster(ray([0, 0, -20], [0, 0, 1]), removeAbove))).toEqual([1]);
    expect(hits(cadClipRaycaster(ray([0, 0, -20], [0, 0, 1]), removeBelow))).toEqual([8]);
  });

  it('keeps or removes a ray parallel to the plane whole, and frees the ray when the section is off', () => {
    const along = (z: number) => ray([-20, 0, z], [1, 0, 0]);
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    wall.rotation.y = Math.PI / 2; wall.updateMatrixWorld();
    expect(cadClipRaycaster(along(2), removeAbove).intersectObject(wall)).toHaveLength(1);
    const hidden = cadClipRaycaster(along(4.5), removeAbove);
    expect(hidden.intersectObject(wall)).toHaveLength(0);
    expect(cadClipRaycaster(hidden, null).intersectObject(wall)).toHaveLength(1);
  });

  it('knows a box the section removes entirely', () => {
    expect(cadBoundsClipped({ min: [0, 0, 5], max: [1, 1, 6] }, removeAbove)).toBe(true);
    expect(cadBoundsClipped({ min: [0, 0, 3], max: [1, 1, 6] }, removeAbove)).toBe(false);
    expect(cadBoundsClipped({ min: [0, 0, 5], max: [1, 1, 6] }, null)).toBe(false);
  });
});

describe('section plane lifecycle', () => {
  it('follows a datum plane while it is active and lets the view turn off once it is suppressed or deleted', () => {
    const plane = { kind: 'datum-plane', featureId: 'mount' } as const;
    expect(cadSectionPlaneAvailable('XZ', [])).toBe(true);
    expect(cadSectionPlaneAvailable(plane, [mount])).toBe(true);
    expect(cadSectionPlaneAvailable(plane, [{ ...mount, suppressed: true }])).toBe(false);
    expect(cadSectionPlaneAvailable(plane, [])).toBe(false);
    expect(resolveCadSectionFrame(plane, [mount], { lift: 7 })?.origin).toEqual([0, 0, 7]);
    expect(resolveCadSectionFrame(plane, [{ ...mount, suppressed: true }], { lift: 7 })).toBeNull();
    // A datum whose expression no longer resolves leaves nothing to cut by, rather than throwing out of the view.
    expect(resolveCadSectionFrame(plane, [mount], {})).toBeNull();
  });

  it('compares frames by value, so a rebuild that leaves the plane in place keeps the same section', () => {
    const one = resolveCadSectionFrame({ kind: 'datum-plane', featureId: 'mount' }, [mount], { lift: 2 });
    const same = resolveCadSectionFrame({ kind: 'datum-plane', featureId: 'mount' }, [mount], { lift: 2 });
    const moved = resolveCadSectionFrame({ kind: 'datum-plane', featureId: 'mount' }, [mount], { lift: 3 });
    expect(one).not.toBe(same); expect(sameCadSectionFrame(one, same)).toBe(true); expect(sameCadSectionFrame(one, moved)).toBe(false);
    expect(sameCadSectionFrame(null, null)).toBe(true); expect(sameCadSectionFrame(one, null)).toBe(false);
  });
});
