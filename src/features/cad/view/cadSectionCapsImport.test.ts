// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import initOpenCascade from 'replicad-opencascadejs';
import { exportSTEP, makeBox, setOC, type Shape3D } from 'replicad';
import type { CadSolidImportSource } from '../../../domain/cad/cadImports';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import { prepareCadSolidImport } from '../kernel/cadKernelImport';
import { buildCadKernelModel } from '../kernel/cadKernelModel';
import { cadLocalRenderPositions, cadRenderOrigin } from '../cadRenderCoordinates';
import { createCadSectionCaps, type CadSectionCap } from './cadSectionCaps';
import { capCoveredArea, capWinding } from './__tests__/cadSectionCapFixtures';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

/**
 * Imports `shapes` as one STEP file, as File > Import does, builds it in the kernel and caps its body where the XY plane at z = 5 cuts
 * it, keeping the side below. The body is placed as the view places it, about the middle of its bounds.
 */
async function importedCap(shapes: readonly Shape3D[]) {
  const source: CadSolidImportSource = { format: 'step', encoding: 'utf8', fileName: 'solids.step', data: await exportSTEP(shapes.map(shape => ({ shape }))).text() };
  const analysis = prepareCadSolidImport(source);
  const model = buildCadKernelModel(parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'part', name: 'Imported part', units: 'mm', parameters: {},
    features: [{ id: 'imported', name: 'imported', suppressed: false, kind: 'imported', source }] }));
  try {
    expect(model.result.diagnostics).toEqual([]);
    const [mesh] = model.result.meshes, origin = cadRenderOrigin(mesh.bounds), geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(cadLocalRenderPositions(mesh.positions, origin), 3));
    geometry.setIndex(new THREE.Uint32BufferAttribute(mesh.indices, 1));
    const body = new THREE.Mesh(geometry); body.position.set(...origin);
    const caps = createCadSectionCaps({ sliceMs: Infinity });
    caps.setBodies([body]); caps.setPlane(new THREE.Plane(new THREE.Vector3(0, 0, -1), 5));
    const shown = caps.group.children as THREE.Group[];
    expect(shown).toHaveLength(1);
    const cap: CadSectionCap = { fans: (shown[0].children[0] as THREE.Mesh).geometry, fill: (shown[0].children[2] as THREE.Mesh).geometry };
    // Probes and areas in world millimetres, on the cut.
    const at = (x: number, y: number) => capWinding(cap, new THREE.Vector3(x - origin[0], y - origin[1], 5 - origin[2]));
    return { solids: analysis.solidCount, area: capCoveredArea(cap, 5 - origin[2]), at };
  } finally { model.dispose(); }
}
const boxes = (...corners: [[number, number, number], [number, number, number]][]) => corners.map(([min, max]) => makeBox(min, max));
const release = (shapes: readonly Shape3D[]) => { for (const shape of shapes) shape.delete(); };

describe('section caps of imported bodies with several solids', () => {
  it('fills a solid inside another solid, which is material, not a cavity', async () => {
    const shapes = boxes([[0, 0, 0], [10, 10, 10]], [[3, 3, 3], [7, 7, 7]]);
    try {
      const { solids, area, at } = await importedCap(shapes);
      expect(solids).toBe(2);
      // Nesting alone would have left the middle 4 mm square open, 84 mm² instead of 100 mm².
      expect(area).toBe(100);
      expect(at(5.1, 5.3)).toBe(2); expect(at(1.1, 5.3)).toBe(1);
    } finally { release(shapes); }
  });

  it('fills the union of overlapping solids', async () => {
    const shapes = boxes([[0, 0, 0], [10, 10, 10]], [[5, 5, 0], [15, 15, 10]]);
    try {
      const { solids, area, at } = await importedCap(shapes);
      expect(solids).toBe(2);
      expect(area).toBe(175);
      expect(at(7.6, 7.3)).toBe(2); expect(at(12.6, 12.3)).toBe(1); expect(at(2.6, 12.3)).toBe(0);
    } finally { release(shapes); }
  });

  it('leaves a real cavity open: a hollow solid whose inner shell faces inward', async () => {
    const [outer, inner] = boxes([[0, 0, 0], [10, 10, 10]], [[3, 3, 3], [7, 7, 7]]), hollow = outer.cut(inner);
    try {
      const { solids, area, at } = await importedCap([hollow]);
      expect(solids).toBe(1);
      expect(area).toBe(100 - 16);
      expect(at(5.1, 5.3)).toBe(0); expect(at(1.1, 5.3)).toBe(1);
    } finally { release([outer, inner, hollow]); }
  });

  it('fills solids that touch along a face, whose shared edges four triangles use', async () => {
    const shapes = boxes([[0, 0, 0], [10, 10, 10]], [[10, 0, 0], [20, 10, 10]]);
    try {
      const { solids, area } = await importedCap(shapes);
      expect(solids).toBe(2);
      expect(area).toBe(200);
    } finally { release(shapes); }
  });
});
