import type { CadBuildResult, CadDocument, CadMesh } from '../../../domain/cad/cadDocument';
import { isCadSectionResult, type CadSectionRequest, type CadSectionResult } from '../../../domain/cad/cadSection';
import { cadMeshScalarCount, MAX_CAD_PREVIEW_SCALARS } from './cadKernelLimits';

export type CadKernelRequest = { readonly id: number; readonly kind: 'build'; readonly document: CadDocument }
  | { readonly id: number; readonly kind: 'export'; readonly document: CadDocument; readonly format: 'step' | 'stl' }
  | { readonly id: number; readonly kind: 'section'; readonly document: CadDocument; readonly section: CadSectionRequest };
export type CadKernelReply = { readonly id: number; readonly kind: 'built'; readonly result: CadBuildResult }
  | { readonly id: number; readonly kind: 'exported'; readonly blob: Blob }
  | { readonly id: number; readonly kind: 'sectioned'; readonly result: CadSectionResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

/** The worker boundary receives structured clones, never executable model scripts. */
export function isCadKernelEnvelope(value: unknown): value is Record<string, unknown> & { id: number; kind: string } {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number'
    && Number.isSafeInteger(value.id) && value.id > 0 && 'kind' in value && typeof value.kind === 'string';
}

export function isCadKernelReply(value: unknown): value is CadKernelReply {
  if (!isCadKernelEnvelope(value)) return false;
  if (value.kind === 'error') return typeof value.message === 'string' && value.message.length <= 8192;
  if (value.kind === 'exported') return value.blob instanceof Blob;
  if (value.kind === 'sectioned') return isCadSectionResult(value.result);
  if (value.kind !== 'built' || typeof value.result !== 'object' || value.result === null) return false;
  const result = value.result;
  if (!('durationMs' in result) || typeof result.durationMs !== 'number' || !Number.isFinite(result.durationMs) || result.durationMs < 0
    || !('meshes' in result) || !Array.isArray(result.meshes) || result.meshes.length > 256 || !result.meshes.every(isCadMesh)
    || !('diagnostics' in result) || !Array.isArray(result.diagnostics) || result.diagnostics.length > 512) return false;
  if (new Set(result.meshes.map(mesh => mesh.featureId)).size !== result.meshes.length
    || result.meshes.reduce((total, mesh) => total + cadMeshScalarCount(mesh), 0) > MAX_CAD_PREVIEW_SCALARS) return false;
  return result.diagnostics.every(diagnostic => typeof diagnostic === 'object' && diagnostic !== null && typeof diagnostic.code === 'string'
    && diagnostic.code.length <= 128 && typeof diagnostic.message === 'string' && diagnostic.message.length <= 8192
    && (diagnostic.featureId === undefined || typeof diagnostic.featureId === 'string' && diagnostic.featureId.length <= 96));
}

function isNumbers(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length > MAX_CAD_PREVIEW_SCALARS) return false;
  for (const number of value) if (typeof number !== 'number' || !Number.isFinite(number)) return false;
  return true;
}
function isCadMesh(value: unknown): value is CadMesh {
  if (typeof value !== 'object' || value === null || !('featureId' in value) || typeof value.featureId !== 'string' || value.featureId.length > 96
    || !('name' in value) || typeof value.name !== 'string' || value.name.length > 160
    || !('positions' in value) || !isNumbers(value.positions) || value.positions.length === 0 || value.positions.length % 3 !== 0
    || !('normals' in value) || !isNumbers(value.normals) || value.normals.length !== value.positions.length
    || !('indices' in value) || !isNumbers(value.indices) || value.indices.length === 0 || value.indices.length % 3 !== 0
    || !('edges' in value) || !isNumbers(value.edges) || value.edges.length % 6 !== 0
    || !('volume' in value) || typeof value.volume !== 'number' || !Number.isFinite(value.volume) || value.volume <= 0
    || !('bounds' in value) || typeof value.bounds !== 'object' || value.bounds === null
    || !('min' in value.bounds) || !isNumbers(value.bounds.min) || value.bounds.min.length !== 3
    || !('max' in value.bounds) || !isNumbers(value.bounds.max) || value.bounds.max.length !== 3) return false;
  const vertices = value.positions.length / 3;
  if (!value.indices.every(index => Number.isInteger(index) && index >= 0 && index < vertices)) return false;
  const min = value.bounds.min; const max = value.bounds.max;
  return min.every((coordinate, axis) => coordinate <= max[axis]);
}
