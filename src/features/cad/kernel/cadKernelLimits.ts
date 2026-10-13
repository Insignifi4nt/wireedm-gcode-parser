import type { CadMesh } from '../../../domain/cad/cadDocument';

/** Eight million numeric values bound the retained worker preview and its structured clone. */
export const MAX_CAD_PREVIEW_SCALARS = 8_000_000;
export function cadMeshScalarCount(mesh: CadMesh): number {
  return mesh.positions.length + mesh.normals.length + mesh.indices.length + mesh.edges.length;
}
