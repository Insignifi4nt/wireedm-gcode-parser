import type { MachineMesh, RgbColor } from '@/domain/simulation/machine-import';

export interface MachineRenderGroups {
  readonly indices: Uint32Array;
  readonly groups: readonly { readonly start: number; readonly count: number; readonly materialIndex: number }[];
}

/** Share each RGB material across the assembly and batch disjoint faces using the same colour. */
export function createMachineSurfacePalette(meshes: readonly MachineMesh[]): {
  readonly colors: readonly (RgbColor | null)[];
  readonly meshes: readonly MachineRenderGroups[];
} {
  const colors: (RgbColor | null)[] = [];
  const palette = new Map<string, number>();
  const material = (color: RgbColor | null): number => {
    const key = color ? color.join(',') : 'fallback';
    const existing = palette.get(key);
    if (existing !== undefined) return existing;
    const index = colors.length;
    colors.push(color); palette.set(key, index); return index;
  };
  const grouped = meshes.map((mesh): MachineRenderGroups => {
    const triangleMaterials = new Uint32Array(mesh.indices.length / 3).fill(material(mesh.color));
    let cursor = 0;
    for (const face of [...mesh.faceGroups].sort((a, b) => a.first - b.first)) {
      const first = Math.max(cursor, face.first);
      const end = face.last + 1;
      if (end <= first) continue;
      triangleMaterials.fill(material(face.color ?? mesh.color), first, end);
      cursor = end;
    }
    const counts = new Map<number, number>();
    for (const index of triangleMaterials) counts.set(index, (counts.get(index) ?? 0) + 3);
    let start = 0;
    const groups = [...counts.entries()].sort(([a], [b]) => a - b).map(([materialIndex, count]) => {
      const group = { start, count, materialIndex }; start += count; return group;
    });
    const cursors = new Map(groups.map((group) => [group.materialIndex, group.start]));
    const indices = new Uint32Array(mesh.indices.length);
    triangleMaterials.forEach((materialIndex, triangle) => {
      const output = cursors.get(materialIndex)!;
      indices.set(mesh.indices.subarray(triangle * 3, triangle * 3 + 3), output);
      cursors.set(materialIndex, output + 3);
    });
    return { indices, groups };
  });
  return { colors, meshes: grouped };
}
