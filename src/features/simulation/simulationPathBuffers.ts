import type { Point2 } from '@/domain/path-intel/types';

interface PathStep { readonly path: readonly Point2[]; readonly event: { readonly kind: string } }
export type SimulationPathKind = 'cut' | 'position';
export interface SimulationPathBatch {
  readonly positions: Float32Array;
  /** Vertex count after each complete execution-step prefix, including non-motion events. */
  readonly completedVertexCounts: Uint32Array;
}
export interface SimulationPathBuffers {
  readonly cut: SimulationPathBatch;
  readonly position: SimulationPathBatch;
  readonly active: Float32Array;
  readonly steps: readonly PathStep[];
  readonly z: number;
  readonly origin: Readonly<Point2 & { z: number }>;
  activeStepIndex: number | null;
  previousTipIndex: number;
}
export interface ActiveSimulationPath {
  readonly kind: SimulationPathKind | null;
  readonly vertexCount: number;
  readonly updates: readonly { readonly start: number; readonly count: number }[];
}

function pathKind(step: PathStep): SimulationPathKind { return step.event.kind === 'motion' ? 'cut' : 'position'; }

export function createSimulationPathBuffers(steps: readonly PathStep[], z: number, origin: Readonly<Point2 & { z: number }> = { x: 0, y: 0, z: 0 }): SimulationPathBuffers {
  const counts = { cut: 0, position: 0 };
  let largestPath = 2;
  for (const step of steps) {
    counts[pathKind(step)] += Math.max(0, step.path.length - 1) * 2;
    largestPath = Math.max(largestPath, step.path.length);
  }
  const create = (vertices: number): SimulationPathBatch => ({ positions: new Float32Array(vertices * 3), completedVertexCounts: new Uint32Array(steps.length + 1) });
  const buffers: SimulationPathBuffers = { cut: create(counts.cut), position: create(counts.position),
    active: new Float32Array(largestPath * 3), steps, z, origin: { ...origin }, activeStepIndex: null, previousTipIndex: -1 };
  const cursors = { cut: 0, position: 0 };
  steps.forEach((step, stepIndex) => {
    const kind = pathKind(step);
    for (let index = 1; index < step.path.length; index++) {
      for (const point of [step.path[index - 1], step.path[index]]) {
        const offset = cursors[kind] * 3;
        buffers[kind].positions.set([point.x - origin.x, point.y - origin.y, z - origin.z], offset);
        cursors[kind]++;
      }
    }
    buffers.cut.completedVertexCounts[stepIndex + 1] = cursors.cut;
    buffers.position.completedVertexCounts[stepIndex + 1] = cursors.position;
  });
  return buffers;
}

/** The complete active path uploads once per event. Each frame then changes only its exact tip. */
export function updateActiveSimulationPath(
  buffers: SimulationPathBuffers, stepIndex: number | null, fraction: number, tip: Point2
): ActiveSimulationPath {
  const step = stepIndex === null ? null : buffers.steps[stepIndex];
  if (!step || step.path.length < 2) return { kind: null, vertexCount: 0, updates: [] };
  const updates: { start: number; count: number }[] = [];
  const writePoint = (index: number, point: Point2) => buffers.active.set([
    point.x - buffers.origin.x, point.y - buffers.origin.y, buffers.z + 0.02 - buffers.origin.z
  ], index * 3);
  if (buffers.activeStepIndex !== stepIndex) {
    step.path.forEach((point, index) => writePoint(index, point));
    updates.push({ start: 0, count: step.path.length * 3 });
    buffers.activeStepIndex = stepIndex;
  } else if (buffers.previousTipIndex >= 0) {
    // Restore the tessellated vertex overwritten by the last frame, including reverse seeks.
    writePoint(buffers.previousTipIndex, step.path[buffers.previousTipIndex]);
    updates.push({ start: buffers.previousTipIndex * 3, count: 3 });
  }
  const tipIndex = Math.max(1, Math.min(step.path.length - 1, Math.ceil((step.path.length - 1) * Math.max(0, Math.min(1, fraction)))));
  writePoint(tipIndex, tip);
  if (updates[0]?.start !== 0 || updates[0]?.count !== step.path.length * 3) updates.push({ start: tipIndex * 3, count: 3 });
  buffers.previousTipIndex = tipIndex;
  return { kind: pathKind(step), vertexCount: tipIndex + 1, updates };
}
