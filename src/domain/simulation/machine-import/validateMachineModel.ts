import {
  MACHINE_IMPORT_LIMITS, MACHINE_TESSELLATION, machineImportFailure,
  type Bounds3, type MachineImportErrorCode, type MachineMesh, type MachineModel,
  type MachineModelImportResult, type MachineModelNode, type RgbColor, type Vec3
} from './model';

class InvalidImport extends Error {
  constructor(readonly code: MachineImportErrorCode, message: string) { super(message); }
}
function invalid(message: string): never { throw new InvalidImport('MACHINE_IMPORT_INVALID_GEOMETRY', message); }
function limit(message: string): never { throw new InvalidImport('MACHINE_IMPORT_GEOMETRY_LIMIT', message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('The parser returned an invalid model structure.');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid('The parser returned an invalid mesh or assembly array.');
  return value;
}
function numericArray(value: unknown): ArrayLike<number> {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) invalid('The parser returned an invalid geometry array.');
  if (value instanceof DataView) invalid('The parser returned an invalid geometry array.');
  return value as ArrayLike<number>;
}
function name(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.slice(0, 512) : fallback;
}
function color(value: unknown): RgbColor | null {
  if (value === undefined || value === null) return null;
  const rgb = list(value);
  if (rgb.length !== 3 || !rgb.every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1)) {
    invalid('The parser returned an invalid surface colour.');
  }
  return [rgb[0], rgb[1], rgb[2]] as RgbColor;
}

export function boundsForPositions(positions: ArrayLike<number>): Bounds3 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < positions.length; index++) {
    const axis = index % 3;
    min[axis] = Math.min(min[axis], positions[index]);
    max[axis] = Math.max(max[axis], positions[index]);
  }
  return { min: min as unknown as Vec3, max: max as unknown as Vec3 };
}

export function unionBounds(bounds: readonly Bounds3[]): Bounds3 {
  return boundsForPositions(bounds.flatMap(({ min, max }) => [...min, ...max]));
}

/** The only conversion boundary from untyped OCCT output into simulation geometry. */
export function validateMachineModel(raw: unknown, source: MachineModel['source']): MachineModelImportResult {
  try {
    const result = record(raw);
    if (result.success !== true) return machineImportFailure('MACHINE_IMPORT_PARSE_FAILED', 'OpenCascade could not read this STEP model. Export a complete solid or surface model and try again.');
    const rawMeshes = list(result.meshes);
    if (rawMeshes.length === 0) return machineImportFailure('MACHINE_IMPORT_NO_GEOMETRY', 'The STEP model contains no triangulated surfaces.');
    if (rawMeshes.length > MACHINE_IMPORT_LIMITS.meshes) limit('The machine model exceeds the 1,000 mesh limit. Export a simpler assembly.');
    let vertexCount = 0;
    let triangleCount = 0;
    const modelId = `machine-${source.sha256}`;
    const meshes: MachineMesh[] = rawMeshes.map((rawMesh, meshIndex) => {
      const mesh = record(rawMesh);
      const attributes = record(mesh.attributes);
      const rawPositions = numericArray(record(attributes.position).array);
      const rawIndices = numericArray(record(mesh.index).array);
      if (!rawPositions.length || rawPositions.length % 3 !== 0 || !rawIndices.length || rawIndices.length % 3 !== 0) {
        invalid('A machine mesh has incomplete vertices or triangle indices.');
      }
      vertexCount += rawPositions.length / 3;
      triangleCount += rawIndices.length / 3;
      if (vertexCount > MACHINE_IMPORT_LIMITS.vertices || triangleCount > MACHINE_IMPORT_LIMITS.triangles) {
        limit('The machine model exceeds 1,000,000 vertices or 500,000 triangles. Export a simpler assembly.');
      }
      for (let index = 0; index < rawPositions.length; index++) {
        const value = rawPositions[index];
        if (typeof value !== 'number' || !Number.isFinite(value)) invalid('A machine mesh contains a non-finite coordinate.');
        if (Math.abs(value) > MACHINE_IMPORT_LIMITS.coordinateMagnitudeMm) limit('A model coordinate exceeds 10,000,000 mm. Check the model units and origin.');
      }
      for (let index = 0; index < rawIndices.length; index++) {
        const value = rawIndices[index];
        if (!Number.isSafeInteger(value) || value < 0 || value >= rawPositions.length / 3) invalid('A machine triangle refers to a missing vertex.');
      }
      const positions = Float64Array.from(rawPositions);
      const indices = Uint32Array.from(rawIndices);
      let normals: Float32Array | null = null;
      if (attributes.normal !== undefined) {
        const rawNormals = numericArray(record(attributes.normal).array);
        if (rawNormals.length !== positions.length) invalid('A machine mesh has incomplete surface normals.');
        for (let index = 0; index < rawNormals.length; index++) {
          if (typeof rawNormals[index] !== 'number' || !Number.isFinite(rawNormals[index]) || Math.abs(rawNormals[index]) > 1.001) {
            invalid('A machine mesh contains an invalid surface normal.');
          }
        }
        normals = Float32Array.from(rawNormals);
      }
      const faceGroups = mesh.brep_faces === undefined ? [] : list(mesh.brep_faces).map((rawFace) => {
        const face = record(rawFace);
        const first = face.first;
        const last = face.last;
        if (typeof first !== 'number' || typeof last !== 'number' || !Number.isSafeInteger(first) || !Number.isSafeInteger(last)
          || first < 0 || last < first || last >= indices.length / 3) invalid('A machine face refers to a missing triangle.');
        return { first, last, color: color(face.color) };
      });
      return { id: `${modelId}/mesh-${meshIndex}`, name: name(mesh.name, `Mesh ${meshIndex + 1}`),
        positions, indices, normals, color: color(mesh.color), faceGroups, bounds: boundsForPositions(positions) };
    });
    let nodes = 0;
    const ancestors = new Set<unknown>();
    const node = (rawNode: unknown, depth: number): MachineModelNode => {
      if (++nodes > MACHINE_IMPORT_LIMITS.hierarchyNodes || depth > MACHINE_IMPORT_LIMITS.hierarchyDepth) {
        limit('The machine assembly hierarchy is too large or too deeply nested.');
      }
      if (ancestors.has(rawNode)) invalid('The machine assembly hierarchy contains a cycle.');
      ancestors.add(rawNode);
      const item = record(rawNode);
      const meshIds = list(item.meshes).map((index) => {
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= meshes.length) {
          invalid('An assembly component refers to a missing mesh.');
        }
        return meshes[index].id;
      });
      const children = list(item.children).map((child) => node(child, depth + 1));
      ancestors.delete(rawNode);
      return { name: name(item.name, 'Component'), meshIds, children };
    };
    const root = node(result.root, 0);
    return { ok: true, model: { id: modelId, name: source.fileName.replace(/\.(step|stp)$/i, ''),
      format: 'step', units: 'mm', meshes, root, bounds: unionBounds(meshes.map((mesh) => mesh.bounds)),
      triangleCount, source, tessellation: MACHINE_TESSELLATION } };
  } catch (error) {
    return error instanceof InvalidImport ? machineImportFailure(error.code, error.message)
      : machineImportFailure('MACHINE_IMPORT_INVALID_GEOMETRY', 'The parser returned an unreadable mesh structure.');
  }
}
