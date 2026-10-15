// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { buildCadKernelModel } from './cadKernelModel';
import { prepareCadSolidImport } from './cadKernelImport';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import type { CadFeature, CadPlane, CadSketchFeature } from '../../../domain/cad/cadDocument';
import { inspectCadSketchRegions } from '../../../domain/cad/cadSketchRegionInspection';
import { CadSession } from '../cadSession';
import { refs, sketch, pad, part, stock, pocket } from '../../../domain/cad/__tests__/cadSketchRegionFixtures';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

describe('native selected-cell input', () => {
  it('builds independently expected material after one shared-driver source and reference repair batch', () => {
    const first: CadSketchFeature = { ...sketch(), profiles: sketch().profiles.map(profile => profile.id === 'bore' && profile.geometry.kind === 'circle'
      ? { ...profile, geometry: { ...profile.geometry, x: 'location' } } : profile) };
    const second = { ...first, id: 'second', name: 'Second', offset: 10 };
    const session = new CadSession(part([first, pad([refs.outer]), second, { ...pad([refs.outer]), id: 'second_pad', sketchId: 'second' }], { location: 0 }));
    const before = session.getSnapshot();
    const proposed = { ...second, profiles: second.profiles.filter(profile => profile.id !== 'island').concat([
      { id: 'fresh', name: 'Fresh', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } },
    ]) };
    const earlier = inspectCadSketchRegions(before.document, 'regions', { proposal: { parameterValues: { location: 50 } } }).items.find(cell => cell.boundaryProfileId === 'outer');
    const later = inspectCadSketchRegions(before.document, 'second', { proposal: { sketch: proposed, parameterValues: { location: 50 } } }).items.find(cell => cell.boundaryProfileId === 'outer');
    if (!earlier || !later) throw new Error('Missing preflight cells');
    session.edit([{ kind: 'set-parameter', name: 'location', value: 50 }, { kind: 'update-feature', feature: proposed },
      { kind: 'update-feature', feature: pad([earlier.reference]) }, { kind: 'update-feature', feature: { ...pad([later.reference]), id: 'second_pad', sketchId: 'second' } }], before.version);
    const accepted = session.getSnapshot(), model = buildCadKernelModel(accepted.document);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes).toHaveLength(2);
      const firstBody = model.result.meshes.find(mesh => mesh.featureId === 'pad'), secondBody = model.result.meshes.find(mesh => mesh.featureId === 'second_pad');
      expect(firstBody?.volume).toBeCloseTo(480 * Math.PI, 7); expect(firstBody?.solidCount).toBe(1);
      expect(secondBody?.volume).toBeCloseTo(495 * Math.PI, 7); expect(secondBody?.solidCount).toBe(1);
      expect(firstBody?.bounds).toEqual({ min: [-10, -10, 0], max: [10, 10, 5] });
      expect(secondBody?.bounds).toEqual({ min: [-10, -10, 10], max: [10, 10, 15] });
      expect(accepted.document.features[0]).toEqual(first); expect(accepted.document.features[2]).toEqual(proposed);
      expect(proposed.source).toEqual(second.source);
      session.undo(); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
      session.redo(); expect(session.getSnapshot().document).toEqual(accepted.document);
    } finally { model.dispose(); }
  });

  it('retains the exact whole-sketch legacy pad volume with no selector', () => {
    const document = part([sketch(false), pad()]); const text = JSON.stringify(document);
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].volume).toBeCloseTo(365 * Math.PI, 7);
      expect(model.result.meshes[0].solidCount).toBe(2);
      expect(JSON.stringify(document)).toBe(text);
    } finally { model.dispose(); }
  });

  it.each([
    { name: 'annulus', cells: [refs.outer], volume: 320 * Math.PI, solids: 1, capArea: 128 * Math.PI, wallArea: 160 * Math.PI, radii: [6, 10] },
    { name: 'bore disk', cells: [{ ...refs.bore, voidProfileIds: [] }], volume: 180 * Math.PI, solids: 1, capArea: 72 * Math.PI, wallArea: 60 * Math.PI, radii: [6] },
    { name: 'annulus plus bore', cells: [refs.outer, { ...refs.bore, voidProfileIds: [] }], volume: 500 * Math.PI, solids: 1, capArea: 200 * Math.PI, wallArea: 100 * Math.PI, radii: [10] },
    { name: 'disconnected disk', cells: [refs.separate], volume: 45 * Math.PI, solids: 1, capArea: 18 * Math.PI, wallArea: 30 * Math.PI, radii: [3] },
  ])('extrudes only the $name with independently worked volume and no duplicate interior faces', ({ cells, volume, solids, capArea, wallArea, radii }) => {
    const document = part([sketch(false), pad(cells)]); const text = JSON.stringify(document);
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].volume).toBeCloseTo(volume, 7);
      expect(model.result.meshes[0].solidCount).toBe(solids);
      expect(model.section({ bodyId: 'pad', plane: 'XY', offset: 2 }).contourCount).toBe(cells.length === 1 && cells[0].boundaryProfileId === 'outer' ? 2 : 1);
      const faces = model.inspectTopology({ bodyId: 'pad', expectedBuildId: model.result.buildId,
        selection: { kind: 'page', topology: 'face', offset: 0, limit: 100 } }).descriptors;
      const planes = faces.filter(face => face.kind === 'face' && face.surfaceType === 'plane');
      const cylinders = faces.filter(face => face.kind === 'face' && face.surfaceType === 'cylinder');
      expect(planes.length + cylinders.length).toBe(faces.length);
      expect(planes.reduce((area, face) => area + face.area, 0)).toBeCloseTo(capArea, 7);
      expect(cylinders.reduce((area, face) => area + face.area, 0)).toBeCloseTo(wallArea, 7);
      expect([...new Set(cylinders.map(face => face.radius))].sort((a, b) => a - b)).toEqual(radii);
      expect(JSON.stringify(document)).toBe(text);
    } finally { model.dispose(); }
  });

  it('through-all Pocket removes only the disconnected selected disk from the exact stock', () => {
    const document = part([...stock(), sketch(false), pocket([refs.separate])]); const text = JSON.stringify(document);
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].featureId).toBe('pocket');
      expect(model.result.meshes[0].volume).toBeCloseTo(18000 - 90 * Math.PI, 6);
      expect(model.result.meshes[0].solidCount).toBe(1);
      expect(model.section({ bodyId: 'pocket', plane: 'XY', offset: 5 }).contourCount).toBe(2);
      expect(JSON.stringify(document)).toBe(text);
    } finally { model.dispose(); }
  });

  it.each([
    { name: 'annulus', cells: [refs.outer], removed: 640 * Math.PI, solids: 2, contours: 3 },
    { name: 'bore disk', cells: [{ ...refs.bore, voidProfileIds: [] }], removed: 360 * Math.PI, solids: 1, contours: 2 },
    { name: 'adjacent cells', cells: [refs.outer, { ...refs.bore, voidProfileIds: [] }], removed: 1000 * Math.PI, solids: 1, contours: 2 },
    { name: 'annulus plus disconnected disk', cells: [refs.outer, refs.separate], removed: 730 * Math.PI, solids: 2, contours: 4 },
  ])('Pocket uses only the $name and preserves expected split material', ({ cells, removed, solids, contours }) => {
    const document = parseCadDocument(part([...stock(), sketch(false), pocket(cells)]));
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].volume).toBeCloseTo(18000 - removed, 6);
      expect(model.result.meshes[0].solidCount).toBe(solids);
      expect(model.section({ bodyId: 'pocket', plane: 'XY', offset: 5 }).contourCount).toBe(contours);
    } finally { model.dispose(); }
  });

  it('cancels all nested boundaries in Pad and uses the exact nested cell in Distance Cut', () => {
    const selectedPad = buildCadKernelModel(parseCadDocument(part([sketch(), pad([refs.outer, refs.bore, refs.island])])));
    try {
      expect(selectedPad.result.diagnostics).toEqual([]); expect(selectedPad.result.meshes[0].volume).toBeCloseTo(500 * Math.PI, 7);
      const faces = selectedPad.inspectTopology({ bodyId: 'pad', expectedBuildId: selectedPad.result.buildId,
        selection: { kind: 'page', topology: 'face', offset: 0, limit: 100 } }).descriptors;
      const cylinders = faces.filter(face => face.kind === 'face' && face.surfaceType === 'cylinder');
      expect(cylinders.reduce((area, face) => area + face.area, 0)).toBeCloseTo(100 * Math.PI, 7);
      expect(cylinders.every(face => face.radius === 10)).toBe(true);
    } finally { selectedPad.dispose(); }
    const cut = buildCadKernelModel(parseCadDocument(part([...stock(), sketch(), { ...pad([refs.bore]), operation: 'cut', targetId: 'stock' }])));
    try {
      expect(cut.result.diagnostics).toEqual([]); expect(cut.result.meshes[0].volume).toBeCloseTo(18000 - 160 * Math.PI, 6);
      expect(cut.section({ bodyId: 'pad', plane: 'XY', offset: 2 }).contourCount).toBe(3);
      expect(cut.section({ bodyId: 'pad', plane: 'XY', offset: 7 }).contourCount).toBe(1);
    } finally { cut.dispose(); }
  });

  it('removes only the selected disk through every disconnected target component', () => {
    const upper: readonly CadFeature[] = stock().map(feature => feature.kind === 'sketch' ? { ...feature, id: 'upper_sketch', offset: 20 }
      : feature.kind === 'extrude' ? { ...feature, id: 'upper', sketchId: 'upper_sketch', distance: 5 } : feature);
    const compound: CadFeature = { id: 'compound', name: 'Compound', kind: 'boolean', suppressed: false, targetId: 'stock', toolId: 'upper', operation: 'union' };
    const document = parseCadDocument(part([...stock(), ...upper, compound, sketch(false), { ...pocket([refs.separate]), targetId: 'compound' }]));
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].volume).toBeCloseTo(27000 - 135 * Math.PI, 6); expect(model.result.meshes[0].solidCount).toBe(2);
      for (const offset of [5, 22]) expect(model.section({ bodyId: 'pocket', plane: 'XY', offset }).contourCount).toBe(2);
    } finally { model.dispose(); }
  });

  it.each([
    { plane: 'XY', distance: -5, symmetric: false, min: [-10, -10, -5], max: [10, 10, 0] },
    { plane: 'XZ', distance: 5, symmetric: true, min: [-10, -2.5, -10], max: [10, 2.5, 10] },
    { plane: 'YZ', distance: 5, symmetric: false, min: [0, -10, -10], max: [5, 10, 10] },
  ] satisfies { plane: CadPlane; distance: number; symmetric: boolean; min: number[]; max: number[] }[])('keeps signed/symmetric selected-cell placement on $plane', ({ plane, distance, symmetric, min, max }) => {
    const document = parseCadDocument(part([{ ...sketch(false), plane }, { ...pad([refs.outer, { ...refs.bore, voidProfileIds: [] }]), distance, symmetric }]));
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(500 * Math.PI, 7);
      for (let axis = 0; axis < 3; axis++) {
        expect(model.result.meshes[0].bounds.min[axis]).toBeCloseTo(min[axis], 6);
        expect(model.result.meshes[0].bounds.max[axis]).toBeCloseTo(max[axis], 6);
      }
    } finally { model.dispose(); }
  });

  it('places the selected union on the exact rotated datum normal and preserves its exported solid', async () => {
    const datum: CadFeature = { id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false,
      definition: { kind: 'world', basePlane: 'XY', origin: [10, 20, 30], rotation: [30, 0, 0] } };
    const source = { ...sketch(false), plane: { kind: 'datum-plane' as const, featureId: 'datum' } };
    const document = parseCadDocument(part([datum, source, pad([refs.outer, { ...refs.bore, voidProfileIds: [] }])]));
    const text = JSON.stringify(document), model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(500 * Math.PI, 7);
      const min = [0, 17.5 - 5 * Math.sqrt(3), 25], max = [20, 20 + 5 * Math.sqrt(3), 35 + 2.5 * Math.sqrt(3)];
      for (let axis = 0; axis < 3; axis++) {
        expect(model.result.meshes[0].bounds.min[axis]).toBeCloseTo(min[axis], 6);
        expect(model.result.meshes[0].bounds.max[axis]).toBeCloseTo(max[axis], 6);
      }
      const step = prepareCadSolidImport({ format: 'step', fileName: 'selected.step', encoding: 'utf8', data: await model.export('step').text() });
      expect(step.volume).toBeCloseTo(500 * Math.PI, 6); expect(step.solidCount).toBe(1);
      expect(JSON.stringify(document)).toBe(text);
    } finally { model.dispose(); }
  });

  it('defensively diagnoses changed native input and retains the unconsumed preceding stock', () => {
    const source = { ...sketch(false), profiles: sketch(false).profiles.filter(profile => profile.id !== 'bore') };
    const document = part([...stock(), source, { ...pad([refs.outer]), operation: 'cut', targetId: 'stock' }]);
    const text = JSON.stringify(document), model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toMatchObject([{ code: 'stale-sketch-region', featureId: 'pad' }, { code: 'rebuild-stopped', featureId: 'pad' }]);
      expect(model.result.meshes).toHaveLength(1); expect(model.result.meshes[0]).toMatchObject({ featureId: 'stock', volume: 18000, solidCount: 1 });
      expect(() => model.export('step')).toThrow(); expect(JSON.stringify(document)).toBe(text);
    } finally { model.dispose(); model.dispose(); }
  });

  it('uses selected material bounds for datum precision while a distant unselected contour stays exact', () => {
    const datum: CadFeature = { id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false,
      definition: { kind: 'world', basePlane: 'XY', origin: [10, 20, 30], rotation: [30, 0, 0] } };
    const near = { id: 'near', name: 'Near', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 1 } };
    const distant = { id: 'distant', name: 'Distant', construction: false, geometry: { kind: 'circle' as const, x: 100000000, y: 0, radius: 1 } };
    const source = { ...sketch(false), plane: { kind: 'datum-plane' as const, featureId: 'datum' }, profiles: [near, distant] };
    const selected = { boundaryProfileId: 'near', voidProfileIds: [], ancestorProfileIds: [] };
    const feature = pad([selected]);
    // Independent control: the exact transformed selected body already fits the
    // current placement thresholds when the unused distant contour is absent.
    const control = buildCadKernelModel(parseCadDocument(part([datum, { ...source, profiles: [near] }, pad()])));
    const min = [9, 17.5 - Math.sqrt(3) / 2, 29.5], max = [11, 20 + Math.sqrt(3) / 2, 30.5 + 2.5 * Math.sqrt(3)];
    try {
      expect(control.result.diagnostics).toEqual([]); expect(control.result.meshes[0].volume).toBeCloseTo(5 * Math.PI, 8);
      for (let axis = 0; axis < 3; axis++) {
        expect(control.result.meshes[0].bounds.min[axis]).toBeCloseTo(min[axis], 6);
        expect(control.result.meshes[0].bounds.max[axis]).toBeCloseTo(max[axis], 6);
      }
    } finally { control.dispose(); }
    const original = part([datum, source, feature]), text = JSON.stringify(original);
    const accepted = parseCadDocument(original), model = buildCadKernelModel(accepted);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].volume).toBeCloseTo(5 * Math.PI, 8);
      for (let axis = 0; axis < 3; axis++) {
        expect(model.result.meshes[0].bounds.min[axis]).toBeCloseTo(min[axis], 6);
        expect(model.result.meshes[0].bounds.max[axis]).toBeCloseTo(max[axis], 6);
      }
      expect(JSON.stringify(original)).toBe(text); expect(JSON.stringify(accepted)).toBe(text);
    } finally { model.dispose(); }
    expect(() => parseCadDocument(part([datum, source, pad()]))).toThrow(/datum solid placement/i);
    const whole = buildCadKernelModel(part([...stock(), datum, source, pad()]));
    try {
      expect(whole.result.diagnostics).toMatchObject([{ code: 'unsupported-datum-precision', featureId: 'pad' },
        { code: 'rebuild-stopped', featureId: 'pad' }]);
      expect(whole.result.meshes).toHaveLength(1); expect(whole.result.meshes[0]).toMatchObject({ featureId: 'stock', volume: 18000 });
    } finally { whole.dispose(); }
  });
});
