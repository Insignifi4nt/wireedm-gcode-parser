import { describe, expect, it } from 'vitest';
import { MACHINE_IMPORT_LIMITS } from '../model';
import { validateMachineModel } from '../validateMachineModel';

const source = { fileName: 'machine.step', byteLength: 100, sha256: 'a'.repeat(64) };
function rawModel() {
  return { success: true, root: { name: 'Assembly', meshes: [0], children: [] as unknown[] }, meshes: [{
    name: 'Fixture', color: [0.1, 0.2, 0.3],
    attributes: { position: { array: [0, 0, 0, 10, 0, 0, 0, 10, 0] }, normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] } },
    index: { array: [0, 1, 2] }, brep_faces: [{ first: 0, last: 0, color: [1, 0, 0] }]
  }] };
}
function expectFailure(raw: unknown, code: string) {
  const result = validateMachineModel(raw, source);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Invalid geometry accepted');
  expect(result.error.code).toBe(code);
}

describe('machine geometry boundary', () => {
  it('copies validated coordinates, normals, colours, names and assembly references', () => {
    const raw = rawModel();
    const result = validateMachineModel(raw, source);
    if (!result.ok) throw new Error(result.error.message);
    raw.meshes[0].attributes.position.array[0] = 200;
    expect(result.model.meshes[0].positions[0]).toBe(0);
    expect(result.model.meshes[0].color).toEqual([0.1, 0.2, 0.3]);
    expect(result.model.meshes[0].faceGroups).toEqual([{ first: 0, last: 0, color: [1, 0, 0] }]);
    expect(result.model.root.meshIds).toEqual([result.model.meshes[0].id]);
    expect(result.model.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 0] });
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite vertex %s', (value) => {
    const raw = rawModel(); raw.meshes[0].attributes.position.array[2] = value;
    expectFailure(raw, 'MACHINE_IMPORT_INVALID_GEOMETRY');
  });

  it.each([-1, 0.5, 3, NaN, 2 ** 32])('rejects triangle index %s before unsigned conversion', (value) => {
    const raw = rawModel(); raw.meshes[0].index.array[2] = value;
    expectFailure(raw, 'MACHINE_IMPORT_INVALID_GEOMETRY');
  });

  it('rejects oversized geometry before allocating typed buffers', () => {
    const raw = rawModel(); raw.meshes[0].attributes.position.array = new Array((MACHINE_IMPORT_LIMITS.vertices + 1) * 3);
    expectFailure(raw, 'MACHINE_IMPORT_GEOMETRY_LIMIT');
    const triangleHeavy = rawModel(); triangleHeavy.meshes[0].index.array = new Array((MACHINE_IMPORT_LIMITS.triangles + 1) * 3);
    expectFailure(triangleHeavy, 'MACHINE_IMPORT_GEOMETRY_LIMIT');
    const manyMeshes = rawModel(); manyMeshes.meshes = new Array(MACHINE_IMPORT_LIMITS.meshes + 1).fill(manyMeshes.meshes[0]);
    expectFailure(manyMeshes, 'MACHINE_IMPORT_GEOMETRY_LIMIT');
  });

  it('rejects out-of-range normals, colours, face ranges and component references', () => {
    const badNormal = rawModel(); badNormal.meshes[0].attributes.normal.array[0] = Infinity;
    expectFailure(badNormal, 'MACHINE_IMPORT_INVALID_GEOMETRY');
    const badColor = rawModel(); badColor.meshes[0].color[0] = 5;
    expectFailure(badColor, 'MACHINE_IMPORT_INVALID_GEOMETRY');
    const badFace = rawModel(); badFace.meshes[0].brep_faces[0].last = 1;
    expectFailure(badFace, 'MACHINE_IMPORT_INVALID_GEOMETRY');
    const badNode = rawModel(); badNode.root.meshes = [1];
    expectFailure(badNode, 'MACHINE_IMPORT_INVALID_GEOMETRY');
  });

  it('rejects cyclic or excessively deep hierarchies without recursive overflow', () => {
    const cyclic = rawModel(); cyclic.root.children.push(cyclic.root);
    expectFailure(cyclic, 'MACHINE_IMPORT_INVALID_GEOMETRY');
    const deep = rawModel();
    let branch = deep.root;
    for (let depth = 0; depth < 70; depth++) {
      const child = { name: 'Nested', meshes: [], children: [] as unknown[] };
      branch.children.push(child); branch = child;
    }
    expectFailure(deep, 'MACHINE_IMPORT_GEOMETRY_LIMIT');
  });
});
