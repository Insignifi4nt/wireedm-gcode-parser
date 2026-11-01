import { describe, expect, it } from 'vitest';
import type { CadCurveFeature, CadDatumPlaneFeature, CadFeature, CadPlane, CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import { resolveCadWorldDatum, cadFramePointToWorld } from '@/domain/cad/cadDatumPlanes';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CAD_PRINCIPAL_PLANE_REFERENCES, cadReferenceFeatureIds, cadReferencePlanes, cadProfileReferenceGeometry, prepareCadViewportReferences, selectCadViewportReferences } from './cadViewportReferences';

const sketch = (id = 'sketch', plane: CadPlane = 'XY', geometry: CadProfile = { kind: 'circle', x: 2, y: 3, radius: 1 }): CadSketchFeature => ({ id, name: id, kind: 'sketch', plane, offset: 'lift', suppressed: false,
  profiles: [{ id: 'profile', name: 'Profile', construction: false, geometry }] });
const curve: CadCurveFeature = { id: 'rail', name: 'Rail', kind: 'curve', plane: 'XY', offset: 0, suppressed: false, segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }] };
const pad: CadFeature = { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'section', distance: 5, symmetric: false, operation: 'new', targetId: null };

describe('datum reference geometry and visibility', () => {
  it('keeps all installed identities for 257 accepted standalone datum references', () => {
    const features: CadDatumPlaneFeature[] = Array.from({ length: 257 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: `Station ${index}`, kind: 'datum-plane', suppressed: false,
      definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, index], rotation: [0, 0, 0] }
    }));
    const document = parseCadDocument({ ...createCadDocument('Station references', 'station_references'), features });
    const references = prepareCadViewportReferences(document.features, document.parameters);
    expect(cadReferenceFeatureIds(selectCadViewportReferences(references, document, null))).toEqual(features.map(feature => feature.id));
    expect(references).toHaveLength(257);
    expect(document.features).toEqual(features);
  });
  it('keeps principal planes at the exact world origin and separate from real features with the same names', () => {
    const features = [{ ...sketch('XY'), offset: 0 }], references = [...CAD_PRINCIPAL_PLANE_REFERENCES, ...prepareCadViewportReferences(features, {})];
    expect(cadReferenceFeatureIds(references)).toEqual(['XY']); expect(cadReferencePlanes(references)).toEqual(['XY', 'XZ', 'YZ']);
    for (const [index, normalAxis] of [2, 1, 0].entries()) {
      const plane = CAD_PRINCIPAL_PLANE_REFERENCES[index]; expect(plane.featureId).toBeNull();
      expect(plane.planePatch).toHaveLength(18); expect(Object.isFrozen(plane.planePatch)).toBe(true);
      expect(plane.planePatch?.filter((_, coordinate) => coordinate % 3 === normalAxis).every(value => value === 0)).toBe(true);
      const axes = [0, 1, 2].filter(axis => axis !== normalAxis);
      for (const axis of axes) expect(new Set(plane.planePatch?.filter((_, coordinate) => coordinate % 3 === axis))).toEqual(new Set([-12.5, 12.5]));
    }
  });
  const datum: CadDatumPlaneFeature = { id: 'mount', name: 'Mount', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XZ', origin: [10, 20, 30], rotation: [30, 45, 10] } };
  const section = { ...sketch('section'), plane: { kind: 'datum-plane', featureId: 'mount' } as const, offset: 4 };
  it('places tilted contours analytically, retains exact source data and bounded glyphs', () => {
    const features = [datum, section]; const before = JSON.stringify(features); const prepared = prepareCadViewportReferences(features, {});
    const outline = prepared.find(reference => reference.featureKind === 'sketch')!; const glyph = prepared.find(reference => reference.featureKind === 'datum-plane')!;
    expect(outline.positions.slice(0, 3)).toEqual(cadFramePointToWorld(resolveCadWorldDatum(datum, {}), 4, [3, 3]));
    for (let index = 0; index < outline.positions.length; index += 3) for (let axis = 0; axis < 3; axis++) {
      expect(outline.positions[index + axis]).toBeGreaterThanOrEqual(outline.bounds.min[axis] - 1e-12);
      expect(outline.positions[index + axis]).toBeLessThanOrEqual(outline.bounds.max[axis] + 1e-12);
    }
    expect(glyph.positions).toHaveLength(54); expect(glyph.planePatch).toHaveLength(18); expect(Object.isFrozen(glyph.planePatch)).toBe(true);
    expect(JSON.stringify(features)).toBe(before);
    expect(cadReferenceFeatureIds(selectCadViewportReferences(prepared, { features, parameters: {} }, null))).toEqual(['section']);
    expect(cadReferenceFeatureIds(selectCadViewportReferences(prepared, { features, parameters: {} }, 'section'))).toEqual(['mount', 'section']);
  });
  it('shows standalone active datums and selected body-source datums, suppressing unrelated glyphs', () => {
    const other = { ...datum, id: 'other' }; const features = [datum, other, section, pad];
    const prepared = prepareCadViewportReferences(features, {});
    expect(cadReferenceFeatureIds(selectCadViewportReferences(prepared, { features, parameters: {} }, pad.id))).toEqual(['mount', 'section']);
    expect(cadReferenceFeatureIds(selectCadViewportReferences(prepared, { features, parameters: {} }, null))).toEqual([]);
    const onlyDatums = [datum, { ...other, suppressed: true }];
    expect(cadReferenceFeatureIds(selectCadViewportReferences(prepareCadViewportReferences(onlyDatums, {}), { features: onlyDatums, parameters: {} }, null))).toEqual(['mount']);
  });
});

