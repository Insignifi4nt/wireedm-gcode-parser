import { describe, expect, it } from 'vitest';
import type { MachineMesh } from '@/domain/simulation/machine-import';
import { createMachineSurfacePalette } from '../machineSurfacePalette';

function mesh(): MachineMesh {
  return { id: 'fixture', name: 'Fixture', positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0,
    2, 0, 0, 3, 0, 0, 2, 1, 0, 4, 0, 0, 5, 0, 0, 4, 1, 0, 6, 0, 0, 7, 0, 0, 6, 1, 0]),
    indices: Uint32Array.from({ length: 12 }, (_, index) => index), normals: null, color: [1, 0, 0],
    bounds: { min: [0, 0, 0], max: [7, 1, 0] }, faceGroups: [
      { first: 0, last: 0, color: [1, 0, 0] }, { first: 1, last: 1, color: [0, 0, 1] },
      { first: 2, last: 2, color: [1, 0, 0] }, { first: 3, last: 3, color: [0, 0, 1] }
    ] };
}

describe('STEP render material palette', () => {
  it('shares identical face colours across an assembly and batches nonadjacent faces', () => {
    const first = mesh();
    const second = { ...mesh(), id: 'second' };
    const palette = createMachineSurfacePalette([first, second]);
    expect(palette.colors).toEqual([[1, 0, 0], [0, 0, 1]]);
    expect(palette.meshes[0].groups).toEqual([{ start: 0, count: 6, materialIndex: 0 }, { start: 6, count: 6, materialIndex: 1 }]);
    expect([...palette.meshes[0].indices]).toEqual([0, 1, 2, 6, 7, 8, 3, 4, 5, 9, 10, 11]);
    expect([...first.indices]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(palette.meshes[1].groups).toEqual(palette.meshes[0].groups);
  });

  it('keeps uncovered and uncoloured faces on the mesh colour without losing triangles', () => {
    const source = { ...mesh(), faceGroups: [{ first: 1, last: 1, color: null }, { first: 3, last: 3, color: [0, 0, 1] as const }] };
    const palette = createMachineSurfacePalette([source]);
    expect(palette.meshes[0].groups).toEqual([{ start: 0, count: 9, materialIndex: 0 }, { start: 9, count: 3, materialIndex: 1 }]);
    expect([...palette.meshes[0].indices]).toEqual([...source.indices]);
    const fallback = createMachineSurfacePalette([{ ...source, color: null, faceGroups: [] }]);
    expect(fallback.colors).toEqual([null]);
    expect(fallback.meshes[0].groups).toEqual([{ start: 0, count: 12, materialIndex: 0 }]);
  });
});
