import { describe, expect, it } from 'vitest';
import { portableUpidIntentFixture } from '@/domain/upid/__tests__/portableUpidIntentFixture';
import { workbenchSiteTools, type WorkbenchToolState } from './workbenchSiteTools';

describe('workbench site queries', () => {
  it('identifies the workflow blocking edits in context', async () => {
    const state: WorkbenchToolState = { workbench: null, busy: false, draft: { projectId: 'test', version: 'v1', document: portableUpidIntentFixture(), dirty: true, workflowOpen: true, workflowCommand: 'start-point' } };
    const context = workbenchSiteTools(() => state).find(tool => tool.name === 'edm_get_context')!;
    expect(await context.execute({})).toMatchObject({ ok: true, data: { draft: { workflowOpen: true, workflowCommand: 'start-point', editsAvailable: false } } });
    state.draft!.workflowOpen = false;
    expect(await context.execute({})).toMatchObject({ ok: true, data: { draft: { workflowCommand: null } } });
  });

  it('returns complete ordered geometry across byte-limited pages', async () => {
    const document = portableUpidIntentFixture();
    document.segments = Array.from({ length: 20 }, (_, index) => ({ ...document.segments[0], id: `segment-${index}`, layer: '部品'.repeat(600) }));
    const operation = document.plan.operations[0];
    operation.segmentRefs = [...document.segments].reverse().map(segment => ({ segmentId: segment.id, reversed: true }));
    const query = workbenchSiteTools(() => ({ workbench: null, busy: false, draft: { projectId: 'test', version: 'v1', document, dirty: true, workflowOpen: false } })).find(tool => tool.name === 'edm_query_geometry')!;
    const ids: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const result = await query.execute({ target: { kind: 'current-draft', version: 'v1' }, kind: 'segments', operationId: operation.id, limit: 50, offset }) as { ok: boolean; data: { items: { id: string; reversed: boolean }[]; nextOffset: number | null } };
      expect(result.ok).toBe(true);
      expect(result.data.items.every(item => item.reversed)).toBe(true);
      ids.push(...result.data.items.map(item => item.id));
      offset = result.data.nextOffset;
    }
    expect(ids).toEqual(operation.segmentRefs.map(ref => ref.segmentId));
  });

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