describe('world-space Sketch reference preparation', () => {
  it('preserves every authored segment of an accepted Curve beyond the former display edge ceiling', () => {
    const features: CadCurveFeature[] = Array.from({ length: 257 }, (_, station) => ({ ...curve, id: `rail_${station}`, offset: station,
      segments: Array.from({ length: station === 256 ? 1 : 128 }, (_, index) => ({ kind: 'line', start: [index, 0], end: [index + 1, 0] })) }));
    const document = parseCadDocument({ ...createCadDocument('Measured rails', 'measured_rails'), features });
    const before = JSON.stringify(document), references = prepareCadViewportReferences(document.features, document.parameters);
    expect(references).toHaveLength(257);
    expect(references.reduce((sum, reference) => sum + reference.positions.length / 6, 0)).toBe(32769);
    for (const [station, reference] of references.entries()) {
      const count = features[station].segments.length;
      expect(reference.positions).toHaveLength(count * 6);
      for (let index = 0; index < count; index++) expect(reference.positions.slice(index * 6, index * 6 + 6)).toEqual([index, 0, station, index + 1, 0, station]);
      expect(reference.bounds).toEqual({ min: [0, 0, station], max: [count, 0, station] });
    }
    expect(JSON.stringify(document)).toBe(before);
  }, 30000);

  it('retains each circular outline sampling resolution when accepted reference counts grow', () => {
    const features = Array.from({ length: 300 }, (_, index) => ({ ...sketch(`section_${index}`), offset: index }));
    const document = parseCadDocument({ ...createCadDocument('Sections', 'sections'), features });
    const single = prepareCadViewportReferences([document.features[0]], {})[0];
    const references = prepareCadViewportReferences(document.features, {});
    expect(references).toHaveLength(300);
    expect(single.positions.length / 6).toBe(120);
    for (const reference of references) expect(reference.positions).toHaveLength(single.positions.length);
    expect(references.reduce((sum, reference) => sum + reference.positions.length / 6, 0)).toBe(36000);
  });
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('uses exact bounds and shared signed placement on %s', plane => {
    const feature = sketch('sketch', plane); const source = JSON.stringify(feature); const [prepared] = prepareCadViewportReferences([feature], { lift: 4 });
    expect(prepared).toMatchObject({ referenceId: 'sketch/profile', featureId: 'sketch', featureKind: 'sketch', construction: false });
    expect(prepared.positions.slice(0, 3)).toEqual(plane === 'XY' ? [3, 3, 4] : plane === 'XZ' ? [3, -4, 3] : [4, 3, 3]);
    expect(prepared.bounds).toEqual(plane === 'XY' ? { min: [1, 2, 4], max: [3, 4, 4] } : plane === 'XZ' ? { min: [1, -4, 2], max: [3, -4, 4] } : { min: [4, 1, 2], max: [4, 3, 4] });
    expect(JSON.stringify(feature)).toBe(source); expect(Object.isFrozen(prepared.positions)).toBe(true);
  });

  it('renders every saved profile kind including rounded rectangles and rotated construction slots', () => {
    const geometries: CadProfile[] = [{ kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 2 }, { kind: 'circle', x: 0, y: 0, radius: 2 },
      { kind: 'slot', x: 0, y: 0, length: 20, width: 2, angle: 45 }, { kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]] },
      { kind: 'path', segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }, { kind: 'arc', center: [10, 0], radius: 10, startAngle: 0, sweep: 180 }] }];
    const features = geometries.map((geometry, index) => ({ ...sketch(`sketch_${index}`, 'XY', geometry), offset: 0 }));
    features[2] = { ...features[2], profiles: features[2].profiles.map(profile => ({ ...profile, construction: true })) };
    const prepared = prepareCadViewportReferences(features, {}); expect(prepared).toHaveLength(5); expect(prepared.every(reference => reference.positions.length > 0)).toBe(true);
    expect(prepared[2].construction).toBe(true); const extent = 9 / Math.sqrt(2) + 1;
    expect(prepared[2].bounds.max[0]).toBeCloseTo(extent); expect(prepared[2].bounds.max[1]).toBeCloseTo(extent);
    expect(prepareCadViewportReferences([{ ...features[0], suppressed: true }], {})).toEqual([]);
    const bounds = cadProfileReferenceGeometry(geometries[4], {}).bounds;
    expect(bounds).toMatchObject({ minX: 0, maxX: 20, minY: 0 }); expect(bounds.maxY).toBeCloseTo(10, 12);
  });

  it('keeps imported clockwise concave arc geometry and original source immutable', () => {
    const geometry: CadProfile = { kind: 'path', segments: [{ kind: 'line', start: [0, 0], end: [20, 0] }, { kind: 'line', start: [20, 0], end: [20, 20] },
      { kind: 'arc', center: [10, 20], radius: 10, startAngle: 0, sweep: -180 }, { kind: 'line', start: [0, 20], end: [0, 0] }] };
    const feature = { ...sketch('imported', 'XZ', geometry), source: { format: 'dxf', fileName: 'Contour.dxf', text: 'Original DXF text', units: 'mm' } } satisfies CadSketchFeature;
    const source = JSON.stringify(feature); const [reference] = prepareCadViewportReferences([feature], { lift: 4 });
    expect(reference.positions.some((_, index) => index % 3 === 2 && reference.positions[index] > 9 && reference.positions[index] < 20)).toBe(true);
    expect(reference.bounds).toEqual({ min: [0, -4, 0], max: [20, -4, 20] }); expect(JSON.stringify(feature)).toBe(source);
  });

  it('preserves every Sketch edge and Curve arc sample across thousands of authored edges', () => {
    const segments = Array.from({ length: 256 }, (_, index) => ({ kind: 'arc', center: [index * 2 + 1, 0], radius: 1, startAngle: 180, sweep: index % 2 ? 180 : -180 } satisfies CadCurveFeature['segments'][number]));
    const curves: CadCurveFeature[] = Array.from({ length: 16 }, (_, index) => ({ ...curve, id: `rail_${index}`, offset: index, segments }));
    const points: readonly [number, number][] = Array.from({ length: 2048 }, (_, index) => [Math.cos(index * Math.PI / 1024) * 20, Math.sin(index * Math.PI / 1024) * 20]);
    const features = [...curves, { ...sketch('first', 'XY', { kind: 'polygon', points }), offset: 20 }, { ...sketch('second', 'XY', { kind: 'polygon', points }), offset: 30 }];
    const references = prepareCadViewportReferences(features, {}); expect(references).toHaveLength(18);
    const displayedEdges = references.reduce((sum, reference) => sum + reference.positions.length / 6, 0);
    expect(displayedEdges).toBe(16 * 256 * 60 + 2 * 2048);
    expect(cadReferenceFeatureIds(references)).toHaveLength(18);
  });
});

