import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { inspectCadPlane } from '../cadPlaneInspection';

const datum = { id: 'mount', name: 'Mount', kind: 'datum-plane', suppressed: false,
  definition: { kind: 'world', basePlane: 'XY', origin: [10, -20, 30], rotation: ['tilt', 0, 0] } };
const sketch = { id: 'profile', name: 'Profile', kind: 'sketch', suppressed: false,
  plane: { kind: 'datum-plane', featureId: 'mount' }, offset: 3, profiles: [] };
const document = () => parseCadDocument({ ...createCadDocument(), parameters: { tilt: 90 }, features: [datum, sketch] });

describe('bounded CAD plane inspection', () => {
  it('distinguishes a base datum origin from its offset sketch placement', () => {
    const draft = document();
    const plane = inspectCadPlane(draft, 'mount');
    expect(plane).toMatchObject({ featureId: 'mount', featureKind: 'datum-plane', units: 'mm', datumId: 'mount', offsetMm: 0,
      plane: { kind: 'datum-plane', featureId: 'mount' }, placedOriginMm: [10, -20, 30],
      frame: { origin: [10, -20, 30], u: [1, 0, 0], v: [0, 0, 1], normal: [0, -1, 0] } });
    const profile = inspectCadPlane(draft, 'profile');
    expect(profile).toMatchObject({ featureKind: 'sketch', datumId: 'mount', offsetMm: 3,
      placedOriginMm: [10, -23, 30], frame: { origin: [10, -20, 30] } });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.frame)).toBe(true);
    expect(Object.isFrozen(profile.frame.normal)).toBe(true);
    expect(Object.isFrozen(profile.plane)).toBe(true);
    expect(Object.isFrozen(profile.placedOriginMm)).toBe(true);
  });
  it('keeps legacy principal placement and excludes geometry and imported sources', () => {
    const draft = parseCadDocument({ ...createCadDocument(), features: [{ kind: 'curve', id: 'rail', name: 'Rail', suppressed: false,
      plane: 'XZ', offset: 7, segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }],
      source: { format: 'dxf', fileName: 'source.dxf', units: 'mm', text: '999\n' + 'Original annotation '.repeat(80_000) + '\n0\nEOF\n' } }] });
    const receipt = inspectCadPlane(draft, 'rail');
    expect(receipt).toMatchObject({ featureKind: 'curve', plane: 'XZ', datumId: null, offsetMm: 7,
      placedOriginMm: [0, -7, 0], frame: { origin: [0, 0, 0], normal: [0, -1, 0] } });
    expect(JSON.stringify(receipt).length).toBeLessThan(1024);
    expect(JSON.stringify(receipt)).not.toMatch(/Original annotation|segments|source\.dxf/);
  });
  it('rejects absent, solid and suppressed references rather than returning fabricated placement', () => {
    const draft = parseCadDocument({ ...document(), features: [datum, { ...sketch, profiles: [
      { id: 'disc', name: 'Disc', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] },
    { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false, sketchId: 'profile', distance: 4, symmetric: false, operation: 'new', targetId: null }] });
    for (const id of ['missing', 'pad']) expect(() => inspectCadPlane(draft, id)).toThrow('datum plane, Sketch or Curve');
    const hidden = parseCadDocument({ ...document(), features: [{ ...datum, suppressed: true }, { ...sketch, suppressed: true }] });
    for (const id of ['mount', 'profile']) expect(() => inspectCadPlane(hidden, id)).toThrow('Unsuppress');
  });
});
