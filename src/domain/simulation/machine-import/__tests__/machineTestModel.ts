import type { MachineModel, Vec3 } from '../model';
import { validateMachineModel } from '../validateMachineModel';

export function triangleModel(vertices: readonly [Vec3, Vec3, Vec3] = [[5, -1, 0], [5, 1, 0], [5, 0, 10]], copies = 1): MachineModel {
  const result = validateMachineModel({ success: true, root: { name: 'Test assembly', meshes: [0], children: [] }, meshes: [{
    name: 'Clamp', attributes: { position: { array: vertices.flat() }, normal: { array: [1, 0, 0, 1, 0, 0, 1, 0, 0] } },
    index: { array: Array.from({ length: copies }, () => [0, 1, 2]).flat() }
  }] }, { fileName: 'clamp.step', byteLength: 100, sha256: 'b'.repeat(64) });
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}
