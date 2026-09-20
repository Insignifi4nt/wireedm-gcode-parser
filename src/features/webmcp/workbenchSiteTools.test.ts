import { describe, expect, it } from 'vitest';
import { portableUpidIntentFixture } from '@/domain/upid/__tests__/portableUpidIntentFixture';
import { workbenchSiteTools, type WorkbenchToolState } from './workbenchSiteTools';

describe('workbench site queries', () => {
  it('reads the unsaved draft, rejects old versions and preserves the document', async () => {
    const document = portableUpidIntentFixture();
    const before = JSON.stringify(document);
    const state: WorkbenchToolState = { workbench: null, busy: false, draft: { projectId: 'test', version: 'draft-1', document, dirty: true, workflowOpen: false } };
    const tools = workbenchSiteTools(() => state);
    const call = (name: string, input: unknown) => tools.find((tool) => tool.name === name)!.execute(input);
    expect(await call('edm_get_context', {})).toMatchObject({ ok: true, data: { draft: { dirty: true, version: 'draft-1' } } });
    expect(await call('edm_query_geometry', { target: { kind: 'current-draft', version: 'draft-1' }, kind: 'segments', limit: 1 })).toMatchObject({ ok: true, data: { units: 'mm', items: [document.segments[0]] } });
    state.draft = { ...state.draft!, version: 'draft-2' };
    expect(await call('edm_get_project', { target: { kind: 'current-draft', version: 'draft-1' } })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    state.draft = null;
    expect(await call('edm_get_project', { target: { kind: 'current-draft', version: 'draft-2' } })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('paginates exact ordered operation segments and rejects unknown operations', async () => {
    const document = portableUpidIntentFixture();
    const tools = workbenchSiteTools(() => ({ workbench: null, busy: false, draft: { projectId: 'test', version: 'v1', document, dirty: false, workflowOpen: false } }));
    const query = tools.find(({ name }) => name === 'edm_query_geometry')!;
    const input = { target: { kind: 'current-draft', version: 'v1' }, kind: 'segments', operationId: document.plan.operations[0].id, limit: 1 };
    expect(await query.execute(input)).toMatchObject({ ok: true, data: { items: [{ id: document.plan.operations[0].segmentRefs[0].segmentId, reversed: document.plan.operations[0].segmentRefs[0].reversed }] } });
    expect(await query.execute({ ...input, operationId: 'missing' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(await query.execute({ ...input, limit: 500 })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } });
  });

  it('filters by the exact long operation ID returned from an imported document', async () => {
    const document = portableUpidIntentFixture();
    const operationId = `external-operation-${'assembly-component-'.repeat(12)}`;
    document.plan.operations[0].id = operationId;
    const tools = workbenchSiteTools(() => ({ workbench: null, busy: false, draft: { projectId: 'test', version: 'v1', document, dirty: false, workflowOpen: false } }));
    const query = tools.find(({ name }) => name === 'edm_query_geometry')!;
    const target = { kind: 'current-draft', version: 'v1' };
    expect(await query.execute({ target, kind: 'operations' })).toMatchObject({ ok: true, data: { items: [{ id: operationId }] } });
    expect(await query.execute({ target, kind: 'segments', operationId })).toMatchObject({ ok: true, data: { items: [{ id: document.segments[0].id }] } });
  });
});
