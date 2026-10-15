// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import initialize from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import type { CadDocument } from '../../src/domain/cad/cadDocument';
import { createCadDocument } from '../../src/domain/cad/cadSchema';
import { cadBytesToBase64, type CadSolidImportSource } from '../../src/domain/cad/cadImports';
import { createCadKernelRuntime } from '../../src/features/cad/kernel/cadKernelRuntime';
import { prepareCadSolidImport } from '../../src/features/cad/kernel/cadKernelImport';

beforeAll(async () => {
  // The explicit candidate config replaces this factory and selects its own
  // matching WASM. The normal installed module and browser remain untouched.
  const wasmBinary = await readFile(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initialize({ wasmBinary, print() {}, printErr() {} }));
}, 60_000);

const document: CadDocument = { ...createCadDocument('Edited bearing plates', 'candidate_cycle'), parameters: { width: 18, thickness: 3 }, features: [
  { id: 'outline', name: 'Plate and bores', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [
    { id: 'perimeter', name: 'Perimeter', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 'width', height: 20, cornerRadius: 2 } },
    { id: 'shaft', name: 'Shaft', construction: false, geometry: { kind: 'circle', x: 'width / 2', y: 10, radius: 3 } },
    ...([['left_bottom', 4, 4], ['left_top', 4, 16], ['right_bottom', 'width - 4', 4], ['right_top', 'width - 4', 16]] as const)
      .map(([id, x, y]) => ({ id, name: id, construction: false, geometry: { kind: 'circle' as const, x, y, radius: .75 } }))
  ] },
  { id: 'pad', name: 'Thickness', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: 'thickness', symmetric: false, operation: 'new', targetId: null },
  { id: 'pattern', name: 'Copies', kind: 'linear-pattern', suppressed: false, sourceId: 'pad', count: 2, spacing: ['width + 8', 0, 0] },
  { id: 'placed', name: 'Placed plates', kind: 'transform', suppressed: false, sourceId: 'pattern', translation: [100, 50, 7], rotation: [0, 0, 90] },
  { id: 'mirror', name: 'Mirrored plates', kind: 'mirror', suppressed: false, sourceId: 'placed', plane: 'YZ' }
] };

