import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { CadError } from '@/domain/cad/cadError';
import { CadSketchPreparationError, describeCadSketchConstraintSource } from './cadSketchConstraintFeedback';
import type { CadSketchSolveResult } from './sketch-solver/cadSketchSolverTypes';

const proposedId = '730718ab-05fb-45fe-a347-00193af0414b';
const graph = () => parseCadSketchGraph({ points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] }],
  entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }],
  relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: proposedId, kind: 'distance', pointIds: ['a', 'b'], value: ' 3 * 4 ' }] });

describe('candidate-owned sketch constraint feedback', () => {
  it.each(['radius', 'diameter'] as const)('names the displayed %s and exact curve operand for radial rejection inspection', quantity => {
    const candidate = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }],
      entities: [{ id: 'circle', kind: 'circle', construction: true, centerPointId: 'center', radius: 6 }],
      relations: [{ id: proposedId, kind: 'radial-size', entityId: 'circle', quantity, value: ' dimension ' }] });
    expect(describeCadSketchConstraintSource(candidate, { kind: 'relation', id: proposedId })).toMatchObject({
      label: `${quantity === 'radius' ? 'Radius' : 'Diameter'} relation 1 · Circle 1`, pointIds: ['center'], entityIds: ['circle']
    });
  });

  it.each(['parallel', 'perpendicular'] as const)('names %s line operands while retaining shared point and entity inspection identities', kind => {
    const candidate = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 8] }],
      entities: [{ id: 'z-edge', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
        { id: 'a-edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'c' }],
      relations: [{ id: proposedId, kind, lineIds: ['z-edge', 'a-edge'] }] });
    const subject = describeCadSketchConstraintSource(candidate, { kind: 'relation', id: proposedId });
    expect(subject.label).toBe(`${kind === 'parallel' ? 'Parallel' : 'Perpendicular'} relation 1 · Line 2 and Line 1`);
    expect(subject.pointIds).toEqual(['a', 'b', 'c']); expect(subject.entityIds).toEqual(['z-edge', 'a-edge']);
  });

  it('preserves a proposed relation and exact operands while presenting a readable detached rejection', () => {
    const candidate = graph(), before = JSON.stringify(candidate);
    const diagnostics = { status: 'success' as const, degreesOfFreedom: 0, conflictingIds: [proposedId, 'horizontal'], redundantIds: [], partiallyRedundantIds: [], issues: [] };
    const rejection = { kind: 'rejected', reason: 'conflicting', message: `Native conflict ${proposedId}`, diagnostics } satisfies Extract<CadSketchSolveResult, { kind: 'rejected' }>;
    const error = new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Outline', graph: candidate, rejection });
    expect(error).toBeInstanceOf(CadError); expect(error.code).toBe('sketch-conflicting');
    expect(error.message).toBe(error.feedback.message); expect(error.message).not.toContain(proposedId);
    expect(error.solverMessage).toBe(rejection.message);
    expect(error.feedback).toMatchObject({ sketchId: 'sketch', reason: 'conflicting', subjectCount: 2, omittedSubjectCount: 0,
      subjects: [{ source: { kind: 'relation', id: proposedId }, category: 'conflicting', label: 'Distance relation 2 · Point 1 and Point 2', pointIds: ['a', 'b'], entityIds: [] },
        { source: { kind: 'relation', id: 'horizontal' }, category: 'conflicting' }] });
    diagnostics.conflictingIds[0] = 'changed-outside';
    expect(error.diagnostics.conflictingIds[0]).toBe(proposedId);
    expect(Reflect.set(error.feedback.subjects[0].pointIds, '0', 'poisoned')).toBe(false);
    expect(JSON.stringify(candidate)).toBe(before);
  });

  it('describes axis, implicit arc and known drag subjects without collapsing failure categories', () => {
    const candidate = parseCadSketchGraph({ points: [{ id: 'center', position: [0, 0] }, { id: 'start', position: [10, 0] }, { id: 'end', position: [0, 10] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'ccw' }],
      relations: [{ id: 'fixed-y', kind: 'fixed-axis', pointId: 'start', axis: 'y', value: 0 }] });
    expect(describeCadSketchConstraintSource(candidate, { kind: 'relation', id: 'fixed-y' }).label).toBe('Fix Y relation 1 · Point 2');
    const error = new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Arc', graph: candidate, dragPointId: 'start', rejection: {
      kind: 'rejected', reason: 'invalid-solution', message: 'Native returned a candidate.', diagnostics: { status: 'converged', degreesOfFreedom: 2,
        conflictingIds: ['arc', 'start'], redundantIds: ['fixed-y'], partiallyRedundantIds: ['fixed-y'],
        issues: [{ source: { kind: 'entity', id: 'arc' }, code: 'arc-radius-mismatch', message: 'Unbounded source prose', residualMm: .01 }] }
    } });
    expect(error.feedback.subjects).toEqual([
      expect.objectContaining({ source: { kind: 'entity', id: 'arc' }, label: 'Arc 1 endpoint radii', category: 'conflicting', pointIds: ['center', 'start', 'end'], entityIds: ['arc'] }),
      expect.objectContaining({ source: { kind: 'point', id: 'start' }, label: 'Move Point 2', category: 'conflicting', pointIds: ['start'] }),
      expect.objectContaining({ source: { kind: 'relation', id: 'fixed-y' }, category: 'redundant' }),
      expect.objectContaining({ source: { kind: 'relation', id: 'fixed-y' }, category: 'partially-redundant' }),
      expect.objectContaining({ source: { kind: 'entity', id: 'arc' }, category: 'issue', code: 'arc-radius-mismatch', detail: 'The arc endpoints have different radii.', residualMm: .01 })
    ]);
    expect(describeCadSketchConstraintSource(candidate, { kind: 'point', id: 'start' }).label).toBe('Point 2');
    expect(error.diagnostics.issues[0].message).toBe('Unbounded source prose');
  });
});
