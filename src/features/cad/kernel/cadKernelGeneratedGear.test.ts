// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { DEFAULT_CAD_GEAR } from '../../../domain/cad/cadGear';
import { resolveConfiguredCadGear, resolveGeneratedCadGear } from '../../../domain/cad/cadGearGenerated';
import { createCadDocument, parseCadDocument } from '../../../domain/cad/cadSchema';
import { cadEntitiesToCam } from '../../../domain/cad/cadCam';
import { CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, createCadPluginProfile, inspectCadPluginProfile } from '../../../domain/cad/plugins/cadPlugins';
import { MAX_CAD_TOPOLOGY_PER_BODY } from '../../../domain/cad/cadTopology';
import { parsePortableUpid } from '../../../domain/upid/portableUpidProject';
import { buildCadKernelModel } from './cadKernelModel';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

it.each([{ teeth: 18, symmetric: false }, { teeth: 50, symmetric: true }])('constructs the generated $teeth-tooth boundary as native material, retaining bore and exact circle edges in a CAM section', ({ teeth, symmetric }) => {
  const gear = resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, teeth }, {}), profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
  const doc = parseCadDocument({ ...createCadDocument('Generated gear', 'generated_gear'), features: [
    { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'gear', name: 'Gear', construction: false, geometry: { ...profile, inputs: { ...profile.inputs, module: '3', teeth: String(teeth) } } },
      { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 6 } },
    ] },
    { id: 'solid', kind: 'extrude', name: 'Solid', suppressed: false, sketchId: 'outline', distance: '10', symmetric, operation: 'new', targetId: null },
  ] });
  // Independent Green integral for the actual chorded boundary plus exact circles.
  const area = gear.segments.reduce((sum, segment) => sum + (segment.kind === 'line'
    ? (segment.start[0] * segment.end[1] - segment.start[1] * segment.end[0]) / 2
    : segment.radius ** 2 * segment.sweep * Math.PI / 360), 0) - 36 * Math.PI;
  const model = buildCadKernelModel(doc);
  try {
    expect(model.result.diagnostics).toEqual([]);
    expect(model.result.meshes).toHaveLength(1);
    expect(model.result.meshes[0].volume).toBeCloseTo(area * 10, 6);
    const topology = new Set([...model.result.meshes[0].faceGroups, ...model.result.meshes[0].edgeGroups].map(group => group.key));
    expect(topology.size).toBeLessThanOrEqual(MAX_CAD_TOPOLOGY_PER_BODY);
    expect(topology.size).toBe(4 * gear.edgeCount + 10); // Native bore uses two semicircle edges/walls.
    const section = model.section({ bodyId: 'solid', plane: 'XY', offset: symmetric ? 0 : 5 });
    expect(section.contourCount).toBe(2);
    const circles = section.entities.filter(entity => entity.type === 'arc' || entity.type === 'circle');
    expect(circles.filter(entity => entity.radius > 6.000001)).toHaveLength(2 * teeth);
    expect(circles.filter(entity => Math.abs(entity.radius - 6) < 1e-6).length).toBeGreaterThan(0);
    const cam = cadEntitiesToCam(section.entities, doc);
    expect(cam.contours).toHaveLength(2);
    expect(cam.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('trochoidal root') }));
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: cam.schemaVersion, document: cam }))).toMatchObject({ ok: true });
  } finally { model.dispose(); }
}, 60_000);

it('preflights larger gear topology without silently changing requested precision', () => {
  const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
  const doc = parseCadDocument({ ...createCadDocument('Over-budget gear', 'over_budget_gear'), features: [
    { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'gear', name: 'Gear', construction: false, geometry: { ...profile, inputs: { ...profile.inputs, teeth: 60 } } },
    ] },
    { id: 'solid', kind: 'extrude', name: 'Solid', suppressed: false, sketchId: 'outline', distance: 10, symmetric: true, operation: 'new', targetId: null },
  ] });
  const original = structuredClone(doc), model = buildCadKernelModel(doc);
  try {
    expect(model.result.meshes).toEqual([]);
    expect(model.result.diagnostics[0]).toMatchObject({ featureId: 'solid', code: 'topology-limit', message: expect.stringContaining('custom curve tolerance') });
    expect(doc).toEqual(original);
  } finally { model.dispose(); }
});

it('builds and sections a custom cutter-root gear using its correlated shift and certified boundary', () => {
  const profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
  profile.inputs.cutterTipMode = 1; profile.inputs.cutterTipRadius = 0.5;
  const values = inspectCadPluginProfile(profile, {}).values;
  const gear = resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, profileShift: values.effectiveShift, cutterTipRadius: values.effectiveCutterTipRadius }, {});
  const doc = parseCadDocument({ ...createCadDocument(), features: [
    { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'gear', name: 'Gear', construction: false, geometry: profile },
      { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 6 } },
    ] },
    { id: 'solid', kind: 'extrude', name: 'Solid', suppressed: false, sketchId: 'outline', distance: 10, symmetric: true, operation: 'new', targetId: null },
  ] });
  const area = gear.segments.reduce((sum, segment) => sum + (segment.kind === 'line'
    ? (segment.start[0] * segment.end[1] - segment.start[1] * segment.end[0]) / 2
    : segment.radius ** 2 * segment.sweep * Math.PI / 360), 0) - 36 * Math.PI;
  const original = structuredClone(doc), model = buildCadKernelModel(doc);
  try {
    expect(values.effectiveShift).toBeGreaterThan(0);
    expect(model.result.diagnostics).toEqual([]);
    expect(model.result.meshes).toHaveLength(1);
    expect(model.result.meshes[0].volume).toBeCloseTo(area * 10, 6);
    const section = model.section({ bodyId: 'solid', plane: 'XY', offset: 0 });
    expect(section.contourCount).toBe(2);
    expect(section.entities.filter(entity => entity.type === 'line')).toHaveLength(gear.segments.filter(segment => segment.kind === 'line').length);
    expect(doc).toEqual(original);
  } finally { model.dispose(); }
}, 60_000);

it('preflights configured gear topology before creating an oversized native solid', () => {
  const profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN); profile.inputs.teeth = 120;
  const doc = parseCadDocument({ ...createCadDocument(), features: [
    { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry: profile }] },
    { id: 'solid', kind: 'extrude', name: 'Solid', suppressed: false, sketchId: 'outline', distance: 10, symmetric: true, operation: 'new', targetId: null },
  ] });
  const model = buildCadKernelModel(doc);
  try {
    expect(model.result.meshes).toEqual([]);
    expect(model.result.diagnostics[0]).toMatchObject({ code: 'topology-limit', featureId: 'solid' });
  } finally { model.dispose(); }
});
