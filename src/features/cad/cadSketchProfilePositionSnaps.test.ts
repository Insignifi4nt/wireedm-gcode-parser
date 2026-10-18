// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadSketchProfile } from '@/domain/cad/cadDocument';
import { CAD_STAR_PLUGIN } from '@/domain/cad/plugins/cadPlugins';
import { prepareCadSketchProfilePositionSnaps } from './cadSketchProfilePositionSnaps';
import { prepareCadSketchGeometrySnaps } from './cadSketchGeometrySnaps';

describe('accepted legacy profile position snapshots', () => {
  it('uses rotated capsule tangency joints, cap centers and analytic midpoints rather than control locations', () => {
    const profile: CadSketchProfile = { id: 'slot', name: 'Slot', construction: true,
      geometry: { kind: 'slot', x: ' x ', y: -7, length: 20, width: 8, angle: 90 } }, before = JSON.stringify(profile);
    const positions = prepareCadSketchProfilePositionSnaps({ profiles: [profile], parameters: { x: 13.25 } });
    expect(positions.find(source => source.location.kind === 'center')?.point).toEqual([13.25, -7]);
    const cap = positions.find(source => source.location.kind === 'arc-center' && source.location.boundaryIndex === 1);
    expect(cap?.point[0]).toBeCloseTo(13.25, 13); expect(cap?.point[1]).toBeCloseTo(-1, 13);
    const midpoint = positions.find(source => source.location.kind === 'midpoint' && source.location.boundaryIndex === 1);
    expect(midpoint?.point[0]).toBeCloseTo(13.25, 13); expect(midpoint?.point[1]).toBeCloseTo(3, 13);
    const endpoint = positions.find(source => source.location.kind === 'endpoint' && source.location.boundaryIndex === 0);
    expect(endpoint?.point[0]).toBeCloseTo(17.25, 13); expect(endpoint?.point[1]).toBeCloseTo(-13, 13);
    expect(positions.filter(source => source.location.kind === 'endpoint')).toHaveLength(4);
    expect(positions.filter(source => source.location.kind === 'midpoint')).toHaveLength(4);
    expect(prepareCadSketchGeometrySnaps(undefined, positions)({ cursor: [13.25, 11], mmPerPixel: [.01, .01] })).toEqual({ kind: 'none' });
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('offers actual rounded joints and support centers without virtual sharp corners or source rewrites', () => {
    const profile: CadSketchProfile = { id: 'rounded', name: 'Plate', construction: false,
      geometry: { kind: 'rectangle', x: ' x ', y: 3, width: 20, height: 10, cornerRadius: 2 } }, before = JSON.stringify(profile);
    const positions = prepareCadSketchProfilePositionSnaps({ profiles: [profile], parameters: { x: 2 } });
    expect(positions.filter(source => source.location.kind === 'endpoint')).toHaveLength(8);
    expect(positions.filter(source => source.location.kind === 'arc-center')).toHaveLength(4);
    expect(positions.find(source => source.location.kind === 'center')?.point).toEqual([12, 8]);
    expect(positions.find(source => source.location.kind === 'endpoint' && source.location.boundaryIndex === 0)?.point).toEqual([4, 3]);
    const snap = prepareCadSketchGeometrySnaps(undefined, positions);
    for (const cursor of [[2, 3], [22, 3], [22, 13], [2, 13]] as const)
      expect(snap({ cursor, mmPerPixel: [.01, .01] })).toEqual({ kind: 'none' });
    expect(JSON.stringify(profile)).toBe(before);
  });

  it('has one center and no seam endpoint for circles, circular capsules and full-turn path arcs', () => {
    const geometries: CadSketchProfile['geometry'][] = [
      { kind: 'circle', x: 1.25, y: -2, radius: 4 },
      { kind: 'slot', x: 1.25, y: -2, length: 8, width: 8, angle: 37 },
      { kind: 'path', segments: [{ kind: 'arc', center: [1.25, -2], radius: 4, startAngle: 21, sweep: -360 }] }
    ];
    for (const geometry of geometries) {
      const profile = { id: 'round', name: 'Round', construction: false, geometry }, before = JSON.stringify(profile);
      expect(prepareCadSketchProfilePositionSnaps({ profiles: [profile], parameters: {} })).toEqual([
        { profileId: 'round', location: { kind: 'center' }, point: [1.25, -2] }
      ]);
      expect(JSON.stringify(profile)).toBe(before);
    }
    const nearCircle: CadSketchProfile = { id: 'capsule', name: 'Capsule', construction: false,
      geometry: { kind: 'slot', x: 0, y: 0, length: 8.000001, width: 8, angle: 0 } };
    const centers = prepareCadSketchProfilePositionSnaps({ profiles: [nearCircle], parameters: {} })
      .filter(source => source.location.kind === 'center' || source.location.kind === 'arc-center');
    expect(centers).toHaveLength(3); // Nearby cap centers stay distinct; this is no proximity weld.
    expect(new Set(centers.map(source => source.point[0])).size).toBe(3);
  });

  it('keeps a major arc midpoint on its signed support when the closed source traverses in reverse', () => {
    const profiles: CadSketchProfile[] = [
      { id: 'cw', name: 'Major', construction: false, geometry: { kind: 'path', segments: [
        { kind: 'arc', center: [0, 0], radius: 10, startAngle: 0, sweep: -270 }, { kind: 'line', start: [0, 10], end: [10, 0] }
      ] } },
      { id: 'ccw', name: 'Reverse', construction: false, geometry: { kind: 'path', segments: [
        { kind: 'line', start: [10, 0], end: [0, 10] }, { kind: 'arc', center: [0, 0], radius: 10, startAngle: 90, sweep: 270 }
      ] } }
    ];
    for (const profile of profiles) {
      const positions = prepareCadSketchProfilePositionSnaps({ profiles: [profile], parameters: {} });
      const midpoint = positions.find(source => source.location.kind === 'midpoint' && source.location.boundaryIndex === 1);
      expect(midpoint?.point[0]).toBeCloseTo(-10 / Math.SQRT2, 13); expect(midpoint?.point[1]).toBeCloseTo(-10 / Math.SQRT2, 13);
      expect(positions.find(source => source.location.kind === 'midpoint' && source.location.boundaryIndex === 0)?.point).toEqual([5, 5]);
      expect(positions.filter(source => source.location.kind === 'endpoint')).toHaveLength(2);
    }
  });

  it('copies plugin output once, never guesses its center, and leaves package/scalars authoritative', () => {
    const profile = { id: 'star', name: 'Star', construction: false, geometry: { kind: 'plugin' as const,
      package: CAD_STAR_PLUGIN, inputs: { lobes: 4, outerRadius: 30, innerRadius: 20 } } }, before = JSON.stringify(profile);
    const positions = prepareCadSketchProfilePositionSnaps({ profiles: [profile], parameters: {} });
    expect(positions.filter(source => source.location.kind === 'endpoint')).toHaveLength(8);
    expect(positions.some(source => source.location.kind === 'center')).toBe(false);
    expect(JSON.stringify(profile)).toBe(before);
    expect(Object.isFrozen(positions)).toBe(true);
    expect(Object.isFrozen(positions[0])).toBe(true); expect(Object.isFrozen(positions[0].location)).toBe(true);
    expect(Reflect.set(positions[0].point, '0', 999)).toBe(false);
    const snap = prepareCadSketchGeometrySnaps(undefined, positions);
    profile.geometry.inputs.outerRadius = 60;
    expect(snap({ cursor: [30, 0], mmPerPixel: [.01, .01] })).toMatchObject({ kind: 'hit', candidate: {
      target: { kind: 'profile-position', profileId: 'star', location: { kind: 'endpoint', boundaryIndex: 0 } }, point: [30, 0], entityIds: []
    } });
    expect(snap({ cursor: [60, 0], mmPerPixel: [.01, .01] })).toEqual({ kind: 'none' });
  });

  it('keeps valid profile positions when another source is unavailable, and omits unrepresentable fresh points', () => {
    const profiles: CadSketchProfile[] = [
      { id: 'unavailable', name: 'Unavailable', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: ' missing ' } },
      { id: 'limit', name: 'Limit slot', construction: false, geometry: { kind: 'slot', x: 999999999, y: 0, length: 20, width: 8, angle: 0 } }
    ], before = JSON.stringify(profiles);
    const positions = prepareCadSketchProfilePositionSnaps({ profiles, parameters: {} });
    expect(positions.some(source => source.profileId === 'unavailable')).toBe(false);
    expect(positions.find(source => source.location.kind === 'center')?.point).toEqual([999999999, 0]);
    expect(positions.some(source => source.location.kind === 'arc-center' && source.location.boundaryIndex === 3)).toBe(true);
    expect(positions.every(source => source.point.every(value => Number.isFinite(value) && Math.abs(value) <= 1e9))).toBe(true);
    expect(JSON.stringify(profiles)).toBe(before);
  });
});
