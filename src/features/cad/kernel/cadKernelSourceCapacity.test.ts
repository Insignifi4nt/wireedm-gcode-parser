// @vitest-environment node
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { exportSTEP, makeBox, setOC } from 'replicad';
import { beforeAll, expect, it } from 'vitest';
import { cadBytesToBase64, isCadSolidImportResult, type CadSolidImportSource } from '../../../domain/cad/cadImports';
import { createCadDocument, parseCadDocument } from '../../../domain/cad/cadSchema';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '../../../domain/cad/plugins/cadPlugins';
import { buildCadKernelModel } from './cadKernelModel';
import { prepareCadSolidImport } from './cadKernelImport';
import { createCadKernelRuntime } from './cadKernelRuntime';
import { isCadKernelReply } from './cadKernelProtocol';

beforeAll(async () => { setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)),
  print: () => undefined, printErr: () => undefined })); }, 60_000);

function binaryStlVolume(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(80, true);
  let volume = 0;
  for (let index = 0; index < count; index++) {
    const offset = 84 + index * 50 + 12;
    const coordinates = Array.from({ length: 9 }, (_, coordinate) => view.getFloat32(offset + coordinate * 4, true));
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = coordinates;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

it.each(['step', 'stl'] as const)('reimports the unchanged default gear %s export above the former source or facet ceiling with exact original and native material', async format => {
  const original = parseCadDocument({ ...createCadDocument('Gear', 'gear_capacity'), features: [
    { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'gear', name: 'Gear', construction: false, geometry: createCadPluginProfile(CAD_GEAR_V3_PLUGIN) },
      { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 6 } },
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 5, symmetric: false, operation: 'new', targetId: null },
  ] }), bytesBefore = JSON.stringify(original), model = buildCadKernelModel(original);
  try {
    expect(model.result.diagnostics).toEqual([]);
    const blob = model.export(format), bytes = new Uint8Array(await blob.arrayBuffer());
    const source: CadSolidImportSource = format === 'step'
      ? { format, fileName: 'gear.step', encoding: 'utf8', data: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
      : { format, fileName: 'gear.stl', encoding: 'base64', data: cadBytesToBase64(bytes), units: 'mm' };
    if (format === 'step') expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    else expect(new DataView(bytes.buffer).getUint32(80, true)).toBeGreaterThan(4000);
    const frozenSource = JSON.stringify(source), runtime = createCadKernelRuntime(async () => undefined);
    try {
      const reply = await runtime.evaluate({ id: 1, kind: 'import-solid', source });
      if (reply.kind !== 'solid-imported') throw new Error(JSON.stringify(reply));
      expect(isCadKernelReply(reply)).toBe(true); expect(isCadSolidImportResult(reply.result)).toBe(true);
      expect(reply.result.sourceBytes).toBe(bytes.length); expect(reply.result.solidCount).toBe(1);
      // STL retains the written facets, whose volume differs from the analytic BRep.
      expect(reply.result.volume).toBeCloseTo(format === 'step' ? model.result.meshes[0].volume : binaryStlVolume(bytes), 5);
      const document = parseCadDocument({ ...createCadDocument('Reimported', 'reimported_capacity'), features: [
        { id: 'imported', name: source.fileName, kind: 'imported', suppressed: false, source },
      ] });
      const rebuilt = await runtime.evaluate({ id: 2, kind: 'build', document });
      if (rebuilt.kind !== 'built') throw new Error(JSON.stringify(rebuilt));
      expect(rebuilt.result.diagnostics).toEqual([]); expect(rebuilt.result.meshes[0].solidCount).toBe(1);
      expect(rebuilt.result.meshes[0].volume).toBeCloseTo(reply.result.volume, 5);
      expect(document.features[0]).toMatchObject({ source }); expect(JSON.stringify(source)).toBe(frozenSource);
      if (format === 'stl') {
        const malformed = bytes.slice(), count = new DataView(malformed.buffer).getUint32(80, true);
        new DataView(malformed.buffer).setFloat32(84 + (count - 1) * 50 + 12, NaN, true);
        expect(() => prepareCadSolidImport({ ...source, data: cadBytesToBase64(malformed) })).toThrow('finite');
      }
    } finally { runtime.dispose(); }
    expect(JSON.stringify(original)).toBe(bytesBefore);
  } finally { model.dispose(); }
}, 60_000);

it('transfers and builds every root in an actual 1001-solid STEP assembly without discarding geometry', async () => {
  const boxes = Array.from({ length: 1001 }, (_, index) => makeBox([index * 3, 0, 0], [index * 3 + 1, 1, 1]));
  let data: string;
  try { data = await exportSTEP(boxes.map((shape, index) => ({ shape, name: `Box ${index}` })), { unit: 'MM', modelUnit: 'MM' }).text(); }
  finally { for (const box of boxes) box.delete(); }
  const source: CadSolidImportSource = { format: 'step', fileName: 'assembly.step', encoding: 'utf8', data }, runtime = createCadKernelRuntime(async () => undefined);
  try {
    const imported = await runtime.evaluate({ id: 1, kind: 'import-solid', source });
    if (imported.kind !== 'solid-imported') throw new Error(JSON.stringify(imported));
    expect(isCadSolidImportResult(imported.result)).toBe(true); expect(imported.result.solidCount).toBe(1001); expect(imported.result.volume).toBeCloseTo(1001, 6);
    expect(imported.result.bounds.min).toEqual([0, 0, 0]); expect(imported.result.bounds.max).toEqual([3001, 1, 1]); expect(source.data).toBe(data);
    const document = parseCadDocument({ ...createCadDocument('Assembly', 'assembly_capacity'), features: [{ id: 'assembly', name: 'Assembly', kind: 'imported', suppressed: false, source }] });
    const built = await runtime.evaluate({ id: 2, kind: 'build', document });
    if (built.kind !== 'built') throw new Error(JSON.stringify(built));
    expect(built.result.diagnostics).toEqual([]); expect(isCadKernelReply(built)).toBe(true);
    expect(built.result.meshes[0].solidCount).toBe(1001); expect(built.result.meshes[0].volume).toBeCloseTo(1001, 6);
    expect(built.result.meshes[0].bounds.max).toEqual([3001, 1, 1]); expect(document.features[0]).toMatchObject({ source });
  } finally { runtime.dispose(); }
}, 60_000);
