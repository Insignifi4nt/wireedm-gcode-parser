import { describe, expect, it } from 'vitest';
import { prepareCadSketchCells, inspectCadSketchRegions, readCadSketchRegionReference } from '../cadSketchRegionInspection';
import { part, refs, sketch } from './cadSketchRegionFixtures';
import { pad } from './cadSketchRegionFixtures';
import { CadSession } from '@/features/cad/cadSession';
import type { CadSketchFeature } from '../cadDocument';

describe('prepared closed-cell inspection and physical selection', () => {
  it('preflights each shared-driver source even when an earlier selected extrusion also needs the same atomic repair', () => {
    const first: CadSketchFeature = { ...sketch(), profiles: sketch().profiles.map(profile => profile.id === 'bore' && profile.geometry.kind === 'circle'
      ? { ...profile, geometry: { ...profile.geometry, x: 'location' } } : profile) };
    const second: CadSketchFeature = { ...first, id: 'second', name: 'Second' };
    const session = new CadSession(part([first, pad([refs.outer]), second, { ...pad([refs.outer]), id: 'second_pad', sketchId: 'second' }], { location: 0 }));
    const before = session.getSnapshot(), proposal = { parameterValues: { location: 50 } };
    expect(() => session.edit([{ kind: 'set-parameter', name: 'location', value: 50 }], before.version)).toThrow(/region.*changed/i);
    const later = inspectCadSketchRegions(before.document, 'second', { proposal });
    const earlier = inspectCadSketchRegions(before.document, 'regions', { proposal });
    const newRef = { boundaryProfileId: 'outer', voidProfileIds: ['island'], ancestorProfileIds: [] };
    expect(later.items.find(cell => cell.boundaryProfileId === 'outer')?.reference).toEqual(newRef);
    expect(earlier.items.find(cell => cell.boundaryProfileId === 'outer')?.reference).toEqual(newRef);
    expect(later.items.find(cell => cell.boundaryProfileId === 'outer')?.areaMm2).toBeCloseTo(96 * Math.PI, 10);
    expect(session.getSnapshot()).toBe(before);
    session.edit([{ kind: 'set-parameter', name: 'location', value: 50 }, { kind: 'update-feature', feature: pad([newRef]) },
      { kind: 'update-feature', feature: { ...pad([newRef]), id: 'second_pad', sketchId: 'second' } }], before.version);
    const accepted = session.getSnapshot(); expect(accepted.document.features[0]).toEqual(first); expect(accepted.document.features[2]).toEqual(second);
    session.undo(); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
    session.redo(); expect(session.getSnapshot().document).toEqual(accepted.document);
  });

  it('preflights proposed source and numeric parameters before one atomic topology-and-selection edit', () => {
    const source: CadSketchFeature = { ...sketch(), profiles: sketch().profiles.map(profile => profile.id === 'bore' && profile.geometry.kind === 'circle'
      ? { ...profile, geometry: { ...profile.geometry, x: 'location' } } : profile) };
    const session = new CadSession(part([source, pad([refs.outer])], { location: 0 })), before = session.getSnapshot();
    const proposedSource: CadSketchFeature = { ...source, profiles: source.profiles.filter(profile => profile.id !== 'island').concat([
      { id: 'fresh', name: 'Fresh', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } },
    ]) };
    expect(() => session.edit([{ kind: 'update-feature', feature: proposedSource }, { kind: 'set-parameter', name: 'location', value: 50 }], before.version)).toThrow(/region.*changed/i);
    const proposal = { sketch: proposedSource, parameterValues: { location: 50 } }, input = { proposal };
    const inspection = inspectCadSketchRegions(before.document, 'regions', input);
    const outer = inspection.items.find(cell => cell.boundaryProfileId === 'outer');
    expect(inspection).toMatchObject({ proposed: true, total: 4 });
    expect(outer?.reference).toEqual({ boundaryProfileId: 'outer', voidProfileIds: ['fresh'], ancestorProfileIds: [] });
    expect(outer?.areaMm2).toBeCloseTo(99 * Math.PI, 10);
    expect(readCadSketchRegionReference(before.document, 'regions', 'outer', proposal)).toEqual(outer?.reference);
    expect(session.getSnapshot()).toBe(before); expect(JSON.stringify(proposedSource.source)).toBe(JSON.stringify(source.source));
    if (!outer) throw new Error('No proposed outer cell');
    session.edit([{ kind: 'update-feature', feature: proposedSource }, { kind: 'set-parameter', name: 'location', value: 50 },
      { kind: 'update-feature', feature: pad([outer.reference]) }], before.version);
    const accepted = session.getSnapshot();
    expect(accepted.document.features[0]).toEqual(proposedSource); expect(accepted.document.parameters).toEqual({ location: 50 });
    session.edit([{ kind: 'update-feature', feature: proposedSource }], accepted.version); expect(session.getSnapshot()).toBe(accepted);
    session.undo(); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
    session.redo(); expect(session.getSnapshot().document).toEqual(accepted.document);
  });

  it('validates proposal identity, complete unselected geometry and effective values while keeping accepted-only inspection exact', () => {
    const source = sketch(), document = part([source, pad([refs.outer])]), text = JSON.stringify(document);
    const wrongId = { proposal: { sketch: { ...source, id: 'other' } } };
    expect(() => inspectCadSketchRegions(document, 'regions', wrongId)).toThrow(/same.*sketch|identity/i);
    const suppressed = { proposal: { sketch: { ...source, suppressed: true } } };
    expect(() => inspectCadSketchRegions(document, 'regions', suppressed)).toThrow(/suppressed/i);
    const tangent = { proposal: { sketch: { ...source, profiles: [...source.profiles, { id: 'touch', name: 'Unselected tangent', construction: false,
      geometry: { kind: 'circle' as const, x: 13, y: 0, radius: 3 } }] } } };
    expect(() => inspectCadSketchRegions(document, 'regions', tangent)).toThrow(/touch|overlap/i);
    const invalidValue = { proposal: { parameterValues: { invalid: Infinity } } };
    expect(() => inspectCadSketchRegions(document, 'regions', invalidValue)).toThrow();
    const sourceOnly = { proposal: { sketch: { ...source, profiles: source.profiles.filter(profile => profile.id !== 'island') } } };
    expect(inspectCadSketchRegions(document, 'regions', sourceOnly).items[0].reference).toEqual({ ...refs.bore, voidProfileIds: [] });
    expect(inspectCadSketchRegions(document, 'regions').items[0].reference).toEqual(refs.bore);
    expect(inspectCadSketchRegions(document, 'regions')).not.toHaveProperty('proposed'); expect(JSON.stringify(document)).toBe(text);
  });

  it('validates only actual preceding datum dependencies without relocating or admitting missing, later or suppressed frames', () => {
    const source = sketch(), datum = { id: 'datum', name: 'Datum', kind: 'datum-plane' as const, suppressed: false,
      definition: { kind: 'world' as const, basePlane: 'XY' as const, origin: [10, 20, 30] as const, rotation: ['tilt', 0, 0] as const } };
    const placed = { ...source, plane: { kind: 'datum-plane' as const, featureId: 'datum' } };
    const proposal = { sketch: placed, parameterValues: { tilt: 30 } };
    const document = part([datum, source, pad([refs.outer])], { tilt: 0 });
    expect(inspectCadSketchRegions(document, 'regions', { proposal }).items[0].reference).toEqual(refs.bore);
    expect(() => inspectCadSketchRegions(part([source, datum], { tilt: 0 }), 'regions', { proposal })).toThrow(/preceding datum/i);
    expect(() => inspectCadSketchRegions(part([source], { tilt: 0 }), 'regions', { proposal })).toThrow(/preceding datum/i);
    expect(() => inspectCadSketchRegions(part([{ ...datum, suppressed: true }, source], { tilt: 0 }), 'regions', { proposal }))
      .toThrowError(expect.objectContaining({ code: 'unavailable-datum-plane' }));
    expect(JSON.stringify(document.features[1])).toBe(JSON.stringify(source));
  });

  it('reports complete cells, independent analytic quantities and exact canonical references', () => {
    const source = sketch(); const text = JSON.stringify(source);
    const prepared = prepareCadSketchCells(source, {});
    expect(prepared.cells.map(cell => cell.reference)).toEqual([refs.bore, refs.island, refs.outer, refs.separate]);
    for (const [id, coefficient, perimeter, material] of [['bore', 32, 16, false], ['island', 4, 4, true],
      ['outer', 64, 32, true], ['separate', 9, 6, true]] as const) {
      const cell = prepared.cells.find(cell => cell.reference.boundaryProfileId === id);
      expect(cell?.areaMm2).toBeCloseTo(coefficient * Math.PI, 10);
      expect(cell?.boundaryLengthMm).toBeCloseTo(perimeter * Math.PI, 10);
      expect(cell?.defaultMaterial).toBe(material);
    }
    expect(prepared.cells.find(cell => cell.reference.boundaryProfileId === 'outer')?.boundsMm).toEqual({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
    expect(prepared.resolve([refs.outer, refs.bore]).map(region => ({ outer: region.boundary.profile.id,
      holes: region.voids.map(contour => contour.profile.id) }))).toEqual([{ outer: 'outer', holes: ['island'] }]);
    expect(JSON.stringify(source)).toBe(text);
  });

  it('picks the deepest actual analytic cell and keeps an immutable preparation valid without resolving another source', () => {
    const prepared = prepareCadSketchCells(sketch(), {});
    expect(prepared.pick({ x: 8, y: 0 })?.reference).toEqual(refs.outer);
    expect(prepared.pick({ x: 4, y: 0 })?.reference).toEqual(refs.bore);
    expect(prepared.pick({ x: 0, y: 0 })?.reference).toEqual(refs.island);
    expect(prepared.pick({ x: 30, y: 0 })?.reference).toEqual(refs.separate);
    expect(prepared.pick({ x: 15, y: 0 })).toBeNull();
    expect(prepared.pick({ x: Infinity, y: 0 })).toBeNull();
    const changed = prepareCadSketchCells({ ...sketch(), profiles: sketch().profiles.filter(profile => profile.id !== 'island') }, {});
    expect(changed.pick({ x: 0, y: 0 })?.reference).toEqual({ ...refs.bore, voidProfileIds: [] });
    expect(prepared.pick({ x: 0, y: 0 })?.reference).toEqual(refs.island);
  });

  it('reuses actual concave and circular path containment rather than bounding boxes', () => {
    const source = sketch(false);
    const path = { id: 'path', name: 'Circular path', construction: false, geometry: { kind: 'path' as const, segments: [
      { kind: 'arc' as const, center: [0, 0] as const, radius: 10, startAngle: 90, sweep: 180 },
      { kind: 'arc' as const, center: [0, 0] as const, radius: 10, startAngle: 270, sweep: 180 },
    ] } };
    const prepared = prepareCadSketchCells({ ...source, profiles: [path] }, {});
    expect(prepared.pick({ x: 9, y: 0 })?.reference.boundaryProfileId).toBe('path');
    expect(prepared.pick({ x: 9, y: 9 })).toBeNull();
    expect(prepared.cells[0].areaMm2).toBeCloseTo(100 * Math.PI, 10);
    const concave = prepareCadSketchCells({ ...source, profiles: [{ id: 'concave', name: 'Concave', construction: false,
      geometry: { kind: 'polygon', points: [[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10]] } }] }, {});
    expect(concave.pick({ x: 1, y: 5 })?.reference.boundaryProfileId).toBe('concave');
    expect(concave.pick({ x: 6, y: 5 })).toBeNull();
    expect(concave.cells[0].areaMm2).toBe(52);
  });

  it('pages stable cell identities with complete references and preserves source originals', () => {
    const document = part([sketch()]); const text = JSON.stringify(document);
    const first = inspectCadSketchRegions(document, 'regions', { offset: 0, limit: 2 });
    const second = inspectCadSketchRegions(document, 'regions', { offset: 2, limit: 2 });
    expect(first).toMatchObject({ sketchId: 'regions', coordinateSystem: 'sketch-local', total: 4, nextOffset: 2 });
    expect(second).toMatchObject({ total: 4, nextOffset: null });
    expect([...first.items, ...second.items].map(cell => cell.reference)).toEqual([refs.bore, refs.island, refs.outer, refs.separate]);
    expect(readCadSketchRegionReference(document, 'regions', 'bore')).toEqual(refs.bore);
    expect(JSON.stringify(document)).toBe(text);
  });

  it('refuses inactive sketches and absent cells without substituting another source', () => {
    expect(() => inspectCadSketchRegions(part([{ ...sketch(), suppressed: true }]), 'regions')).toThrow(/suppressed/i);
    expect(() => inspectCadSketchRegions(part([sketch()]), 'missing')).toThrow(/sketch/i);
    expect(() => readCadSketchRegionReference(part([sketch()]), 'regions', 'missing')).toThrow(/region/i);
    expect(() => inspectCadSketchRegions(part([sketch()]), 'regions', { offset: -1 })).toThrow();
  });
});
