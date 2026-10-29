import { describe, expect, it } from 'vitest';
import type { CadProfile, CadSketchProfile } from '@/domain/cad/cadDocument';
import { createCadSketchHandlePicker, createCadSketchProfilePicker } from './cadSketchPicking';

function profile(id: string, geometry: CadProfile, construction = false): CadSketchProfile {
  return { id, name: id, geometry, construction };
}
const circle = (radius: number): CadProfile => ({ kind: 'circle', x: 0, y: 0, radius });

describe('sketch handle ownership picking', () => {
  it('keeps the selected profile grip ahead of overlapping hidden grips, including a locked point', () => {
    const selected = profile('selected', { kind: 'polygon', points: [['origin', 'origin'], [20, 0], [0, 10]] });
    const other = profile('other', { kind: 'polygon', points: [[0, 0], [30, 0], [0, 20]] });
    const pick = createCadSketchHandlePicker([selected, other], { origin: 0 }).pick;
    expect(pick([0, 0], .1, 'selected')).toMatchObject({ profileId: 'selected', draggable: false, handle: { kind: 'vertex', index: 0 } });
    expect(pick([0, 0], .1, 'other')).toMatchObject({ profileId: 'other', draggable: true });
    expect(pick([0, 0], .1)).toMatchObject({ profileId: 'selected' });
    expect(pick([30, 0], .1, 'selected')).toMatchObject({ profileId: 'other', handle: { kind: 'vertex', index: 1 } });
  });

  it('limits ownership priority to the pixel hit radius and otherwise picks the nearest grip', () => {
    const pick = createCadSketchHandlePicker([
      profile('selected', circle(5)), profile('other', { kind: 'circle', x: .2, y: 0, radius: 4 })
    ], {}).pick;
    expect(pick([.2, 0], .1, 'selected')).toMatchObject({ profileId: 'selected', handle: { kind: 'center' } });
    expect(pick([.2, 0], .01, 'selected')).toMatchObject({ profileId: 'other', handle: { kind: 'center' } });
    expect(pick([.2, 0], .1)).toMatchObject({ profileId: 'other' });
    expect(pick([-.59, 0], .1, 'selected')).toMatchObject({ profileId: 'selected' });
    expect(pick([-.61, 0], .1, 'selected')).toBeNull();
    expect(pick([0, 0], 0, 'selected')).toBeNull();
    expect(pick([NaN, 0], .1, 'selected')).toBeNull();
  });
});

