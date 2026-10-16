import { describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { jsonByteLength } from '@/features/webmcp/diagnosticSummaries';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { cadSiteTools } from './cadSiteTools';
import type { CadController } from './useCadController';

describe('CAD tool structured sketch rejection', () => {
  it('retains exact machine identities and candidate labels within the tool byte budget', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => `r${index}`.padEnd(96, 'x'));
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }], entities: [],
      relations: ids.map(id => ({ id, kind: 'distance', pointIds: ['a', 'b'], value: 20 })) });
    const rawMessage = `Native ${ids[0]} ${'🧭\n"'.repeat(4000)}`;
    const failure = new CadSketchPreparationError({ sketchId: 'sketch', sketchName: 'Outline', graph, rejection: {
      kind: 'rejected', reason: 'conflicting', message: rawMessage, diagnostics: { status: 'success', degreesOfFreedom: -1,
        conflictingIds: ids, redundantIds: ids, partiallyRedundantIds: ids,
        issues: ids.slice(0, 3).map(id => ({ source: { kind: 'relation', id }, code: 'relation-residual', message: rawMessage, residualMm: 10 })) }
    } });
    const getController = vi.fn<() => CadController>(() => { throw failure; });
    const tool = cadSiteTools(getController).find(tool => tool.name === 'cad_edit_document');
    if (!tool) throw new Error('Missing document edit tool.');
    const reply = await tool.execute({ expectedVersion: 'current', edits: [{ kind: 'rename-document', name: 'Pending' }] });
    expect(reply).toMatchObject({ ok: false, error: { code: 'sketch-conflicting', message: 'Outline: Sketch constraints conflict.', details: {
      feedback: { sketchId: 'sketch', reason: 'conflicting', subjectCount: 39, omittedSubjectCount: 31,
        subjects: [{ source: { kind: 'relation', id: ids[0] }, category: 'conflicting', label: 'Distance relation 1 · Point 1 and Point 2', pointIds: ['a', 'b'] },
          ...ids.slice(1, 8).map(id => expect.objectContaining({ source: { kind: 'relation', id } }))] },
      analysis: { kind: 'rejected', reason: 'conflicting', status: 'success', degreesOfFreedom: -1, messageTruncated: true,
        conflicting: { ids: ids.slice(0, 8), count: 12, omittedCount: 4 },
        redundant: { ids: ids.slice(0, 8), count: 12, omittedCount: 4 },
        partiallyRedundant: { ids: ids.slice(0, 8), count: 12, omittedCount: 4 },
        issueCount: 3, omittedIssueCount: 1, issues: [expect.objectContaining({ messageTruncated: true }), expect.objectContaining({ messageTruncated: true })] }
    } } });
    expect(jsonByteLength(reply)).toBeLessThan(24 * 1024);
    expect(failure.diagnostics.conflictingIds).toHaveLength(12);
    expect(failure.diagnostics.issues).toHaveLength(3);
    expect(failure.solverMessage).toBe(rawMessage);
    expect(getController).toHaveBeenCalledOnce();
  });
});
