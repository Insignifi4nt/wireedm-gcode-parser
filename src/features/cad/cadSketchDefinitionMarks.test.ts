import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { cadSketchDefinitionMarks, cadSketchDiagnosisMarks, cadSketchGeometryMark } from './cadSketchDefinitionMarks';

/** Ten separate lines, each held horizontal by its own relation. */
const ladder = () => parseCadSketchGraph({
  points: Array.from({ length: 20 }, (_, index) => ({ id: `p${index}`, position: [index % 2 * 10, Math.floor(index / 2) * 5] })),
  entities: Array.from({ length: 10 }, (_, index) => ({ id: `rung${index}`, kind: 'line', construction: false, startPointId: `p${index * 2}`, endPointId: `p${index * 2 + 1}` })),
  relations: Array.from({ length: 10 }, (_, index) => ({ id: `level${index}`, kind: 'horizontal', pointIds: [`p${index * 2}`, `p${index * 2 + 1}`] })) });
const ids = (set: ReadonlySet<string>) => [...set].sort();

describe('sketch definition and diagnosis marks', () => {
  it('marks every operand a rejection reports, beyond the eight subjects its feedback summarizes', () => {
    const graph = ladder(), relations = graph.relations.map(relation => relation.id);
    const error = new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Ladder', graph, rejection: { kind: 'rejected', reason: 'redundant', message: 'Redundant.',
      diagnostics: { status: 'failed', degreesOfFreedom: null, conflictingIds: [], redundantIds: relations.slice(0, 9), partiallyRedundantIds: relations.slice(9), issues: [] } } });
    expect(error.feedback.subjects).toHaveLength(8); expect(error.feedback.omittedSubjectCount).toBe(2);
    expect(ids(error.marks!.redundant.pointIds)).toEqual(graph.points.map(point => point.id).sort());
    expect(error.marks!.conflicting.pointIds.size).toBe(0);
    // A horizontal relation holds points only; its lines stay as they are.
    expect(error.marks!.redundant.entityIds.size).toBe(0);
  });

  it('expands relations, structural edges and dragged points, skipping identities the graph lacks', () => {
    const graph = ladder();
    const marks = cadSketchDiagnosisMarks('sketch', graph, { conflictingIds: ['rung3', 'p0', 'gone'], redundantIds: ['level5'], partiallyRedundantIds: [] })!;
    expect([ids(marks.conflicting.pointIds), ids(marks.conflicting.entityIds)]).toEqual([['p0', 'p6', 'p7'], ['rung3']]);
    expect([ids(marks.redundant.pointIds), ids(marks.redundant.entityIds)]).toEqual([['p10', 'p11'], []]);
    // Conflicting draws above redundant, and both above defined.
    const definition = cadSketchDefinitionMarks({ definedPointIds: ['p0', 'p10', 'p12'], underDefinedPointIds: [], definedEntityIds: ['rung3', 'rung6'], underDefinedEntityIds: [] });
    expect(['p0', 'p10', 'p12', 'p14'].map(id => cadSketchGeometryMark('point', id, definition, marks))).toEqual(['conflicting', 'redundant', 'defined', null]);
    expect(['rung3', 'rung6'].map(id => cadSketchGeometryMark('entity', id, definition, marks))).toEqual(['conflicting', 'defined']);
    expect(cadSketchDiagnosisMarks('sketch', graph, { conflictingIds: [], redundantIds: [], partiallyRedundantIds: [] })).toBeNull();
  });

  it('keeps the earlier marks for an equal answer and replaces them for a changed one', () => {
    const definition = { definedPointIds: ['a', 'b'], underDefinedPointIds: ['c'], definedEntityIds: ['ab'], underDefinedEntityIds: [] };
    const first = cadSketchDefinitionMarks(definition)!;
    expect(cadSketchDefinitionMarks({ ...definition, definedPointIds: ['b', 'a'], underDefinedPointIds: [] }, first)).toBe(first);
    const changed = cadSketchDefinitionMarks({ ...definition, definedPointIds: ['a'] }, first)!;
    expect(changed).not.toBe(first); expect(changed.revision).not.toBe(first.revision);
    expect(cadSketchDefinitionMarks(undefined, first)).toBeNull();
    const graph = ladder(), diagnosis = cadSketchDiagnosisMarks('sketch', graph, { conflictingIds: ['level1'], redundantIds: [], partiallyRedundantIds: [] });
    expect(cadSketchDiagnosisMarks('sketch', graph, { conflictingIds: ['level1'], redundantIds: [], partiallyRedundantIds: [] }, diagnosis)).toBe(diagnosis);
    expect(cadSketchDiagnosisMarks('other', graph, { conflictingIds: ['level1'], redundantIds: [], partiallyRedundantIds: [] }, diagnosis)).not.toBe(diagnosis);
  });
});
