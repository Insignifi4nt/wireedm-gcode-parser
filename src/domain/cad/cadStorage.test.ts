import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { createWorkbenchBackup, removeUnreferencedWorkbenchFiles, restoreWorkbenchBackup } from '@/domain/storage/workbenchBackup';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import type { CadDatumPlaneFeature, CadFeature, CadPocketFeature } from './cadDocument';
import { createCadDocument, parseCadDocument } from './cadSchema';
import { applyCadEdits } from './cadOperations';
import { CAD_GEAR_V2_PLUGIN } from './plugins/cadPlugins';
import { importCadDxfSketch } from './cadDxfImport';
import { importCadDxfCurve } from './cadCurveDxf';
import { cadDocumentPath, listCadDocuments, loadCadDocument, saveCadDocument, MAX_CAD_FILE_BYTES } from './cadStorage';

afterEach(() => vi.restoreAllMocks());

describe.each(['browser-cache', 'directory'] as const)('CAD persistence in %s', kind => {
  let adapter: WorkbenchStorageAdapter;
  beforeEach(() => {
    localStorage.clear();
    adapter = kind === 'browser-cache' ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('cad-test') as unknown as FileSystemDirectoryHandle);
  });
  it('round trips the exact parametric document and detects concurrent saved changes', async () => {
    const document = createCadDocument('Bracket', 'cad_bracket');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const next = await saveCadDocument(adapter, { ...document, name: 'Edited' }, { expectedSavedVersion: saved.savedVersion });
    await expect(saveCadDocument(adapter, { ...document, name: 'Stale' }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('changed in storage');
    expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(next.savedVersion);
    expect((await listCadDocuments(adapter)).entries).toMatchObject([{ id: 'cad_bracket', name: 'Edited' }]);
  });
  it('preserves explicit sketch dimensions and rejects invalid constraint revisions before storage writes', async () => {
    const original = parseCadDocument({ ...createCadDocument('Dimensioned section', 'cad_dimensioned'), parameters: { width: 20 }, features: [
      { id: 'sketch', kind: 'sketch', name: 'Section', suppressed: false, plane: 'XY', offset: 0, profiles: [
        { id: 'profile', name: 'Plate', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 'width', height: 10, cornerRadius: 0 } }
      ] }
    ] });
    const document = applyCadEdits(original, [{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'height', kind: 'dimension', quantity: 'height' } }]);
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const exact = await adapter.readExactText?.(cadDocumentPath(document.id));
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Missing sketch');
    const dimension = sketch.profiles[0].constraints?.[0]; if (!dimension) throw new Error('Missing dimension');
    const invalid = { ...document, features: [{ ...sketch, profiles: [{ ...sketch.profiles[0], constraints: [
      dimension, { ...dimension, id: 'other-height' }
    ] }] }] };
    await expect(saveCadDocument(adapter, invalid, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow();
    expect(await adapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(saved.savedVersion);
    expect(original.features[0]).not.toHaveProperty('profiles.0.constraints');
  });
  it('round trips named plugin dimensions, group moves and historical provenance without rewriting the pinned package', async () => {
    const document = applyCadEdits(createCadDocument('Grouped gear', 'cad_grouped_gear'), [
      { kind: 'add-feature', feature: { id: 'section', kind: 'sketch', name: 'Section', suppressed: false, plane: 'XY', offset: 0, profiles: [] } },
      { kind: 'add-plugin-profile', sketchId: 'section', profileId: 'gear', name: 'Gear', package: CAD_GEAR_V2_PLUGIN, groupId: 'gear_group' },
      { kind: 'set-parameter-group', group: { id: 'shared', name: 'Shared dimensions' } },
      { kind: 'rename-parameter', name: 'p_gear_module', newName: 'gear_module' },
      { kind: 'move-parameter', name: 'gear_module', groupId: 'shared' }
    ]);
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const loaded = (await loadCadDocument(adapter, document.id)).document;
    expect(loaded).toEqual(document);
    expect(loaded.parameterMetadata?.gear_module).toMatchObject({ groupId: 'shared', source: { kind: 'plugin', profileId: 'gear', inputName: 'module', packageVersion: '2.0.0' } });
    const original = await adapter.readText(cadDocumentPath(document.id));
    await expect(saveCadDocument(adapter, { ...loaded, parameterMetadata: { ...loaded.parameterMetadata,
      gear_module: { source: { kind: 'manual' }, groupId: 'missing' } } }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('missing group');
    expect(await adapter.readText(cadDocumentPath(document.id))).toBe(original);
    const withoutFeature = applyCadEdits(loaded, [{ kind: 'delete-feature', featureId: 'section', cascade: true }]);
    await saveCadDocument(adapter, withoutFeature, { expectedSavedVersion: saved.savedVersion });
    expect((await loadCadDocument(adapter, document.id)).document.parameterMetadata).toEqual(document.parameterMetadata);
  });
  it('persists Sweep references, parameter expressions and exact Curve originals without writing an invalid revision', async () => {
    const text = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n10\r\n0\r\n20\r\n0\r\n11\r\n20\r\n21\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
    const curve = importCadDxfCurve({ fileName: 'Rail.dxf', text, units: 'mm', curveId: 'rail' }).curve;
    const document = parseCadDocument({ ...createCadDocument('Swept reference', 'cad_sweep_save'), parameters: { radius: 2 }, features: [
      { kind: 'sketch', id: 'section', name: 'Section', suppressed: false, plane: 'YZ', offset: 0,
        profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 'radius' } }] },
      curve, { kind: 'sweep', id: 'sweep', name: 'Sweep', suppressed: false, sketchId: 'section', curveId: 'rail', operation: 'new', targetId: null },
    ] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id); const exact = await adapter.readExactText?.(path);
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    await expect(saveCadDocument(adapter, { ...document, parameters: { radius: -1 } }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow();
    expect(await adapter.readExactText?.(path)).toBe(exact);
    const changed = await saveCadDocument(adapter, { ...document, parameters: { radius: 3 } }, { expectedSavedVersion: saved.savedVersion });
    const reopened = await loadCadDocument(adapter, document.id);
    expect(reopened).toEqual(changed);
    expect(reopened.document.features[0]).toMatchObject({ profiles: [{ geometry: { radius: 'radius' } }] });
    expect(reopened.document.features[1]).toMatchObject({ source: { text }, segments: curve.segments });
    expect(reopened.document.features[2]).toEqual(document.features[2]);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('round trips Through-all Pocket, its exact sources and editable expressions without saving inactive dimensions', async () => {
    const text = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nCIRCLE\r\n10\r\n0\r\n20\r\n0\r\n40\r\n2\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
    const imported = importCadDxfSketch({ fileName: 'Profile.dxf', text, units: 'mm', sketchId: 'section' }).sketch;
    const section = { ...imported, offset: 'station', profiles: imported.profiles.map(profile => ({ ...profile,
      geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 'radius' } })) };
    const pocket: CadPocketFeature = { id: 'pocket', name: 'Through all', kind: 'pocket', suppressed: false,
      sketchId: 'section', targetId: 'target', extent: { kind: 'through-all', direction: 'both' } };
    const originalStep = '\uFEFFISO-10303-21;\r\n/* exact source 名称 */\r\nEND-ISO-10303-21;\r\n';
    const document = parseCadDocument({ ...createCadDocument('Pocket originals', 'cad_pocket_save'), parameters: { radius: 2, station: 3 }, features: [
      section, { kind: 'imported', id: 'target', name: 'Original target', suppressed: false,
        source: { format: 'step', fileName: 'Target.step', encoding: 'utf8', data: originalStep } }, pocket,
    ] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id); const original = await adapter.readExactText?.(path);
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const writes = vi.spyOn(adapter, 'writeText');
    for (const extra of [{ distance: 10 }, { operation: 'cut' }, { symmetric: true },
      { extent: { kind: 'through-all' as const, direction: 'both' as const, distance: 10 } }]) {
      const invalid = { ...document, features: [section, document.features[1], { ...pocket, ...extra }] };
      await expect(saveCadDocument(adapter, invalid, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow();
    }
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    const next = await saveCadDocument(adapter, { ...document, parameters: { radius: 4, station: -20 } },
      { expectedSavedVersion: saved.savedVersion });
    const reopened = await loadCadDocument(adapter, document.id);
    expect(reopened).toEqual(next);
    expect(reopened.document.features[0]).toMatchObject({ source: { text }, offset: 'station', profiles: [{ geometry: { radius: 'radius' } }] });
    expect(reopened.document.features[1]).toMatchObject({ source: { data: originalStep } });
    expect(reopened.document.features[2]).toEqual(pocket);
  });
  it('retains datum expressions and local import originals, rejecting unavailable or unsupported placements before writes', async () => {
    const text = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nCIRCLE\r\n10\r\n0\r\n20\r\n0\r\n40\r\n2\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
    const railText = text.replace('CIRCLE\r\n10', 'LINE\r\n10').replace('40\r\n2', '11\r\n20\r\n21\r\n0');
    const imported = importCadDxfSketch({ fileName: 'Section.dxf', text, units: 'mm', sketchId: 'section' }).sketch;
    const rail = importCadDxfCurve({ fileName: 'Rail.dxf', text: railText, units: 'mm', curveId: 'rail' }).curve;
    const datum: CadDatumPlaneFeature = { kind: 'datum-plane', id: 'plane', name: 'Tilt', suppressed: false,
      definition: { kind: 'world', basePlane: 'XZ', origin: ['position', -24, 11], rotation: ['angle', -37, 61] } };
    const plane = { kind: 'datum-plane', featureId: 'plane' } as const;
    const section = { ...imported, plane, offset: 'station' };
    const curve = { ...rail, plane, offset: 'station' };
    const pad: Extract<CadFeature, { kind: 'extrude' }> = { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false,
      sketchId: 'section', operation: 'new', targetId: null, distance: 'depth', symmetric: true };
    const document = parseCadDocument({ ...createCadDocument('Datum originals', 'cad_datum_save'),
      parameters: { position: 37, angle: 23, station: -3, depth: -10 }, features: [datum, section, curve, pad] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const exact = await adapter.readExactText?.(path);
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const writes = vi.spyOn(adapter, 'writeText');
    await expect(saveCadDocument(adapter, { ...document, parameters: { ...document.parameters, position: 1e8 } },
      { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('native precision');
    await expect(saveCadDocument(adapter, { ...document, features: [{ ...datum, suppressed: true }, section, curve, pad] },
      { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('must precede');
    const pocket: CadPocketFeature = { kind: 'pocket', id: 'pocket', name: 'Pocket', suppressed: false,
      sketchId: 'section', targetId: 'pad', extent: { kind: 'through-all', direction: 'both' } };
    await expect(saveCadDocument(adapter, { ...document, features: [...document.features, pocket] },
      { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('does not yet support datum placement');
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(exact);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    await saveCadDocument(adapter, { ...document, parameters: { ...document.parameters, angle: 90, station: 4 } },
      { expectedSavedVersion: saved.savedVersion });
    const reopened = (await loadCadDocument(adapter, document.id)).document;
    expect(reopened.features[0]).toEqual(datum);
    expect(reopened.features[1]).toMatchObject({ source: { text }, plane, offset: 'station', profiles: imported.profiles });
    expect(reopened.features[2]).toMatchObject({ source: { text: railText }, plane, segments: rail.segments });
  });
  it('round trips frame-aware Loft expressions and exact section sources while rejecting collapsed or incompatible stations before writes', async () => {
    const text = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nCIRCLE\r\n10\r\n0\r\n20\r\n0\r\n40\r\n5\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
    const imported = importCadDxfSketch({ fileName: 'Loft section.dxf', text, units: 'mm', sketchId: 'first' }).sketch;
    const datum: CadDatumPlaneFeature = { kind: 'datum-plane', id: 'plane', name: 'Tilted sections', suppressed: false,
      definition: { kind: 'world', basePlane: 'XY', origin: [37, -24, 11], rotation: ['tilt', -37, 61] } };
    const plane = { kind: 'datum-plane', featureId: 'plane' } as const;
    const first = { ...imported, plane, offset: 2 };
    const last = { ...first, id: 'last', name: 'Last section', offset: 'height' };
    const loft: Extract<CadFeature, { kind: 'loft' }> = { kind: 'loft', id: 'loft', name: 'Loft', suppressed: false,
      sketchIds: ['first', 'last'], ruled: false, operation: 'new', targetId: null };
    const document = parseCadDocument({ ...createCadDocument('Placed Loft', 'cad_loft_frames'),
      parameters: { tilt: 23, height: 20 }, features: [datum, first, last, loft] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id); const original = await adapter.readExactText?.(path);
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const writes = vi.spyOn(adapter, 'writeText');
    await expect(saveCadDocument(adapter, { ...document, parameters: { ...document.parameters, height: 2 } },
      { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('separated');
    await expect(saveCadDocument(adapter, { ...document, features: [datum, first, { ...last, plane: 'XZ' }, loft] },
      { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('same oriented');
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    await saveCadDocument(adapter, { ...document, parameters: { tilt: 90, height: 30 } }, { expectedSavedVersion: saved.savedVersion });
    const reopened = (await loadCadDocument(adapter, document.id)).document;
    expect(reopened.features[0]).toEqual(datum);
    expect(reopened.features[1]).toMatchObject({ source: { text }, plane, profiles: imported.profiles });
    expect(reopened.features[2]).toMatchObject({ source: { text }, offset: 'height' });
    expect(reopened.features[3]).toEqual(loft);
  });
  it('retains datum Sweep sources and editable frame/length expressions, refusing invalid placement before writes', async () => {
    const railText = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nLINE\r\n10\r\n0\r\n20\r\n0\r\n11\r\n20\r\n21\r\n0\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
    const sectionText = railText.replace('LINE\r\n10', 'CIRCLE\r\n10').replace('11\r\n20\r\n21\r\n0', '40\r\n1');
    const importedSection = importCadDxfSketch({ fileName: 'Section.dxf', text: sectionText, units: 'mm', sketchId: 'section' }).sketch;
    const importedRail = importCadDxfCurve({ fileName: 'Rail.dxf', text: railText, units: 'mm', curveId: 'rail' }).curve;
    const railPlane: CadDatumPlaneFeature = { kind: 'datum-plane', id: 'rail_plane', name: 'Rail plane', suppressed: false,
      definition: { kind: 'world', basePlane: 'XY', origin: [37, -24, 11], rotation: ['railTilt', 'railPitch', 61] } };
    const sectionPlane: CadDatumPlaneFeature = { ...railPlane, id: 'section_plane', name: 'Section plane',
      definition: { ...railPlane.definition, basePlane: 'YZ', rotation: ['sectionTilt', 'sectionPitch', 61] } };
    const section = { ...importedSection, plane: { kind: 'datum-plane' as const, featureId: 'section_plane' },
      profiles: importedSection.profiles.map(profile => ({ ...profile, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 'radius' } })) };
    const rail = { ...importedRail, plane: { kind: 'datum-plane' as const, featureId: 'rail_plane' },
      segments: [{ kind: 'line' as const, start: [0, 0] as const, end: ['length', 0] as const }] };
    const sweep: Extract<CadFeature, { kind: 'sweep' }> = { kind: 'sweep', id: 'sweep', name: 'Sweep', suppressed: false,
      sketchId: 'section', curveId: 'rail', operation: 'new', targetId: null };
    const document = parseCadDocument({ ...createCadDocument('Placed Sweep', 'cad_sweep_frames'),
      parameters: { railTilt: 23, sectionTilt: 23, railPitch: -37, sectionPitch: -37, radius: 1, length: 20 }, features: [railPlane, sectionPlane, section, rail, sweep] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id); const exact = await adapter.readExactText?.(path);
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    const writes = vi.spyOn(adapter, 'writeText');
    await expect(saveCadDocument(adapter, { ...document, parameters: { ...document.parameters, sectionPitch: -36.9 } },
      { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('actual curve start');
    expect(writes).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(exact);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    await saveCadDocument(adapter, { ...document, parameters: { railTilt: 90, sectionTilt: 90, railPitch: -20, sectionPitch: -20, radius: 2, length: 30 } },
      { expectedSavedVersion: saved.savedVersion });
    const reopened = (await loadCadDocument(adapter, document.id)).document;
    expect(reopened.features[0]).toEqual(railPlane); expect(reopened.features[1]).toEqual(sectionPlane);
    expect(reopened.features[2]).toMatchObject({ source: { text: sectionText }, profiles: [{ geometry: { radius: 'radius' } }] });
    expect(reopened.features[3]).toMatchObject({ source: { text: railText }, segments: [{ end: ['length', 0] }] });
    expect(reopened.features[4]).toEqual(sweep);
  });
  it('preserves an external edit made after the optimistic read and before the transaction captures its original', async () => {
    const document = parseCadDocument({ ...createCadDocument('Original', 'cad_external_race'), features: [{
      id: 'source', name: 'Exact original', kind: 'imported', suppressed: true,
      source: { format: 'step', fileName: 'original.step', encoding: 'utf8', data: '\uFEFFISO-10303-21;\r\n/* Original 名称 */\r\nEND-ISO-10303-21;\r\n' },
    }] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const original = await adapter.readExactText?.(path);
    if (!original || !adapter.readBoundedExactText) throw new Error('Expected exact bounded adapter');
    const external = original.replace('"name":"Original"', '"name":"Externally edited"');
    const read = adapter.readBoundedExactText.bind(adapter);
    let changed = false;
    vi.spyOn(adapter, 'readBoundedExactText').mockImplementation(async (target, limit, signal) => {
      const result = await read(target, limit, signal);
      if (target === path && !changed) { changed = true; await adapter.writeText(path, external); }
      return result;
    });
    await expect(saveCadDocument(adapter, { ...document, name: 'Stale local draft' }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow('changed in storage');
    expect(await adapter.readExactText?.(path)).toBe(external);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('preserves embedded source text and bytes through save, conflict and backup in both adapters', async () => {
    const opened = await initializeWorkbenchCatalog(adapter);
    if (!opened.ok) throw new Error(opened.error.message);
    const originalDxf = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nCIRCLE\r\n10\r\n0\r\n20\r\n0\r\n40\r\n2\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
    const sketch = importCadDxfSketch({ fileName: 'source.dxf', text: originalDxf, units: 'mm' }).sketch;
    const document = parseCadDocument({ ...createCadDocument('Imported originals', 'cad_originals'), features: [sketch,
      { id: 'step', name: 'STEP source', kind: 'imported', suppressed: true, source: { format: 'step', fileName: 'source.step', encoding: 'utf8', data: '\uFEFFISO-10303-21;\r\n/* 名称 */\r\nEND-ISO-10303-21;\r\n' } },
      { id: 'stl', name: 'STL source', kind: 'imported', suppressed: true, source: { format: 'stl', fileName: 'source.stl', encoding: 'base64', data: 'AP/+AR+AAw==', units: 'inch' } }
    ] });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const exact = await adapter.readExactText?.(cadDocumentPath(document.id));
    expect((await loadCadDocument(adapter, document.id)).document).toEqual(document);
    await expect(saveCadDocument(adapter, { ...document, name: 'Stale source' }, { expectedSavedVersion: 'wrong-fingerprint' })).rejects.toThrow();
    expect(await adapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    const backup = await createWorkbenchBackup(opened.workbench);
    const restoredAdapter = createBrowserCacheAdapter(localStorage, { namespace: 'restored-originals' });
    const restored = await initializeWorkbenchCatalog(restoredAdapter);
    if (!restored.ok) throw new Error(restored.error.message);
    await restoreWorkbenchBackup(restoredAdapter, backup);
    expect(await restoredAdapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    expect((await loadCadDocument(restoredAdapter, document.id)).document).toEqual(document);
    expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(saved.savedVersion);
  });
  it('rejects invalid data and prewrite cancellation without changing exact originals', async () => {
    const document = createCadDocument('Original', 'cad_original');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const original = await adapter.readExactText?.(path);
    await expect(saveCadDocument(adapter, { ...document, parameters: { width: Infinity } }, { expectedSavedVersion: saved.savedVersion })).rejects.toThrow();
    const controller = new AbortController();
    await expect(saveCadDocument(adapter, { ...document, name: 'Cancelled' }, { expectedSavedVersion: saved.savedVersion,
      beforeWrite: () => { controller.abort(); controller.signal.throwIfAborted(); } })).rejects.toThrow();
    expect(await adapter.readExactText?.(path)).toBe(original);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('rolls back an interrupted update before reopening and permits a safe retry', async () => {
    const document = createCadDocument('Original', 'cad_interrupted');
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const original = await adapter.readExactText?.(path);
    const next = JSON.stringify({ format: 'wireedm-cad-save', schemaVersion: 1, updatedAt: new Date().toISOString(), document: { ...document, name: 'Next' } });
    await adapter.ensureDirectory('transactions');
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1,
      files: [{ path, previous: original, next }, { path: 'cad/receipt.json', previous: null, next: 'receipt' }] }));
    await adapter.writeText(path, next);
    expect((await loadCadDocument(adapter, document.id)).document.name).toBe('Original');
    expect(await adapter.readExactText?.(path)).toBe(original);
    const retry = await saveCadDocument(adapter, { ...document, name: 'Retry' }, { expectedSavedVersion: saved.savedVersion });
    expect(retry.document.name).toBe('Retry');
  });
  it('prepares the save receipt before writing and makes no writes if hashing fails', async () => {
    const document = createCadDocument('Receipt', 'cad_receipt');
    const write = adapter.writeText.bind(adapter);
    const writes = vi.spyOn(adapter, 'writeText');
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('Hash unavailable'));
    await expect(saveCadDocument(adapter, document, { expectedSavedVersion: null })).rejects.toThrow('Hash unavailable');
    expect(writes).not.toHaveBeenCalled();
    digest.mockRestore();
    const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
    let started = false;
    writes.mockImplementation(async (path, text) => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) started = true;
      await write(path, text);
    });
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((algorithm, data) => {
      if (started) throw new Error('Receipt hashing happened after the write');
      return originalDigest(algorithm, data);
    });
    const saved = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    expect(saved.savedVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(await adapter.readText(cadDocumentPath(document.id))).toContain('Receipt');
  });
  it.each([false, true])('reports the actual outcome after journal-start cancellation, write failure=%s', async failWrite => {
    const document = createCadDocument('Original', 'cad_late_cancel');
    const original = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const path = cadDocumentPath(document.id);
    const exact = await adapter.readExactText?.(path);
    const controller = new AbortController();
    const write = adapter.writeText.bind(adapter);
    let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (target, text) => {
      if (target === path && failWrite && !failed) { failed = true; throw new Error('Disk full'); }
      await write(target, text);
      if (target === WORKBENCH_FILE_TRANSACTION_PATH) controller.abort();
    });
    const pending = saveCadDocument(adapter, { ...document, name: 'Committed' }, {
      expectedSavedVersion: original.savedVersion, signal: controller.signal
    });
    if (failWrite) {
      await expect(pending).rejects.toThrow('Disk full');
      expect(await adapter.readExactText?.(path)).toBe(exact);
    } else {
      const receipt = await pending;
      expect(controller.signal.aborted).toBe(true);
      expect(receipt.document.name).toBe('Committed');
      expect((await loadCadDocument(adapter, document.id)).savedVersion).toBe(receipt.savedVersion);
    }
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('returns the committed save when cleanup fails and recovers without reverting it', async () => {
    const document = createCadDocument('Committed', 'cad_cleanup');
    const remove = adapter.deleteText.bind(adapter);
    vi.spyOn(adapter, 'deleteText').mockRejectedValueOnce(new Error('Cleanup interrupted')).mockImplementation(remove);
    const receipt = await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    const reopened = await loadCadDocument(adapter, document.id);
    expect(reopened).toEqual(receipt);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    const edited = await saveCadDocument(adapter, { ...document, name: 'Next' }, { expectedSavedVersion: receipt.savedVersion });
    expect(edited.document.name).toBe('Next');
  });
  it('retains malformed documents with diagnostics instead of hiding or rewriting them', async () => {
    await adapter.ensureDirectory('cad/documents');
    await adapter.writeText('cad/documents/cad_broken.cad.json', '{original broken bytes');
    const library = await listCadDocuments(adapter);
    expect(library.diagnostics).toHaveLength(1);
    expect(await adapter.readExactText?.('cad/documents/cad_broken.cad.json')).toBe('{original broken bytes');
  });
  it('sorts valid saved timestamps by their actual time while preserving their exact originals', async () => {
    const saves = [
      { document: createCadDocument('Earlier', 'cad_earlier'), updatedAt: '2026-10-13T07:00:00+02:00' },
      { document: createCadDocument('Later', 'cad_later'), updatedAt: '2026-10-13T06:00:00Z' },
    ];
    const originals = saves.map(save => JSON.stringify({ format: 'wireedm-cad-save', schemaVersion: 1, ...save }));
    for (let index = 0; index < saves.length; index++) await adapter.writeText(cadDocumentPath(saves[index].document.id), originals[index]);
    expect((await listCadDocuments(adapter)).entries.map(entry => entry.id)).toEqual(['cad_later', 'cad_earlier']);
    for (let index = 0; index < saves.length; index++) expect(await adapter.readExactText?.(cadDocumentPath(saves[index].document.id))).toBe(originals[index]);
  });
  it('rejects oversized stored originals without truncating or replacing them, including compressed cache files', async () => {
    const document = createCadDocument('Original', 'cad_oversized'); const path = cadDocumentPath(document.id);
    const exact = JSON.stringify({ format: 'wireedm-cad-save', schemaVersion: 1, updatedAt: '2026-10-13T00:00:00.000Z', document })
      + ' '.repeat(MAX_CAD_FILE_BYTES);
    await adapter.writeText(path, exact);
    const write = vi.spyOn(adapter, 'writeText');
    await expect(loadCadDocument(adapter, document.id)).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(saveCadDocument(adapter, document, { expectedSavedVersion: null })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    const library = await listCadDocuments(adapter);
    expect(library.entries).toEqual([]); expect(library.diagnostics).toMatchObject([{ path, message: expect.stringContaining('4 MiB') }]);
    expect(write).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.(path)).toBe(exact);
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('includes CAD in full backup and excludes it from unreferenced-file cleanup', async () => {
    const opened = await initializeWorkbenchCatalog(adapter);
    if (!opened.ok) throw new Error(opened.error.message);
    const document = createCadDocument('Backed up', 'cad_backup');
    await saveCadDocument(adapter, document, { expectedSavedVersion: null });
    const retained = [
      { path: 'cad/plugins/user.gear/1.0.0.cad-plugin.json', text: '{ preserved plugin original }\r\n' },
      { path: 'cad/documents/cad_broken.cad.json', text: '\ufeff{broken original\r\n' },
      { path: 'CAD/recovery/part.cad.json', text: 'unindexed original\r\n' }
    ];
    for (const file of retained) await adapter.writeText(file.path, file.text);
    const backup = await createWorkbenchBackup(opened.workbench);
    expect(backup.unreferencedPaths).not.toContain(cadDocumentPath(document.id));
    for (const file of retained) {
      expect(backup.unreferencedPaths).not.toContain(file.path);
      await expect(removeUnreferencedWorkbenchFiles(opened.workbench, backup, [file.path])).rejects.toThrow('explicitly selected');
    }
    const restoredAdapter = createBrowserCacheAdapter(localStorage, { namespace: 'restored-cad' });
    const restored = await initializeWorkbenchCatalog(restoredAdapter);
    if (!restored.ok) throw new Error(restored.error.message);
    await restoreWorkbenchBackup(restoredAdapter, backup);
    expect((await loadCadDocument(restoredAdapter, document.id)).document).toEqual(document);
    for (const file of retained) expect(await restoredAdapter.readExactText?.(file.path)).toBe(file.text);
  });
});