describe('analytic sketch profile picking', () => {
  it('selects innermost nested contours regardless of legacy role or array ordering', () => {
    const pick = createCadSketchProfilePicker([
      { ...profile('hole', circle(5)), role: 'hole' }, profile('outer', circle(10)), profile('island', circle(2))
    ], {}).pick;
    expect(pick([0, 0], 0.01)).toBe('island');
    expect(pick([3, 0], 0.01)).toBe('hole');
    expect(pick([8, 0], 0.01)).toBe('outer');
    expect(pick([11, 0], 0.01)).toBeNull();
  });

  it('prioritizes nearest boundaries, including construction, with a fixed pixel radius', () => {
    const pick = createCadSketchProfilePicker([profile('outer', circle(20)), profile('construction', circle(5), true)], {}).pick;
    expect(pick([0, 0], 0.1)).toBe('outer');
    expect(pick([5.5, 0], 0.1)).toBe('construction');
    expect(pick([5.7, 0], 0.1)).toBe('outer');
    const standalone = createCadSketchProfilePicker([profile('construction', circle(5), true)], {}).pick;
    expect(standalone([0, 0], 0.1)).toBeNull();
    expect(standalone([5.5, 0], 0.1)).toBe('construction');
    expect(standalone([5.5, 0], 0.01)).toBeNull();
    expect(standalone([10.9, 0], 1)).toBe('construction');
    expect(standalone([11.1, 0], 1)).toBeNull();
    const nearest = createCadSketchProfilePicker([profile('first', circle(5)), profile('closer', circle(5.3))], {}).pick;
    expect(nearest([5.25, 0], 0.1)).toBe('closer');
  });

  it('uses true rotated slot caps and rounded rectangle corners, rather than their boxes', () => {
    const angle = 37 * Math.PI / 180;
    const rotate = (x: number, y: number): readonly [number, number] => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
    const slot = createCadSketchProfilePicker([profile('slot', { kind: 'slot', x: 0, y: 0, length: 20, width: 4, angle: 37 })], {}).pick;
    expect(slot(rotate(9.5, 0), 0.01)).toBe('slot');
    expect(slot(rotate(9.8, 1.8), 0.01)).toBeNull();
    expect(slot(rotate(0, 2.05), 0.01)).toBe('slot');
    const rounded = createCadSketchProfilePicker([profile('rounded', { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 3 })], {}).pick;
    expect(rounded([0.1, 0.1], 0.01)).toBeNull();
    expect(rounded([2, 2], 0.01)).toBe('rounded');
  });

  it('hits signed circular arcs without selecting their complementary curve extensions', () => {
    const geometry: CadProfile = { kind: 'path', segments: [
      { kind: 'line', start: [-10, -15], end: [10, -15] },
      { kind: 'line', start: [10, -15], end: [10, 0] },
      { kind: 'arc', center: [0, 0], radius: 10, startAngle: 0, sweep: -180 },
      { kind: 'line', start: [-10, 0], end: [-10, -15] }
    ] };
    const pick = createCadSketchProfilePicker([profile('concave', geometry)], {}).pick;
    expect(pick([0, -10.05], 0.01)).toBe('concave');
    expect(pick([0, 10], 0.01)).toBeNull();
    expect(pick([9, -9], 0.01)).toBe('concave');
    expect(pick([0, -5], 0.01)).toBeNull();
    expect(pick([10.05, 0], 0.01)).toBe('concave');
    const full = createCadSketchProfilePicker([profile('full', { kind: 'path', segments: [
      { kind: 'arc', center: [0, 0], radius: 4, startAngle: 70, sweep: -360 }
    ] })], {}).pick;
    expect(full([0, 0], 0.01)).toBe('full');
    expect(full([0, 4.05], 0.01)).toBe('full');
  });

  it('preserves small polygon interior areas at large world coordinates', () => {
    const x = 999999990; const y = 999999990;
    const geometry: CadProfile = { kind: 'polygon', points: [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]] };
    const pick = createCadSketchProfilePicker([profile('remote', geometry)], {}).pick;
    expect(pick([x + 0.5, y + 0.5], 0.001)).toBe('remote');
    expect(pick([x + 1.01, y + 0.5], 0.001)).toBeNull();
  });

  it('answers whether an edge is near from the indexed edges exactly as a scan of every edge does', () => {
    const shapes: CadProfile[] = [circle(5), { kind: 'circle', x: 40, y: -8, radius: 0.3 }, { kind: 'slot', x: -20, y: 15, length: 30, width: 4, angle: 37 },
      { kind: 'rectangle', x: 5, y: 5, width: 60, height: 2, cornerRadius: 0.5 }, { kind: 'polygon', points: [[-50, -50], [50, -48], [0, -30]] },
      { kind: 'path', segments: [{ kind: 'line', start: [-10, -15], end: [10, -15] }, { kind: 'line', start: [10, -15], end: [10, 0] },
        { kind: 'arc', center: [0, 0], radius: 10, startAngle: 0, sweep: -180 }, { kind: 'line', start: [-10, 0], end: [-10, -15] }] }];
    // Construction profiles have no interior pick, so the full scan in `pick` reports exactly the edges in reach.
    const picker = createCadSketchProfilePicker(shapes.map((shape, index) => profile(`p${index}`, shape, true)), {});
    let near = 0;
    for (const scale of [0.01, 0.1, 1]) for (let x = -60; x <= 70; x += 0.7) for (let y = -55; y <= 25; y += 0.9) {
      const expected = picker.pick([x, y], scale) !== null;
      expect(picker.edgeNear([x, y], scale)).toBe(expected); if (expected) near += 1;
    }
    expect(near).toBeGreaterThan(100);
    // An interior alone is not an edge, and no profiles or a bad scale answer nothing.
    const solid = createCadSketchProfilePicker([profile('solid', circle(5))], {});
    expect(solid.pick([0, 0], 0.1)).toBe('solid'); expect(solid.edgeNear([0, 0], 0.1)).toBe(false); expect(solid.edgeNear([5.5, 0], 0.1)).toBe(true);
    expect(createCadSketchProfilePicker([], {}).edgeNear([0, 0], 1)).toBe(false);
    expect(solid.edgeNear([5, 0], 0)).toBe(false); expect(solid.edgeNear([NaN, 0], 1)).toBe(false);
  });

  it('captures parameter snapshots, leaves source geometry unchanged and rejects invalid view coordinates', () => {
    const geometry: CadProfile = { kind: 'circle', x: 2, y: 2, radius: 'radius' };
    const profiles = Object.freeze([Object.freeze(profile('parametric', Object.freeze(geometry)))]);
    const parameters = { radius: 3 };
    const first = createCadSketchProfilePicker(profiles, parameters).pick;
    parameters.radius = 1;
    expect(first([4, 2], 0.01)).toBe('parametric');
    expect(createCadSketchProfilePicker(profiles, parameters).pick([4, 2], 0.01)).toBeNull();
    expect(geometry.radius).toBe('radius');
    expect(first([NaN, 0], 1)).toBeNull();
    expect(first([0, 0], Infinity)).toBeNull();
    expect(first([0, 0], 0)).toBeNull();
  });
});
