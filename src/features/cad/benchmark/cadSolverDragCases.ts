import { parseCadSketchGraph, type CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import type { CadSketchSolveInput } from '../sketch-solver/cadSketchSolverTypes';
import { createCadSolverDieInput, createCadSolverFreeDieInput } from './cadSolverWorkloadCases';

export type CadSolverDrag = NonNullable<CadSketchSolveInput['drag']>;
export interface CadSolverDragTrajectory {
  readonly id: string;
  readonly description: string;
  readonly input: CadSketchSolveInput;
  readonly frames: readonly CadSolverDrag[];
}

const line = (id: string, startPointId: string, endPointId: string) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId });
const distance = (id: string, from: string, to: string, value: number): CadSketchGraphRelation => ({ id, kind: 'distance', pointIds: [from, to], value });

/**
 * Pointer paths through the cases that decide drag behavior. The die's slot frees one freedom of a
 * connected die and reverses, with frame 45 off its manifold. The arm's tip leaves a 20 mm reach
 * and returns; nearly straight frames are where native's rank estimate is least sure. The four-bar
 * is dragged far past reach, where a single jump can reassemble it the other way up, as PlaneGCS's
 * did before 0.0.757. The tangency case ends exactly on the tangency of a circle and a fixed axis.
 */
export function createCadSolverDragTrajectories(): CadSolverDragTrajectory[] {
  const die = createCadSolverDieInput();
  const arm = parseCadSketchGraph({ points: [{ id: 'c', position: ['0', '0'] }, { id: 'p', position: [6, 8] }, { id: 'q', position: [16, 8] }],
    entities: [line('cp', 'c', 'p'), line('pq', 'p', 'q')], relations: [distance('upper', 'c', 'p', 10), distance('lower', 'p', 'q', 10)] });
  const fourBar = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['10', '0'] }, { id: 'c', position: [6, 8] }, { id: 'd', position: [10, 11] }],
    entities: [line('ac', 'a', 'c'), line('cd', 'c', 'd'), line('db', 'd', 'b')],
    relations: [distance('ac-length', 'a', 'c', 10), distance('cd-length', 'c', 'd', 5), distance('db-length', 'd', 'b', 11)] });
  const tangent = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'p', position: [10, 1e-5] }], entities: [line('ap', 'a', 'p')],
    relations: [distance('radius', 'a', 'p', 10), { id: 'x', kind: 'fixed-axis', pointId: 'p', axis: 'x', value: 10 }] });
  return [
    { id: 'die-slot', description: 'Connected die with the slot size released: 60 frames up and back, frame 45 unreachable.',
      input: { ...die, graph: parseCadSketchGraph({ ...die.graph, relations: die.graph.relations.filter(relation => relation.id !== 'slotSize') }) },
      frames: Array.from({ length: 60 }, (_, index) => ({ pointId: 'slotA', position: [index === 45 ? 100 : -12, 3 + (index < 30 ? index / 29 : (59 - index) / 29)] as const })) },
    { id: 'arm', description: 'Two 10 mm links: the tip leaves its 20 mm reach along y = 1 and jumps back inside.',
      input: { graph: arm, parameters: {} }, frames: [...Array.from({ length: 46 }, (_, frame) => [10 + 0.25 * frame, 1] as const), [15, 1] as const].map(position => ({ pointId: 'q', position })) },
    { id: 'four-bar', description: 'Four-bar dragged in 10 frames to a target far below its reach.',
      input: { graph: fourBar, parameters: {} }, frames: Array.from({ length: 10 }, (_, index) => ({ pointId: 'c', position: [6 - 26 * (index + 1) / 10, 8 - 26 * (index + 1) / 10] as const })) },
    { id: 'tangency', description: 'A point on a circle and a fixed axis, dragged onto their tangency.',
      input: { graph: tangent, parameters: {} }, frames: [3, 2, 1, 0].map(step => ({ pointId: 'p', position: [10, step * 2.5e-6] as const })) }
  ];
}

/** Every point of the die and the free die whose coordinates are both free and that the app lets the user drag, each dragged by a nudge, a typical move and a far move. */
export function createCadSolverDragSweep() {
  return [{ id: 'die', input: createCadSolverDieInput() }, { id: 'free-die', input: createCadSolverFreeDieInput() }]
    .map(({ id, input }) => ({ id, input, moves: [[.5, .3], [40, -25], [-120, 80]] as const }));
}