describe('selected Sketch reference visibility', () => {
  it('shows active sketches without bodies and retains immutable payload identities through selection', () => {
    const features = [sketch('second'), { ...sketch('first'), profiles: [...sketch('first').profiles, { ...sketch('first').profiles[0], id: 'construction', construction: true }] }, curve, { ...sketch('hidden'), suppressed: true }];
    const prepared = prepareCadViewportReferences(features, { lift: 0 }); const visible = selectCadViewportReferences(prepared, { features, parameters: { lift: 0 } }, null);
    expect(cadReferenceFeatureIds(visible)).toEqual(['first', 'rail', 'second']); expect(Object.isFrozen(cadReferenceFeatureIds(visible))).toBe(true);
    expect(selectCadViewportReferences(prepared, { features, parameters: { lift: 0 } }, 'first')[0]).toBe(visible[0]);
  });

  it('shows selected Sketch or transitive body sources while retaining active Curve behavior', () => {
    const section = { ...sketch('section', 'YZ'), offset: 0 }; const unrelated = { ...sketch('unrelated'), offset: 0 };
    const top = { ...sketch('top'), offset: 20 }; const loft: CadFeature = { id: 'loft', name: 'Loft', kind: 'loft', suppressed: false, sketchIds: ['section', 'top'], ruled: false, operation: 'new', targetId: null };
    const move: CadFeature = { id: 'move', name: 'Move', kind: 'transform', suppressed: false, sourceId: 'loft', translation: [0, 0, 5], rotation: [0, 0, 0] };
    const sweep: CadFeature = { id: 'sweep', name: 'Sweep', kind: 'sweep', suppressed: false, sketchId: 'section', curveId: 'rail', operation: 'join', targetId: 'move' };
    const features = [section, unrelated, top, curve, loft, move, sweep]; const before = JSON.stringify(features); const prepared = prepareCadViewportReferences(features, {});
    const ids = (selectedId: string | null) => cadReferenceFeatureIds(selectCadViewportReferences(prepared, { features, parameters: {} }, selectedId));
    expect(ids(null)).toEqual(['rail']); expect(ids('unrelated')).toEqual(['rail', 'unrelated']); expect(ids('move')).toEqual(['rail', 'section', 'top']);
    expect(ids('sweep')).toEqual(['rail', 'section', 'top']); expect(ids('rail')).toEqual(['rail']); expect(ids('missing')).toEqual(['rail']);
    expect(JSON.stringify(features)).toBe(before);
    expect(cadReferenceFeatureIds(selectCadViewportReferences(prepared, { features: [...features, { ...pad, suppressed: true }], parameters: {} }, pad.id))).toEqual(['rail']);
  });
});
