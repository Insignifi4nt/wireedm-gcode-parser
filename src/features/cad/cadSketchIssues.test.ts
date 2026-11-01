import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { cadSketchAnalysisIssues, cadSketchIssuesStandInForD1 } from './cadSketchIssues';
import type { CadSketchSolveDiagnostics } from './sketch-solver/cadSketchSolverTypes';

const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }, { id: 'd', position: [5, -5] }, { id: 'e', position: [5, 15] }],
  entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
    { id: 'de', kind: 'line', construction: true, startPointId: 'd', endPointId: 'e' }],
  relations: [{ id: 'flat', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'again', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: 10 },
    { id: 'mirror', kind: 'symmetric', pointIds: ['a', 'b'], lineId: 'de' }] });
const diagnostics = (overrides: Partial<CadSketchSolveDiagnostics>): CadSketchSolveDiagnostics => ({ status: 'success', degreesOfFreedom: 0, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [], ...overrides });

describe('sketch issues before D1', () => {
  it('lists the accepted analysis by category, with each relation keyed for its tree row', () => {
    const analysis = cadSketchAnalysisIssues({ kind: 'rejected', reason: 'redundant', diagnostics: diagnostics({ redundantIds: ['again'], partiallyRedundantIds: ['flat'],
      issues: [{ source: { kind: 'relation', id: 'width' }, code: 'relation-residual', message: 'Off by 1.', residualMm: 1 }, { source: { kind: 'entity', id: 'bc' }, code: 'degenerate-entity', message: 'Short.' }] }) });
    const issues = cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph, analysis });
    expect(issues.message).toBe('Sketch constraints are redundant.');
    expect(issues.list.map(issue => [issue.category, issue.state, issue.relationId, issue.origin])).toEqual([
      ['redundant', 'Redundant', 'again', 'analysis'], ['partially-redundant', 'Partly redundant', 'flat', 'analysis'],
      ['not-met', 'Not met', 'width', 'analysis'], ['geometry', 'Geometry issue', null, 'analysis']]);
    expect(issues.byRelation.get('width')?.map(issue => issue.category)).toEqual(['not-met']);
    expect(issues.list[3]).toMatchObject({ label: 'Line 2', pointIds: ['b', 'c'], entityIds: ['bc'], detail: 'The edge endpoints are too close.' });
  });
  it('prefers the refused edit of this sketch to the analysis, and keeps what it left out', () => {
    const analysis = cadSketchAnalysisIssues({ kind: 'rejected', reason: 'redundant', diagnostics: diagnostics({ redundantIds: ['again'] }) });
    const refused = new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Plate', graph, rejection: { kind: 'rejected', reason: 'conflicting', message: 'No.',
      diagnostics: diagnostics({ conflictingIds: ['width', 'flat', 'again', 'mirror', 'a', 'b', 'c', 'ab', 'bc', 'de'] }) } }).feedback;
    const issues = cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph, analysis, feedback: refused });
    expect(issues.message).toBe('Plate: Sketch constraints conflict.');
    expect(issues.list.every(issue => issue.origin === 'edit' && issue.category === 'conflicting')).toBe(true);
    expect([issues.list.length, issues.omitted]).toEqual([8, 2]);
    // Another sketch's refusal leaves this sketch's analysis shown.
    expect(cadSketchIssuesStandInForD1({ sketchId: 'other', graph, analysis, feedback: refused }).list.map(issue => issue.origin)).toEqual(['analysis']);
  });
  it('adds the shrink warnings of the last accepted edit on this sketch to the relation that shrank its curves', () => {
    const warning = { code: 'mirror-shrank' as const, relationId: 'mirror', curves: [{ entityId: 'ab', beforeMm: 10, afterMm: 0.01 }], message: 'Symmetric shrank Line 1.', sketchId: 'sketch', sketchName: 'Plate' };
    const issues = cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph, warnings: [warning, { ...warning, sketchId: 'other' }, { ...warning, relationId: 'removed' }] });
    expect(issues.message).toBeNull();
    expect(issues.list).toHaveLength(1);
    expect(issues.list[0]).toMatchObject({ category: 'shrink', state: 'Shrinks', relationId: 'mirror', origin: 'warning', detail: 'Symmetric shrank Line 1.' });
    expect(issues.list[0].entityIds).toEqual(expect.arrayContaining(['ab', 'de']));
    expect(issues.byRelation.get('mirror')).toHaveLength(1);
  });
  it('keeps an analysis that names nothing as no issues, and an equal analysis as the same value', () => {
    expect(cadSketchAnalysisIssues({ kind: 'solved', diagnostics: diagnostics({}) })).toBeNull();
    const first = cadSketchAnalysisIssues({ kind: 'solved', diagnostics: diagnostics({ redundantIds: ['again'] }) });
    expect(cadSketchAnalysisIssues({ kind: 'solved', diagnostics: diagnostics({ redundantIds: ['again'] }) }, first)).toBe(first);
    expect(cadSketchIssuesStandInForD1({ sketchId: 'sketch', graph }).list).toEqual([]);
  });
});
