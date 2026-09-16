import { describe, expect, it } from 'vitest';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { readSavedRevisionSummaryPage } from '../revisionSummaries';

describe('saved revision summary paging', () => {
  it('reads only the requested page and keeps missing rows selectable', async () => {
    const reads: string[] = [];
    const adapter: WorkbenchStorageAdapter = {
      kind: 'memory', name: 'summary-test',
      async ensureDirectory() {},
      async readText(path) {
        reads.push(path);
        const id = path.match(/revision\.\d+/)?.[0];
        if (id === 'revision.0085') return null;
        return JSON.stringify({ format: 'wire-edm-job-revision', revisionId: id,
          project: { id: 'gear' }, savedAt: '2026-09-17T00:00:00.000Z',
          machine: { name: 'Machine' }, post: { installation: { ref: { packageId: 'post' } } },
          executionPlan: { events: Array.from({ length: 1000 }, (_, index) => index) } });
      },
      async writeText() {}, async deleteText() {}
    };
    const ids = Array.from({ length: 100 }, (_, index) => `revision.${String(index).padStart(4, '0')}`);
    const rows = await readSavedRevisionSummaryPage(adapter, 'gear', ids, 0);
    expect(rows).toHaveLength(20);
    expect(reads).toHaveLength(20);
    expect(rows[0].revisionId).toBe('revision.0099');
    expect(rows[14]).toMatchObject({ revisionId: 'revision.0085', savedAt: null,
      loadError: 'Saved revision file is missing.' });
    expect(rows[19]).toMatchObject({ revisionId: 'revision.0080', machineName: 'Machine' });
  });
});
