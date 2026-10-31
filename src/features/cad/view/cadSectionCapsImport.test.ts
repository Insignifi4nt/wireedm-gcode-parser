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
import { cadCapBodySolids, createCadSectionCaps, type CadSectionCap } from './cadSectionCaps';
import { capCoveredArea, capGroupWindings, capWinding } from './__tests__/cadSectionCapFixtures';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

/**
 * Imports `shapes` as one STEP file, as File > Import does, builds it in the kernel and caps its body where the XY plane at z = 5 cuts
 * it, keeping the side below. The body is placed as the view places it, about the middle of its bounds, and its solids given to the
 * caps as the view gives them. `area` is false to skip measuring a large cap's area.
 */
async function importedCap(shapes: readonly Shape3D[], area = true) {
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
    caps.setBodies([body], () => cadCapBodySolids(mesh)); caps.setPlane(new THREE.Plane(new THREE.Vector3(0, 0, -1), 5));
    const shown = caps.group.children as THREE.Group[];
    expect(shown).toHaveLength(1);
    // A cap counted in groups draws each group's run of the fans, then folds; the fans are the attribute the runs share.
    const steps = shown[0].children as THREE.Mesh[], grouped = steps[2].name === 'cad-section-cap-fold';
    const fans = grouped ? new THREE.BufferGeometry().setAttribute('position', steps[0].geometry.getAttribute('position')) : steps[0].geometry;
    const cap: CadSectionCap = { fans, fill: steps[steps.length - 1].geometry, groups: grouped ? steps.filter((_, index) => index % 3 === 0 && index < steps.length - 1).map(step => step.geometry.drawRange) : null };
    // Probes and areas in world millimetres, on the cut.
    const point = (x: number, y: number) => new THREE.Vector3(x - origin[0], y - origin[1], 5 - origin[2]);
    const at = (x: number, y: number) => capWinding(cap, point(x, y)), groups = (x: number, y: number) => capGroupWindings(cap, point(x, y));
    return { solids: analysis.solidCount, mesh, area: area ? capCoveredArea(cap, 5 - origin[2]) : NaN, at, groups };
  } finally { model.dispose(); }
}
const boxes = (...corners: [[number, number, number], [number, number, number]][]) => corners.map(([min, max]) => makeBox(min, max));
const release = (shapes: readonly Shape3D[]) => { for (const shape of shapes) shape.delete(); };

describe('section caps of imported bodies with several solids', () => {
  it('fills a solid inside another solid, which is material, not a cavity', async () => {
    const shapes = boxes([[0, 0, 0], [10, 10, 10]], [[3, 3, 3], [7, 7, 7]]);
    try {
      const { solids, mesh, area, at } = await importedCap(shapes);
      expect(solids).toBe(2);
      // Each box's six faces bound one solid of the two.
      expect(mesh.faceSolids).toHaveLength(12); expect([...mesh.faceSolids!].sort()).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
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
      const { solids, mesh, area, at } = await importedCap([hollow]);
      expect(solids).toBe(1); expect(mesh.faceSolids).toBeUndefined();
      expect(area).toBe(100 - 16);
      expect(at(5.1, 5.3)).toBe(0); expect(at(1.1, 5.3)).toBe(1);
    } finally { release([outer, inner, hollow]); }
  });

  it('counts 300 solids nested round one point in groups that never wrap, as the kernel numbers them', async () => {
    // 300 boxes one inside the next, each 0.02 mm inside the one before across and 0.01 mm up and down, the largest 20 mm square: the
    // middle lies in all 300, which an 8-bit count would read as 44.
    const shapes = boxes(...Array.from({ length: 300 }, (_, box): [[number, number, number], [number, number, number]] => [[0.02 * box, 0.02 * box, 0.01 * box], [20 - 0.02 * box, 20 - 0.02 * box, 10 - 0.01 * box]]));
    try {
      const { solids, mesh, at, groups } = await importedCap(shapes, false);
      expect(solids).toBe(300); expect(mesh.solidCount).toBe(300);
      expect(mesh.faceSolids).toHaveLength(mesh.faceGroups.length);
      expect(new Set(mesh.faceSolids)).toEqual(new Set(Array.from({ length: 300 }, (_, solid) => solid)));
      expect(at(10.1, 10.3)).toBe(300);
      // However the kernel orders the solids, each group holds at most 127 and counts each one it holds.
      const middle = groups(10.1, 10.3);
      expect(middle).toHaveLength(3); expect(middle.reduce((sum, count) => sum + count, 0)).toBe(300);
      for (const count of middle) { expect(count).toBeGreaterThan(0); expect(count).toBeLessThanOrEqual(127); }
      // Just inside the largest box only, and outside it.
      expect(at(0.01, 10.3)).toBe(1); expect(at(-0.5, 10.3)).toBe(0);
    } finally { release(shapes); }
  }, 60_000);

  it('fills solids that touch along a face, whose shared edges four triangles use', async () => {
    const shapes = boxes([[0, 0, 0], [10, 10, 10]], [[10, 0, 0], [20, 10, 10]]);
    try {
      const { solids, area } = await importedCap(shapes);
      expect(solids).toBe(2);
      expect(area).toBe(200);
    } finally { release(shapes); }
  });
});
