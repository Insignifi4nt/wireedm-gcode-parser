import { describe, expect, it } from 'vitest';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import { inspectCadExtrudeDepth } from '@/features/cad/cadExtrudeDepthInteraction';
import { CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, CAD_STAR_PLUGIN, createCadPluginProfile, type CadPluginPackage } from '@/domain/cad/plugins/cadPlugins';
import { part, refs, sketch } from '@/domain/cad/__tests__/cadSketchRegionFixtures';

function source(document: CadDocument): CadSketchFeature {
  const result = document.features.find(feature => feature.kind === 'sketch');
  if (result?.kind !== 'sketch') throw new Error('Missing source'); return result;
}
function parsed(sketch: CadSketchFeature, parameters: CadDocument['parameters'] = {}) {
  return parseCadDocument(part([sketch], parameters));
}
function rectangle() {
  return { ...sketch(false), profiles: [{ id: 'outer', name: 'Rectangle', construction: false,
    geometry: { kind: 'rectangle' as const, x: 'position', y: 0, width: 'size', height: 10, cornerRadius: 0 } }] };
}

describe('shared immutable source preparation', () => {
  it('shares exact physical cells across irrelevant driver changes and preserves the accepted source', () => {
    const document = parsed(sketch()), saved = JSON.stringify(document), current = source(document);
    const first = prepareCadSketchCells(current, document.parameters);
    const second = prepareCadSketchCells(current, { ...document.parameters, depth: 35, other: 42 });
    expect(second).toBe(first);
    expect(second.pick({ x: 4, y: 0 })?.reference).toEqual(refs.bore);
    expect(second.cells.find(cell => cell.reference.boundaryProfileId === 'outer')?.areaMm2).toBeCloseTo(64 * Math.PI, 11);
    expect(JSON.stringify(document)).toBe(saved);
  });

  it('refreshes actual alias-driven material and rejects missing, nonfinite and invalid values without returning old cells', () => {
    const document = parsed(rectangle(), { position: 0, size: 20 }), current = source(document);
    const first = prepareCadSketchCells(current, document.parameters);
    const changed = prepareCadSketchCells(current, { position: 5, size: 30 });
    expect(changed).not.toBe(first); expect(changed.cells[0]).toMatchObject({ areaMm2: 300, boundsMm: { minX: 5, minY: 0, maxX: 35, maxY: 10 } });
    expect(() => prepareCadSketchCells(current, { position: 5 })).toThrow(/size/);
    expect(() => prepareCadSketchCells(current, { position: 5, size: Infinity })).toThrow();
    expect(() => prepareCadSketchCells(current, { position: 5, size: -1 })).toThrow(/invalid dimensions/);
    expect(prepareCadSketchCells(current, { position: 5, size: 30, depth: 40 })).toBe(changed);
    const signed = prepareCadSketchCells(current, { position: -0, size: 30 });
    const zero = prepareCadSketchCells(current, { position: 0, size: 30 });
    expect(zero).not.toBe(signed);
    const geometry = signed.cells[0].boundary.geometry; if (geometry.kind !== 'rectangle') throw Error('Rectangle lost');
    expect(Object.is(geometry.x, -0)).toBe(true);
  });

  it('recomputes nested signatures and refuses stale selection when a relevant contour moves', () => {
    const initial = sketch(), document = parsed({ ...initial, profiles: initial.profiles.map(profile => profile.id === 'bore' && profile.geometry.kind === 'circle'
      ? { ...profile, geometry: { ...profile.geometry, x: 'location' } } : profile) }, { location: 0 });
    const current = source(document), first = prepareCadSketchCells(current, { location: 0 });
    expect(() => prepareCadSketchCells(current, { location: 15 })).toThrow(/overlap|touch/);
    const moved = prepareCadSketchCells(current, { location: 50 });
    expect(moved).not.toBe(first);
    expect(moved.cells.find(cell => cell.reference.boundaryProfileId === 'outer')?.reference).toEqual({ ...refs.outer, voidProfileIds: ['island'] });
    expect(() => moved.resolve([refs.outer])).toThrow(/changed/);
    expect(first.pick({ x: 4, y: 0 })?.reference).toEqual(refs.bore);
  });

  it.each([CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN])('keeps exact pinned $version packages while true module aliases refresh geometry', plugin => {
    const geometry = createCadPluginProfile(plugin), document = parsed({ ...sketch(false), profiles: [{ id: 'gear', name: 'Gear', construction: false,
      geometry: { ...geometry, inputs: { ...geometry.inputs, module: 'metricModule' } } }] }, { metricModule: 3, depth: 5 });
    const current = source(document), saved = JSON.stringify(current);
    const first = prepareCadSketchCells(current, { metricModule: 3, depth: 5 });
    expect(prepareCadSketchCells(current, { metricModule: 3, depth: 35 })).toBe(first);
    const changed = prepareCadSketchCells(current, { metricModule: 4, depth: 35 });
    expect(changed).not.toBe(first); expect(changed.cells[0].areaMm2).toBeGreaterThan(first.cells[0].areaMm2 * 1.5);
    expect(changed.cells[0].boundsMm.maxX).toBeGreaterThan(first.cells[0].boundsMm.maxX + 9);
    expect(() => prepareCadSketchCells(current, { metricModule: 0, depth: 35 })).toThrow();
    expect(JSON.stringify(current)).toBe(saved);
  });

  it('keeps a generic editing lock conservative when its stored input still controls material', () => {
    const plugin: CadPluginPackage = { ...CAD_STAR_PLUGIN, apiVersion: 2, id: 'user.locked-star', rules: { derived: [], constraints: [],
      fields: CAD_STAR_PLUGIN.inputs.map(input => ({ name: input.name, group: 'main', minimum: input.minimum, maximum: input.maximum,
        ...(input.name === 'innerRadius' ? { enabledWhen: { left: 'outerRadius', operator: 'lt' as const, right: 0 } } : {}) })) } };
    const geometry = createCadPluginProfile(plugin), document = parsed({ ...sketch(false), profiles: [{ id: 'star', name: 'Star', construction: false,
      geometry: { ...geometry, inputs: { ...geometry.inputs, innerRadius: 'inner' } } }] }, { inner: 20 });
    const current = source(document), first = prepareCadSketchCells(current, { inner: 20 });
    const changed = prepareCadSketchCells(current, { inner: 10 });
    expect(changed).not.toBe(first);
    expect(first.cells[0].areaMm2).toBeCloseTo(8 * 30 * 20 * Math.sin(Math.PI / 8), 9);
    expect(changed.cells[0].areaMm2).toBeCloseTo(8 * 30 * 10 * Math.sin(Math.PI / 8), 9);
    expect(prepareCadSketchCells(current, { inner: 10, depth: 25 })).toBe(changed);
  });

  it('does not confuse a replacement, renamed or reordered source with the old immutable identity', () => {
    const firstDocument = parsed(sketch()), old = source(firstDocument), prepared = prepareCadSketchCells(old, {});
    const nextDocument = parsed({ ...old, name: 'Renamed sketch', profiles: [...old.profiles].reverse().map(profile => ({ ...profile, name: `New ${profile.name}` })) });
    const next = prepareCadSketchCells(source(nextDocument), {});
    expect(next).not.toBe(prepared); expect(next.cells.map(cell => cell.reference)).toEqual(prepared.cells.map(cell => cell.reference));
    expect(next.cells.find(cell => cell.reference.boundaryProfileId === 'bore')?.boundary.profile.name).toBe('New bore');
    expect(prepared.cells.find(cell => cell.reference.boundaryProfileId === 'bore')?.boundary.profile.name).toBe('bore');
  });

  it('cannot adopt mutable, shallow-frozen or deeply-frozen caller lookalikes as parser-owned immutable sources', () => {
    const document = parsed(rectangle(), { position: 0, size: 20 }), accepted = source(document);
    for (const freeze of [false, true]) {
      const copied = structuredClone(accepted); if (freeze) Object.freeze(copied);
      const first = prepareCadSketchCells(copied, { position: 0, size: 20 });
      expect(prepareCadSketchCells(copied, { position: 0, size: 20 })).not.toBe(first);
      const geometry = copied.profiles[0].geometry; if (geometry.kind !== 'rectangle') throw Error('Rectangle lost');
      Reflect.set(geometry, 'height', 25);
      expect(prepareCadSketchCells(copied, { position: 0, size: 20 }).cells[0].areaMm2).toBe(500);
    }
    const copied = structuredClone(accepted);
    function freeze(value: unknown): void { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
    freeze(copied);
    const first = prepareCadSketchCells(copied, { position: 0, size: 20 });
    expect(prepareCadSketchCells(copied, { position: 0, size: 20 })).not.toBe(first);
    expect(prepareCadSketchCells(accepted, { position: 0, size: 20 })).toBe(prepareCadSketchCells(accepted, { position: 0, size: 20 }));
  });

  it('protects the shared geometry, contour point and region result from consumer poisoning', () => {
    const document = parsed(sketch()), current = source(document), prepared = prepareCadSketchCells(current, {});
    const outer = prepared.cells.find(cell => cell.reference.boundaryProfileId === 'outer'); if (!outer) throw Error('Outer cell lost');
    expect(Reflect.set(outer.boundary.geometry, 'radius', 999)).toBe(false);
    expect(Reflect.set(outer.boundary.point, 'x', 999)).toBe(false);
    expect(Reflect.set(outer.boundary, 'depth', 9)).toBe(false);
    expect(prepared.pick({ x: 8, y: 0 })?.reference).toEqual(refs.outer);
    expect(prepareCadSketchCells(current, {}).cells.find(cell => cell.reference.boundaryProfileId === 'outer')?.areaMm2).toBeCloseTo(64 * Math.PI, 11);
  });

  it('protects nested resolved path coordinates before sharing a pinned gear preparation', () => {
    const geometry = createCadPluginProfile(CAD_GEAR_V3_PLUGIN), document = parsed({ ...sketch(false), profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry }] });
    const current = source(document), prepared = prepareCadSketchCells(current, {}), path = prepared.cells[0].boundary.geometry;
    if (path.kind !== 'path') throw Error('Pinned gear path lost');
    const segment = path.segments[0], point = segment.kind === 'line' ? segment.start : segment.center;
    expect(Reflect.set(point, '0', 999)).toBe(false);
    expect(Reflect.set(path.segments, '0', { kind: 'line', start: [0, 0], end: [1, 1] })).toBe(false);
    expect(prepared.pick({ x: 10, y: 0 })?.reference.boundaryProfileId).toBe('gear');
    expect(prepareCadSketchCells(current, {})).toBe(prepared);
  });

  it('cannot substitute an inherited driver or poison trusted reuse with an accessor environment', () => {
    const document = parsed(rectangle(), { position: 0, size: 20 }), current = source(document), first = prepareCadSketchCells(current, document.parameters);
    const inherited = Object.assign(Object.create({ size: 20 }), { position: 0 });
    expect(() => prepareCadSketchCells(current, inherited)).toThrow(/size/);
    const accessor = { position: 0, get size() { return 30; } };
    expect(prepareCadSketchCells(current, accessor).cells[0].areaMm2).toBe(300);
    expect(prepareCadSketchCells(current, { position: 0, size: 20 })).toBe(first);
  });

  it('updates datum placement and current depth independently of unchanged local cells', () => {
    const datum = { id: 'datum', name: 'Datum', kind: 'datum-plane' as const, suppressed: false,
      definition: { kind: 'world' as const, basePlane: 'XY' as const, origin: [10, 20, 30] as const, rotation: ['tilt', 0, 0] as const } };
    const sourceFeature = { ...rectangle(), plane: { kind: 'datum-plane' as const, featureId: 'datum' }, offset: 'offset' };
    const pad = { id: 'body', name: 'Pad', kind: 'extrude' as const, suppressed: false, sketchId: sourceFeature.id, distance: 'depth', symmetric: false, operation: 'new' as const, targetId: null };
    const document = parseCadDocument({ ...createCadDocument('Placement', 'prepared_placement'), parameters: { position: 0, size: 20, depth: 5, offset: 5, tilt: 0 }, features: [datum, sourceFeature, pad] });
    const current = source(document), cells = prepareCadSketchCells(current, document.parameters), initial = inspectCadExtrudeDepth(document, document.features[2]);
    const parameters = { ...document.parameters, offset: 20, tilt: 30, depth: 30 }, changed = inspectCadExtrudeDepth({ ...document, parameters }, document.features[2]);
    expect(prepareCadSketchCells(current, parameters)).toBe(cells);
    expect(changed?.materialBoundsMm).toBe(initial?.materialBoundsMm); expect(changed?.quantityMm).toBe(30);
    expect(changed?.originMm[0]).toBe(10); expect(changed?.originMm[1]).toBeCloseTo(10, 11); expect(changed?.originMm[2]).toBeCloseTo(30 + 10 * Math.sqrt(3), 11);
    expect(changed?.normalWorld[1]).toBeCloseTo(-0.5, 12); expect(changed?.normalWorld[2]).toBeCloseTo(Math.sqrt(3) / 2, 12);
  });

  it('never retains stale selected material from an untrusted caller alias mutation', () => {
    const raw = rectangle(); const pad = { id: 'body', name: 'Pad', kind: 'extrude' as const, suppressed: false, sketchId: raw.id, distance: 5, symmetric: false, operation: 'new' as const, targetId: null };
    const document = part([raw, pad], { position: 0, size: 20 });
    expect(inspectCadExtrudeDepth(document, pad)?.materialBoundsMm.maxY).toBe(10);
    Reflect.set(raw.profiles[0].geometry, 'height', 25);
    expect(inspectCadExtrudeDepth(document, pad)?.materialBoundsMm.maxY).toBe(25);
  });
});
