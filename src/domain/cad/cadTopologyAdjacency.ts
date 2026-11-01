import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadError } from './cadError';
import { CAD_PRECISION } from '../precision/cadPrecision';

/**
 * How one built body's edges and faces meet: the vertices at each edge's ends, its unit tangents there, the faces on either side and
 * whether they meet without a crease, and each face's boundary loops. Indices refer to `edges` and `faces`; keys are the build's own
 * topology keys. Flat arrays keep a body of thousands of edges small to send and quick to check.
 */
export interface CadTopologyAdjacency {
  readonly bodyId: string;
  readonly buildId: string;
  readonly edges: readonly string[];
  /** Two per edge: the vertex at its start and at its end. A closed edge names one vertex twice. */
  readonly edgeVertices: readonly number[];
  /** Six per edge: the unit tangent at its start and at its end, both along the edge; three zeros where none is defined. */
  readonly edgeTangents: readonly number[];
  /** Two per edge: the faces either side, `-1` where there is none. A seam names its one face twice. */
  readonly edgeFaces: readonly number[];
  /** Per edge, whether its faces meet without a crease, so the edge is no corner of the solid. */
  readonly edgeSmooth: readonly boolean[];
  readonly faces: readonly string[];
  /** Per face, its boundary loops, each the edges it is made of. */
  readonly faceLoops: readonly (readonly (readonly number[])[])[];
}
export interface CadTopologyAdjacencyRequest { readonly bodyId: string; readonly expectedBuildId: string }

/** Bodies larger than this are refused rather than sent. */
export const MAX_CAD_TOPOLOGY_ADJACENCY_ELEMENTS = 200_000;
const identifier = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' });
const opaque = Type.String({ minLength: 1, maxLength: 128, pattern: '\\S' });
const RequestSchema = Type.Object({ bodyId: identifier, expectedBuildId: opaque }, { additionalProperties: false });

export function parseCadTopologyAdjacencyRequest(value: unknown): CadTopologyAdjacencyRequest {
  if (!Value.Check(RequestSchema, value)) throw new CadError('invalid-topology-request', 'Name the body and the build whose topology adjacency is wanted.');
  return Object.freeze({ bodyId: value.bodyId, expectedBuildId: value.expectedBuildId });
}

const plainArray = (value: unknown): value is unknown[] => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
const keyed = (value: unknown, length?: number): value is string[] => plainArray(value) && (length === undefined || value.length === length)
  && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 128);
const integers = (value: unknown, length: number, low: number, high: number): value is number[] => plainArray(value) && value.length === length
  && value.every(item => Number.isInteger(item) && (item as number) >= low && (item as number) < high);

/** Worker data checked field by field: own plain arrays of the stated lengths, indices in range, keys distinct and tangents unit or zero. */
export function isCadTopologyAdjacency(value: unknown): value is CadTopologyAdjacency {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const data = value as Record<string, unknown>;
  const names = ['bodyId', 'buildId', 'edges', 'edgeVertices', 'edgeTangents', 'edgeFaces', 'edgeSmooth', 'faces', 'faceLoops'];
  if (Object.keys(data).length !== names.length || names.some(name => !Object.hasOwn(data, name))) return false;
  if (typeof data.bodyId !== 'string' || !Value.Check(identifier, data.bodyId) || typeof data.buildId !== 'string' || !Value.Check(opaque, data.buildId)) return false;
  if (!keyed(data.edges) || !keyed(data.faces) || data.edges.length + data.faces.length > MAX_CAD_TOPOLOGY_ADJACENCY_ELEMENTS) return false;
  const edgeCount = data.edges.length, faceCount = data.faces.length;
  if (new Set(data.edges).size !== edgeCount || new Set(data.faces).size !== faceCount) return false;
  if (!integers(data.edgeVertices, edgeCount * 2, 0, Number.MAX_SAFE_INTEGER) || !integers(data.edgeFaces, edgeCount * 2, -1, faceCount)) return false;
  if (!plainArray(data.edgeSmooth) || data.edgeSmooth.length !== edgeCount || data.edgeSmooth.some(item => typeof item !== 'boolean')) return false;
  const tangents = data.edgeTangents;
  if (!plainArray(tangents) || tangents.length !== edgeCount * 6 || tangents.some(item => typeof item !== 'number' || !Number.isFinite(item))) return false;
  for (let at = 0; at < tangents.length; at += 3) {
    const length = Math.hypot(tangents[at] as number, tangents[at + 1] as number, tangents[at + 2] as number);
    if (length !== 0 && Math.abs(length - 1) > CAD_PRECISION.kernelDirection) return false;
  }
  const loops = data.faceLoops;
  if (!plainArray(loops) || loops.length !== faceCount) return false;
  for (const face of loops) {
    if (!plainArray(face)) return false;
    for (const loop of face) if (!plainArray(loop) || !integers(loop, loop.length, 0, edgeCount)) return false;
  }
  return true;
}
