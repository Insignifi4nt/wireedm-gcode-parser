import { describe, expect, it } from 'vitest';
import { resolveCadSketchRegions, type CadSketchRegion } from '../cadSketchGeometry';
import type { CadSketchFeature } from '../cadDocument';
import { parseCadDocument } from '../cadSchema';
import { CadSession } from '../../../features/cad/cadSession';
import { CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '../plugins/cadPlugins';
import { refs, sketch, pad, part } from './cadSketchRegionFixtures';

const resolve = resolveCadSketchRegions;
const summary = (regions: readonly CadSketchRegion[]) => regions.map(region => ({ id: region.boundary.profile.id,
  voids: region.voids.map(contour => contour.profile.id) }));

describe('explicit closed-cell material selection', () => {
  it('preserves absence as the exact legacy contour order and automatic holes', () => {
    const source = part([sketch(), pad()]);
    const text = JSON.stringify(source);
    expect(JSON.stringify(parseCadDocument(source))).toBe(text);
    expect(summary(resolve(sketch(), {}))).toEqual([
      { id: 'outer', voids: ['bore'] }, { id: 'island', voids: [] }, { id: 'separate', voids: [] },
    ]);
  });

  it.each([
    { name: 'annulus only', cells: [refs.outer], regions: [{ id: 'outer', voids: ['bore'] }] },
    { name: 'void cell only', cells: [refs.bore], regions: [{ id: 'bore', voids: ['island'] }] },
    { name: 'island only', cells: [refs.island], regions: [{ id: 'island', voids: [] }] },
    { name: 'adjacent annulus and void', cells: [refs.outer, refs.bore], regions: [{ id: 'outer', voids: ['island'] }] },
    { name: 'adjacent void and island', cells: [refs.bore, refs.island], regions: [{ id: 'bore', voids: [] }] },
    { name: 'all nested cells', cells: [refs.outer, refs.bore, refs.island], regions: [{ id: 'outer', voids: [] }] },
    { name: 'disconnected cell only', cells: [refs.separate], regions: [{ id: 'separate', voids: [] }] },
  ])('resolves $name from the complete forest and cancels interior shared boundaries', ({ cells, regions }) => {
    const source = sketch(); const text = JSON.stringify(source);
    expect(summary(resolve(source, {}, cells))).toEqual(regions);
    expect(JSON.stringify(source)).toBe(text);
  });

  it('accepts the additive field without inserting, rewriting or normalizing other saved data', () => {
    const source = part([sketch(), pad([refs.outer])]);
    expect(JSON.stringify(parseCadDocument(source))).toBe(JSON.stringify(source));
  });

  it('keeps a saved selection independent of profile names and ordering', () => {
    const source = sketch();
    const renamed = { ...source, profiles: [...source.profiles].reverse().map(profile => ({ ...profile, name: `Renamed ${profile.id}` })) };
    expect(summary(resolve(renamed, {}, [refs.outer, refs.bore]))).toEqual([{ id: 'outer', voids: ['island'] }]);
  });

  it.each([
    { name: 'deleted child', change: (source: CadSketchFeature) => ({ ...source, profiles: source.profiles.filter(profile => profile.id !== 'bore') }) },
    { name: 'construction child', change: (source: CadSketchFeature) => ({ ...source, profiles: source.profiles.map(profile => profile.id === 'bore' ? { ...profile, construction: true } : profile) }) },
    { name: 'moved ancestry', change: (source: CadSketchFeature) => ({ ...source, profiles: source.profiles.map(profile => profile.id === 'bore' && profile.geometry.kind === 'circle' ? { ...profile, geometry: { ...profile.geometry, x: 50 } } : profile) }) },
  ])('refuses $name instead of silently substituting a different area', ({ change }) => {
    expect(() => resolve(change(sketch()), {}, [refs.outer])).toThrow(/region/i);
  });

  it.each([{ cells: [] }, { cells: [refs.outer, refs.outer] }, { cells: [{ ...refs.outer, voidProfileIds: [] }] },
    { cells: [{ ...refs.island, ancestorProfileIds: ['bore', 'outer'] }] }])('rejects empty, duplicate or changed topology signatures', ({ cells }) => {
    expect(() => resolve(sketch(), {}, cells)).toThrow(/region/i);
  });

  it('validates unselected geometry too and preserves existing contact rejection', () => {
    const source = sketch();
    const tangent = { ...source, profiles: source.profiles.map(profile => profile.id === 'separate' && profile.geometry.kind === 'circle'
      ? { ...profile, geometry: { ...profile.geometry, x: 13 } } : profile) };
    expect(() => resolve(tangent, {}, [refs.island])).toThrow('overlap or touch');
  });

  it('rejects structurally contradictory dormant references instead of saving an impossible signature', () => {
    const source = part([sketch(), { ...pad([{ ...refs.outer, ancestorProfileIds: ['bore'] }]), suppressed: true }]);
    const text = JSON.stringify(source);
    expect(() => parseCadDocument(source)).toThrow(/region/i);
    expect(JSON.stringify(source)).toBe(text);
  });

  it('retains dormant signatures exactly and checks changed geometry when the feature is resumed', () => {
    const source = { ...sketch(), profiles: sketch().profiles.filter(profile => profile.id !== 'bore') };
    const dormant = part([source, { ...pad([refs.outer]), suppressed: true }]);
    expect(JSON.stringify(parseCadDocument(dormant))).toBe(JSON.stringify(dormant));
    expect(() => parseCadDocument(part([source, pad([refs.outer])]))).toThrow(/region.*changed/i);
  });

  it('keeps source, bindings and correlated selection in one exact Session undo step and rejects topology changes atomically', () => {
    const source = { ...sketch(), profiles: sketch().profiles.map(profile => profile.id === 'bore' && profile.geometry.kind === 'circle'
      ? { ...profile, geometry: { ...profile.geometry, radius: ' boreRadius ', x: 'location' } } : profile) };
    const original = part([source, pad()], { boreRadius: 6, location: 0 });
    const session = new CadSession(original), initial = session.getSnapshot();
    session.edit([{ kind: 'set-parameter', name: 'boreRadius', value: 7 }, { kind: 'update-feature', feature: pad([refs.outer]) }], initial.version);
    const edited = session.getSnapshot();
    expect(edited.document.features[0]).toEqual(initial.document.features[0]);
    expect(edited.document.parameters.boreRadius).toBe(7); expect(edited.canUndo).toBe(true);
    session.edit([{ kind: 'update-feature', feature: pad([refs.outer]) }], edited.version);
    expect(session.getSnapshot()).toBe(edited);
    expect(() => session.edit([{ kind: 'set-parameter', name: 'location', value: 50 }], edited.version)).toThrow(/region.*changed/i);
    expect(session.getSnapshot()).toBe(edited);
    session.undo(edited.version); expect(session.getSnapshot().document).toEqual(initial.document); expect(session.getSnapshot().canUndo).toBe(false);
    session.redo(session.getSnapshot().version); expect(session.getSnapshot().document).toEqual(edited.document);
    expect(() => session.edit([{ kind: 'rename-document', name: 'Stale' }], initial.version)).toThrow(/draft changed/i);
  });

  it.each([CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN])('preserves pinned gear package $version, inputs and original source when selecting its cell', plugin => {
    const geometry = createCadPluginProfile(plugin);
    const source = { ...sketch(false), profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry },
      { id: 'shaft', name: 'Shaft', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 2 } }] };
    const selected = { boundaryProfileId: 'gear', voidProfileIds: ['shaft'], ancestorProfileIds: [] };
    const original = part([source, pad([selected])]);
    expect(JSON.stringify(parseCadDocument(original))).toBe(JSON.stringify(original));
    expect(resolve(source, {}, [selected])[0].boundary.profile.geometry).toEqual(geometry);
  });
});