it('reuses reserve through repeated grow/shrink edits, pattern changes, rigid placement and exact/mesh export roundtrips', async () => {
  const runtime = createCadKernelRuntime(async () => undefined), capacities: number[] = [], buildIds = new Set<string>();
  const originals = JSON.stringify(document), samples = [[18, 3, 2], [96, 30, 3], [24, 5, 2], [60, 20, 3], [40, 8, 2], [18, 3, 2]] as const;
  const phases: { cycle: number; sample: number; phase: string; capacityMiB: number }[] = [];
  let requestId = 1;
  try {
    for (let cycle = 0; cycle < 4; cycle++) for (const [index, [width, thickness, copies]] of samples.entries()) {
      const record = (phase: string) => phases.push({ cycle, sample: index, phase, capacityMiB: getOC().wasmMemory.buffer.byteLength / 1024 / 1024 });
      const edited: CadDocument = { ...document, parameters: { width, thickness }, features: document.features.map(feature => feature.kind === 'linear-pattern' ? { ...feature, count: copies } : feature) };
      const material = (width * 20 - (4 - Math.PI) * 4 - Math.PI * (9 + 4 * .75 ** 2)) * thickness * copies;
      const built = await runtime.evaluate({ id: requestId++, kind: 'build', document: edited });
      record('build');
      if (built.kind !== 'built') throw new Error(`Edited build failed: ${JSON.stringify(built)}`);
      expect(built.result.diagnostics).toEqual([]); expect(built.result.meshes.map(mesh => mesh.featureId)).toEqual(['placed', 'mirror']);
      built.result.meshes.forEach(mesh => expect(mesh.volume).toBeCloseTo(material, 6));
      buildIds.add(built.result.buildId);
      const placed = built.result.meshes[0];
      placed.bounds.min.forEach((value, axis) => expect(value).toBeCloseTo([80, 50, 7][axis], 6));
      placed.bounds.max.forEach((value, axis) => expect(value).toBeCloseTo([100, 50 + copies * width + (copies - 1) * 8, 7 + thickness][axis], 6));
      const snapshot = JSON.stringify(built.result);
      const inspection = { bodyId: 'placed', expectedBuildId: built.result.buildId, selection: { kind: 'page', topology: 'face', offset: 0, limit: 10 } };
      const topologyBefore = await runtime.evaluate({ id: requestId++, kind: 'inspect-topology', document: edited, inspection });
      if (topologyBefore.kind !== 'topology-inspected') throw new Error('Expected exact topology before export');
      record('inspect-before');
      const section = await runtime.evaluate({ id: requestId++, kind: 'section', document: edited, section: { bodyId: 'placed', plane: 'XY', offset: '7 + thickness / 2' } });
      record('section');
      if (section.kind !== 'sectioned') throw new Error('Expected exact section before export');
      expect(section).toMatchObject({ kind: 'sectioned', result: { contourCount: 6 * copies } });
      const format = index % 2 ? 'step' : 'stl';
      const exported = await runtime.evaluate({ id: requestId++, kind: 'export', document: edited, format });
      record(`export-${format}`);
      if (exported.kind !== 'exported') throw new Error('Expected nonconsuming export');
      let imported: ReturnType<typeof prepareCadSolidImport>, exactRoundtrip = format === 'step';
      if (format === 'step') imported = prepareCadSolidImport({ format, encoding: 'utf8', fileName: 'plates.step', data: await exported.blob.text() });
      else {
        const bytes = new Uint8Array(await exported.blob.arrayBuffer()), facets = new DataView(bytes.buffer).getUint32(80, true);
        const source: CadSolidImportSource = { format, encoding: 'base64', units: 'mm', fileName: 'plates.stl', data: cadBytesToBase64(bytes) };
        if (facets <= 4000) imported = prepareCadSolidImport(source);
        else {
          // Preserve the existing bounded STL-import contract. A larger valid
          // export remains usable; its exact STEP sibling is the roundtrip path.
          expect(() => prepareCadSolidImport(source)).toThrow('4–4000 triangles');
          const step = await runtime.evaluate({ id: requestId++, kind: 'export', document: edited, format: 'step' });
          record('export-step-fallback');
          if (step.kind !== 'exported') throw new Error('Expected exact export after bounded STL rejection');
          imported = prepareCadSolidImport({ format: 'step', encoding: 'utf8', fileName: 'plates.step', data: await step.blob.text() });
          exactRoundtrip = true;
        }
      }
      expect(imported.solidCount).toBe(copies * 2);
      record(`import-${exactRoundtrip ? 'step' : 'stl'}`);
      if (exactRoundtrip) expect(imported.volume).toBeCloseTo(material * 2, 5);
      else expect(Math.abs(imported.volume - material * 2) / (material * 2)).toBeLessThan(.001);
      const after = await runtime.evaluate({ id: requestId++, kind: 'build', document: edited });
      record('build-after');
      if (after.kind !== 'built') throw new Error('Expected retained snapshot after export/import');
      expect(after.result).toBe(built.result); expect(after.result.meshes).toBe(built.result.meshes);
      expect(JSON.stringify(after.result)).toBe(snapshot);
      const topologyAfter = await runtime.evaluate({ id: requestId++, kind: 'inspect-topology', document: edited, inspection });
      record('inspect-after');
      expect(topologyAfter).toEqual({ ...topologyBefore, id: requestId - 1 });
      const sectionAfter = await runtime.evaluate({ id: requestId++, kind: 'section', document: edited, section: { bodyId: 'placed', plane: 'XY', offset: '7 + thickness / 2' } });
      record('section-after');
      expect(sectionAfter).toEqual({ ...section, id: requestId - 1 });
      capacities.push(getOC().wasmMemory.buffer.byteLength);
    }
    expect(buildIds.size).toBe(21); // Adjacent repeated smallest samples reuse the accepted native snapshot.
    expect(JSON.stringify(document)).toBe(originals);
  } finally { runtime.dispose(); }
  const warmed = Math.max(...capacities.slice(0, samples.length));
  const growthEvents = phases.filter((phase, index) => index > 0 && phase.capacityMiB !== phases[index - 1].capacityMiB);
  const evidence = { case: 'independent-edit-export-grow-shrink-24', capacitiesMiB: capacities.map(bytes => bytes / 1024 / 1024), uniqueBuilds: buildIds.size, growthEvents };
  await writeFile(new URL('../../tmp/cad-native-repair/lifecycle-phases.json', import.meta.url), `${JSON.stringify({ ...evidence, phases }, null, 2)}\n`);
  console.log(JSON.stringify(evidence));
  expect(Math.max(...capacities.slice(samples.length))).toBeLessThanOrEqual(warmed * 1.2);
}, 60_000);
