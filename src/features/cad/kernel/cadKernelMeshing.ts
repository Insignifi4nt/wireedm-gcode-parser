import { getOC, HASH_CODE_MAX, type Shape3D, type ShapeEdgeMesh, type ShapeMesh } from 'replicad';
import type { BRepBuilderAPI_Transform, TopoDS_Shape } from 'replicad-opencascadejs';
import type { CadMesh } from '../../../domain/cad/cadDocument';
import { CadError } from '../../../domain/cad/cadError';
import { MAX_CAD_TOPOLOGY_PER_BODY } from '../../../domain/cad/cadTopology';
import { MAX_CAD_PREVIEW_SCALARS } from './cadKernelLimits';

interface MeshOptions { readonly tolerance: number; readonly angularTolerance: number }
type TopologyKind = 'face' | 'edge';

function meshError(message: string): never { throw new CadError('mesh-limit', message); }
function checkedCount(count: number, multiple: number, maximum: number): number {
  if (!Number.isSafeInteger(count) || count < 0 || count % multiple || count > maximum) meshError('The preview exceeds its bounded mesh buffer budget. Simplify the model.');
  return count;
}

/** Native pointers are read only after checking sizes, against the current heap. */
function readNumbers(pointer: number, count: number, format: 'float' | 'unsigned' | 'signed'): number[] {
  const buffer = getOC().wasmMemory.buffer;
  const start = (pointer >>> 0) / 4;
  if (!Number.isInteger(start) || start + count > buffer.byteLength / 4) throw new CadError('invalid-mesh', 'The kernel returned an invalid preview buffer.');
  const heap = format === 'float' ? new Float32Array(buffer) : format === 'unsigned' ? new Uint32Array(buffer) : new Int32Array(buffer);
  return Array.from(heap.subarray(start, start + count));
}

/** ModifiedShape establishes exact provenance; explorer order is never a mapping. */
function transformedHashes(shape: TopoDS_Shape, transform: BRepBuilderAPI_Transform): ReadonlyMap<string, number> {
  const oc = getOC(); const hashes = new Map<string, number>();
  for (const kind of ['face', 'edge'] as const) {
    const explorer = new oc.TopExp_Explorer(shape, kind === 'face' ? oc.TopAbs_ShapeEnum.TopAbs_FACE : oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    try {
      while (explorer.More()) {
        const original = explorer.Current();
        try {
          const localized = transform.ModifiedShape(original);
          try {
            if (localized.IsNull()) throw new CadError('topology-mapping', 'Preview translation could not identify an exact source element.');
            const originalHash = oc.ReplicadShapeHasher.HashCode(original, HASH_CODE_MAX);
            const key = `${kind}:${oc.ReplicadShapeHasher.HashCode(localized, HASH_CODE_MAX)}`;
            const previous = hashes.get(key);
            if (previous !== undefined && previous !== originalHash) throw new CadError('topology-id-collision', 'Preview translation produced ambiguous topology. Picking is unavailable for this model.');
            hashes.set(key, originalHash);
            if (hashes.size > MAX_CAD_TOPOLOGY_PER_BODY) throw new CadError('topology-limit', 'The translated preview exceeds the body topology limit.');
          } finally { localized.delete(); }
        } finally { original.delete(); }
        explorer.Next();
      }
    } finally { explorer.delete(); }
  }
  return hashes;
}

function sourceHash(hashes: ReadonlyMap<string, number>, kind: TopologyKind, hash: number): number {
  const original = hashes.get(`${kind}:${hash}`);
  if (original === undefined) throw new CadError('topology-mapping', 'A preview element does not match the original exact body.');
  return original;
}
function restoreWorld(values: number[], origin: readonly number[]) {
  for (let index = 0; index < values.length; index++) values[index] += origin[index % 3];
  return values;
}

/** Replicad 1.1 extracts Float32 world vertices. Translate the native preview first,
 * then restore world coordinates as JS doubles and remap groups to source hashes.
 * The original BRep/location, exact operations, descriptors and exports stay intact. */
export function meshCadKernelPreview(shape: Shape3D, bounds: CadMesh['bounds'], options: MeshOptions): { mesh: ShapeMesh; edgeMesh: ShapeEdgeMesh } {
  const oc = getOC();
  const origin = bounds.min.map((minimum, axis) => minimum / 2 + bounds.max[axis] / 2);
  const translation = new oc.gp_Trsf();
  try {
    const vector = new oc.gp_Vec(-origin[0], -origin[1], -origin[2]);
    try {
      translation.SetTranslation(vector);
      const transform = new oc.BRepBuilderAPI_Transform(shape.wrapped, translation, false, false);
      try {
        const localized = transform.Shape();
        try {
          const hashes = transformedHashes(shape.wrapped, transform);
          const raw = oc.ReplicadMeshExtractor.extract(localized, options.tolerance, options.angularTolerance, false);
          let mesh: ShapeMesh;
          try {
            const vertices = checkedCount(raw.getVerticesSize(), 3, MAX_CAD_PREVIEW_SCALARS);
            const normals = checkedCount(raw.getNormalsSize(), 3, MAX_CAD_PREVIEW_SCALARS);
            const triangles = checkedCount(raw.getTrianglesSize(), 3, 3_000_000);
            if (vertices !== normals || vertices + normals + triangles > MAX_CAD_PREVIEW_SCALARS) meshError('The preview exceeds its bounded mesh buffer budget. Simplify the model.');
            const groups = readNumbers(raw.getFaceGroupsPtr(), checkedCount(raw.getFaceGroupsSize(), 3, MAX_CAD_TOPOLOGY_PER_BODY * 3), 'signed');
            const faceGroups: ShapeMesh['faceGroups'] = [];
            for (let index = 0; index < groups.length; index += 3) faceGroups.push({ start: groups[index], count: groups[index + 1], faceId: sourceHash(hashes, 'face', groups[index + 2]) });
            mesh = { vertices: restoreWorld(readNumbers(raw.getVerticesPtr(), vertices, 'float'), origin), normals: readNumbers(raw.getNormalsPtr(), normals, 'float'),
              triangles: readNumbers(raw.getTrianglesPtr(), triangles, 'unsigned'), faceGroups };
          } finally { raw.delete(); }
          const rawEdges = oc.ReplicadEdgeMeshExtractor.extract(localized, options.tolerance, options.angularTolerance);
          try {
            const retained = mesh.vertices.length + mesh.normals.length + mesh.triangles.length;
            const lineCount = checkedCount(rawEdges.getLinesSize(), 6, MAX_CAD_PREVIEW_SCALARS - retained);
            const groups = readNumbers(rawEdges.getEdgeGroupsPtr(), checkedCount(rawEdges.getEdgeGroupsSize(), 3, MAX_CAD_TOPOLOGY_PER_BODY * 3), 'signed');
            const edgeGroups: ShapeEdgeMesh['edgeGroups'] = [];
            for (let index = 0; index < groups.length; index += 3) edgeGroups.push({ start: groups[index], count: groups[index + 1], edgeId: sourceHash(hashes, 'edge', groups[index + 2]) });
            return { mesh, edgeMesh: { lines: restoreWorld(readNumbers(rawEdges.getLinesPtr(), lineCount, 'float'), origin), edgeGroups } };
          } finally { rawEdges.delete(); }
        } finally { localized.delete(); }
      } finally { transform.delete(); }
    } finally { vector.delete(); }
  } finally { translation.delete(); }
}
