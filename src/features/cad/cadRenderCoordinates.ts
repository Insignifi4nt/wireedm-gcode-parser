import type { CadMesh } from '@/domain/cad/cadDocument';

export type CadRenderOrigin = readonly [number, number, number];

/** Keep GPU vertices close to zero; the object's world translation stays a JS double. */
export function cadRenderOrigin(bounds: CadMesh['bounds']): CadRenderOrigin {
  return [bounds.min[0] / 2 + bounds.max[0] / 2, bounds.min[1] / 2 + bounds.max[1] / 2, bounds.min[2] / 2 + bounds.max[2] / 2];
}

/** Range offsets are XYZ scalar indices; saved/kernel arrays remain untouched. */
export function cadLocalRenderPositions(positions: readonly number[], origin: CadRenderOrigin, start = 0, end = positions.length): Float32Array {
  const local = new Float32Array(end - start);
  for (let index = start; index < end; index++) local[index - start] = positions[index] - origin[index % 3];
  return local;
}
