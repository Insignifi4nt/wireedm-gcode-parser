export type Vec3 = readonly [number, number, number];
export type RgbColor = readonly [number, number, number];
export interface Bounds3 { readonly min: Vec3; readonly max: Vec3 }

export interface MachineMesh {
  readonly id: string;
  readonly name: string;
  readonly positions: Float64Array;
  readonly normals: Float32Array | null;
  readonly indices: Uint32Array;
  readonly color: RgbColor | null;
  /** Triangle ranges, inclusive, retaining STEP face colours. */
  readonly faceGroups: readonly { readonly first: number; readonly last: number; readonly color: RgbColor | null }[];
  readonly bounds: Bounds3;
}

export interface MachineModelNode {
  readonly name: string;
  readonly meshIds: readonly string[];
  readonly children: readonly MachineModelNode[];
}

export interface MachineModel {
  readonly id: string;
  readonly name: string;
  readonly format: 'step';
  readonly units: 'mm';
  readonly meshes: readonly MachineMesh[];
  readonly root: MachineModelNode;
  readonly bounds: Bounds3;
  readonly triangleCount: number;
  readonly source: { readonly fileName: string; readonly byteLength: number; readonly sha256: string };
  readonly tessellation: { readonly linearDeflectionMm: number; readonly angularDeflectionRadians: number };
}

export type MachineImportErrorCode =
  | 'MACHINE_IMPORT_CANCELLED' | 'MACHINE_IMPORT_UNSUPPORTED_FORMAT' | 'MACHINE_IMPORT_EMPTY'
  | 'MACHINE_IMPORT_TOO_LARGE' | 'MACHINE_IMPORT_READ_FAILED' | 'MACHINE_IMPORT_INVALID_STEP'
  | 'MACHINE_IMPORT_UNITS_MISSING' | 'MACHINE_IMPORT_PARSER_UNAVAILABLE' | 'MACHINE_IMPORT_PARSE_FAILED'
  | 'MACHINE_IMPORT_NO_GEOMETRY' | 'MACHINE_IMPORT_INVALID_GEOMETRY' | 'MACHINE_IMPORT_GEOMETRY_LIMIT'
  | 'MACHINE_IMPORT_TIMED_OUT' | 'MACHINE_IMPORT_WORKER_FAILED';
export interface MachineImportError { readonly code: MachineImportErrorCode; readonly message: string }
export type MachineModelImportResult = { readonly ok: true; readonly model: MachineModel }
  | { readonly ok: false; readonly error: MachineImportError };
export type MachineImportProgress = { readonly stage: 'reading' | 'loading-parser' | 'triangulating' | 'validating' };

export const MACHINE_IMPORT_LIMITS = Object.freeze({
  fileBytes: 25 * 1024 * 1024,
  meshes: 1_000,
  vertices: 1_000_000,
  triangles: 500_000,
  hierarchyNodes: 10_000,
  hierarchyDepth: 64,
  coordinateMagnitudeMm: 10_000_000,
  timeoutMs: 90_000
});
export const MACHINE_TESSELLATION = Object.freeze({ linearDeflectionMm: 0.1, angularDeflectionRadians: 0.5 });

export function machineImportFailure(code: MachineImportErrorCode, message: string): Extract<MachineModelImportResult, { ok: false }> {
  return { ok: false, error: { code, message } };
}
