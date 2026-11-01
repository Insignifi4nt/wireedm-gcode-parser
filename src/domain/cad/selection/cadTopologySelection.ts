import type { CadTopologyAdjacency } from '../cadTopologyAdjacency';
import { CAD_PRECISION } from '../../precision/cadPrecision';
import { cadChainGraph, cadSelectionChain, type CadChainCurve, type CadChainGraph, type CadChainJoin, type CadChainResult } from './cadSelectionChain';

interface SolidEdge extends CadChainCurve { readonly index: number; readonly smooth: boolean }
interface Index {
  readonly chain: CadChainGraph<SolidEdge>;
  readonly edgeIndex: ReadonlyMap<string, number>;
  readonly faceIndex: ReadonlyMap<string, number>;
  /** Per face, the edges on its boundary. */
  readonly faceEdges: readonly (readonly number[])[];
}
const indexes = new WeakMap<CadTopologyAdjacency, Index>();

/** The chain graph and lookups of one body's adjacency, built on first use and kept with it. */
function indexOf(adjacency: CadTopologyAdjacency): Index {
  const kept = indexes.get(adjacency);
  if (kept) return kept;
  const tangent = (edge: number, end: 0 | 1) => {
    const at = edge * 6 + end * 3, value = adjacency.edgeTangents.slice(at, at + 3);
    return value[0] === 0 && value[1] === 0 && value[2] === 0 ? null : value;
  };
  const curves: SolidEdge[] = adjacency.edges.map((id, index) => ({ id, index, smooth: adjacency.edgeSmooth[index],
    vertices: [`v${adjacency.edgeVertices[index * 2]}`, `v${adjacency.edgeVertices[index * 2 + 1]}`], tangents: [tangent(index, 0), tangent(index, 1)] }));
  const index: Index = { chain: cadChainGraph(curves), edgeIndex: new Map(adjacency.edges.map((key, at) => [key, at])),
    faceIndex: new Map(adjacency.faces.map((key, at) => [key, at])), faceEdges: adjacency.faceLoops.map(loops => [...new Set(loops.flat())]) };
  indexes.set(adjacency, index);
  return index;
}

/** Unit directions that agree within the kernel's direction tolerance, `kernelDirection`; a reversal is never smooth. */
function smoothJoin({ arriving, leaving }: CadChainJoin<SolidEdge>): boolean {
  const [ax, ay, az] = arriving, [bx, by, bz] = leaving;
  const dot = ax * bx + ay * by + az * bz;
  return dot > 0 && Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx) <= CAD_PRECISION.kernelDirection;
}

/**
 * The tangent chain of a solid edge: the edges continuing it without a turn, vertex by vertex, as a fillet follows tangent edges. Edges
 * where faces meet smoothly join only a chain seeded by one, so a corner's chain never runs into a blend's boundary. Where two edges could
 * continue it, the chain stops and reports the vertex.
 */
export function cadTopologyEdgeChain(adjacency: CadTopologyAdjacency, edgeKey: string): CadChainResult {
  return cadSelectionChain(indexOf(adjacency).chain, edgeKey, { mode: 'tangent', smooth: smoothJoin, eligible: (curve, seed) => curve.smooth === seed.smooth });
}

/** The faces either side of an edge, without repeats. */
export function cadTopologyEdgeFaces(adjacency: CadTopologyAdjacency, edgeKey: string): string[] {
  const edge = indexOf(adjacency).edgeIndex.get(edgeKey);
  if (edge === undefined) return [];
  return [...new Set([adjacency.edgeFaces[edge * 2], adjacency.edgeFaces[edge * 2 + 1]].filter(face => face >= 0))].map(face => adjacency.faces[face]);
}

/** The boundary loop of `faceKey` that holds the edge, or `null` when the edge does not bound that face. */
export function cadTopologyFaceLoop(adjacency: CadTopologyAdjacency, faceKey: string, edgeKey: string): string[] | null {
  const { faceIndex, edgeIndex } = indexOf(adjacency), face = faceIndex.get(faceKey), edge = edgeIndex.get(edgeKey);
  if (face === undefined || edge === undefined) return null;
  const loop = adjacency.faceLoops[face].find(members => members.includes(edge));
  return loop ? [...new Set(loop)].map(member => adjacency.edges[member]) : null;
}

/** The faces reached from `faceKey` across edges where faces meet without a crease, the seed first. */
export function cadTopologyTangentFaces(adjacency: CadTopologyAdjacency, faceKey: string): string[] {
  const { faceIndex, faceEdges } = indexOf(adjacency), seed = faceIndex.get(faceKey);
  if (seed === undefined) return [];
  const reached = [seed], seen = new Set(reached);
  for (let cursor = 0; cursor < reached.length; cursor++) {
    for (const edge of faceEdges[reached[cursor]]) {
      if (!adjacency.edgeSmooth[edge]) continue;
      for (const face of [adjacency.edgeFaces[edge * 2], adjacency.edgeFaces[edge * 2 + 1]]) {
        if (face >= 0 && !seen.has(face)) { seen.add(face); reached.push(face); }
      }
    }
  }
  return reached.map(face => adjacency.faces[face]);
}

/** What a chain gesture on a solid asks for: the boundary loop through an edge, or the tangent run of an edge or a face. */
export type CadTopologyChainGesture = 'loop' | 'tangent';
export interface CadTopologyChainPicks {
  readonly kind: 'edge' | 'face';
  readonly keys: readonly string[];
  readonly name: 'Loop' | 'Tangent chain' | 'Tangent faces';
  readonly closed: boolean;
  /** Vertices where a tangent chain could have continued two ways and stopped instead. */
  readonly branches: number;
}

/**
 * The picks a chain gesture selects from one seed. A loop is the boundary loop holding the edge on `faceKey`, the face under the pointer,
 * or on the edge's first face when the edge does not bound that one. A face always takes its tangent faces. Unknown seeds give `null`.
 */
export function cadTopologyChainPicks(adjacency: CadTopologyAdjacency, seed: { readonly kind: 'edge' | 'face'; readonly key: string }, gesture: CadTopologyChainGesture, faceKey: string | null = null): CadTopologyChainPicks | null {
  if (seed.kind === 'face') {
    const keys = cadTopologyTangentFaces(adjacency, seed.key);
    return keys.length ? { kind: 'face', keys, name: 'Tangent faces', closed: false, branches: 0 } : null;
  }
  if (!indexOf(adjacency).edgeIndex.has(seed.key)) return null;
  if (gesture === 'tangent') {
    const chain = cadTopologyEdgeChain(adjacency, seed.key);
    return { kind: 'edge', keys: chain.ids, name: 'Tangent chain', closed: chain.closed, branches: chain.branches.length };
  }
  const faces = cadTopologyEdgeFaces(adjacency, seed.key), face = faceKey && faces.includes(faceKey) ? faceKey : faces[0];
  const keys = face ? cadTopologyFaceLoop(adjacency, face, seed.key) : null;
  return keys ? { kind: 'edge', keys, name: 'Loop', closed: true, branches: 0 } : { kind: 'edge', keys: [seed.key], name: 'Loop', closed: false, branches: 0 };
}
