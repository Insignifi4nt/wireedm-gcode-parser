import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { recoveryStorageSource } from '@/domain/storage/workbenchRecovery';
import { prepareDxfProjectImport } from '@/domain/dxf/prepareDxfProjectImport';
import { useWorkbenchActions } from '@/features/webmcp/useWorkbenchActions';
import type { DraftReadSnapshot } from '@/features/webmcp/workbenchSiteTools';
import type { SiteTool } from '@/features/webmcp/siteTools';
import { useWorkbenchAppController } from './useWorkbenchAppController';
import { defaultAppServices, type AppServices } from './appServices';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); localStorage.clear(); vi.restoreAllMocks(); });

async function harness(overrides: Partial<AppServices> = {}, corrupt = true) {
  if (corrupt) localStorage.setItem('wire-edm-workbench:file:workbench.json', '\uFEFF{broken');
  let app!: ReturnType<typeof useWorkbenchAppController>; let tools: SiteTool[] = [];
  const download = vi.fn<AppServices['downloadTextFile']>();
  function Harness() {
    app = useWorkbenchAppController({ connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }), downloadTextFile: download, ...overrides });
    tools = useWorkbenchActions(app, useRef<DraftReadSnapshot | null>(null)).tools;
    return null;
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(<Harness />); });
  async function call(name: string, input: unknown, signal?: AbortSignal) {
    let result: unknown; await act(async () => { result = await tools.find(tool => tool.name === name)!.execute(input, { signal }); });
    return result as { ok: boolean; data: Record<string, any>; error: { code: string } };
  }
  return { app: () => app, download, call, execute: (name: string, input: unknown, signal?: AbortSignal) => tools.find(tool => tool.name === name)!.execute(input, { signal }) };
}

it('exposes failed startup source to agents and downloads exact evidence through the shared guarded handler', async () => {
  const h = await harness();
  expect(h.app().connectedWorkbench).toBeNull(); expect(h.app().workbenchStatus).toBe('error');
  const context = await h.call('edm_workflow_context', {});
  expect(context.data.nextSteps).toContain('edm_export_recovery');
  const exported = await h.call('edm_export_recovery', { sourceId: context.data.recovery.source.id });
  expect(exported).toMatchObject({ ok: true, data: { status: 'download-requested', receipt: { capturedFiles: 1, contentComplete: true } } });
  const archive = JSON.parse(h.download.mock.calls[0][0].text);
  expect(archive.files[0]).toMatchObject({ path: 'workbench.json', text: '\uFEFF{broken' });
  expect(exported.data).not.toHaveProperty('text'); expect(h.app().recoveryControls?.receipt).toEqual(exported.data.receipt);
  expect(new TextEncoder().encode(JSON.stringify(exported)).length).toBeLessThan(32 * 1024);
  expect(localStorage.getItem('wire-edm-workbench:file:workbench.json')).toBe('\uFEFF{broken');
});

it('retains the exact captured archive and receipt after download failure and retries without rereading', async () => {
  const capture = vi.fn(defaultAppServices.captureWorkbenchRecovery);
  const download = vi.fn<AppServices['downloadTextFile']>().mockImplementationOnce(() => { throw new Error('Download blocked'); });
  const h = await harness({ captureWorkbenchRecovery: capture, downloadTextFile: download });
  const sourceId = h.app().recoveryControls!.source.id;
  expect(await h.call('edm_export_recovery', { sourceId })).toMatchObject({ ok: true, data: { status: 'captured-download-failed', error: { code: 'DOWNLOAD_FAILED' } } });
  const receipt = h.app().recoveryControls!.receipt;
  localStorage.setItem('wire-edm-workbench:file:workbench.json', 'changed after capture');
  expect(await h.call('edm_export_recovery', { sourceId, downloadPrepared: true })).toMatchObject({ ok: true, data: { status: 'download-requested', receipt } });
  expect(capture).toHaveBeenCalledOnce(); expect(download.mock.calls[1][0]).toEqual(download.mock.calls[0][0]);
});

it('invalidates captured receipts and old source versions after switching to healthy storage', async () => {
  const healthy = await initializeWorkbenchCatalog(createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() }));
  const h = await harness({ connectWorkbenchDirectory: async () => healthy });
  const sourceId = h.app().recoveryControls!.source.id;
  await h.call('edm_export_recovery', { sourceId });
  await act(async () => { await h.app().handleConnectWorkbench(); });
  expect(h.app().recoveryControls).toBeNull(); expect(h.app().connectedWorkbench).not.toBeNull();
  expect(await h.call('edm_export_recovery', { sourceId, downloadPrepared: true })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
  expect(h.download).toHaveBeenCalledOnce();
});

it('exports the failed folder when a healthy cache stays active', async () => {
  const handle = new FakeDirectoryHandle('failed-folder'); handle.files.set('workbench.json', 'folder original');
  const adapter = createBrowserDirectoryAdapter(handle as unknown as FileSystemDirectoryHandle);
  const recoverySource = recoveryStorageSource(adapter, { code: 'WORKBENCH_CATALOG_JSON_INVALID', message: 'Folder catalog invalid' });
  const h = await harness({ connectWorkbenchDirectory: async () => ({ ok: false, error: { code: 'WORKBENCH_CATALOG_JSON_INVALID', message: 'Folder catalog invalid' }, recoverySource }) }, false);
  const healthy = h.app().connectedWorkbench;
  await act(async () => { await h.app().handleConnectWorkbench(); });
  expect(h.app().connectedWorkbench).toBe(healthy); expect(h.app().workbenchStatus).toBe('ready');
  expect(h.app().recoveryControls?.source).toMatchObject({ kind: 'directory', name: 'failed-folder' });
  await h.call('edm_export_recovery', { sourceId: recoverySource.id });
  expect(JSON.parse(h.download.mock.calls[0][0].text).files[0].text).toBe('folder original');
});

it('rejects recovery capture while a live agent DXF preparation is busy, then exports the retained failed folder', async () => {
  const handle = new FakeDirectoryHandle('failed-folder'); handle.files.set('workbench.json', 'folder original');
  const adapter = createBrowserDirectoryAdapter(handle as unknown as FileSystemDirectoryHandle);
  const diagnostic = { code: 'WORKBENCH_CATALOG_JSON_INVALID' as const, message: 'Folder catalog invalid' };
  const recoverySource = recoveryStorageSource(adapter, diagnostic);
  const capture = vi.fn(defaultAppServices.captureWorkbenchRecovery);
  let resolve!: (value: ReturnType<typeof prepareDxfProjectImport>) => void;
  const h = await harness({
    connectWorkbenchDirectory: async () => ({ ok: false, error: diagnostic, recoverySource }),
    captureWorkbenchRecovery: capture,
    prepareDxfProjectImport: () => new Promise(yes => { resolve = yes; })
  }, false);
  await act(async () => { await h.app().handleConnectWorkbench(); });
  const workbench = h.app().connectedWorkbench!;
  const context = await h.call('edm_workflow_context', {});
  const source = { fileName: 'circle.dxf', text: ['0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '10', '0', '20', '0', '40', '10', '0', 'ENDSEC', '0', 'EOF'].join('\n') };
  let pending!: Promise<unknown>;
  await act(async () => { pending = h.execute('edm_prepare_dxf', { expectedVersion: context.data.version, source }); });
  try {
    expect((await h.call('edm_workflow_context', {})).data.busy).toBe(true);
    expect(h.app().workbenchInteractionLocked).toBe(false);
    expect(await h.call('edm_export_recovery', { sourceId: recoverySource.id })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    expect(capture).not.toHaveBeenCalled(); expect(h.download).not.toHaveBeenCalled();
  } finally {
    await act(async () => { resolve(prepareDxfProjectImport(workbench, source)); await pending; });
  }
  expect((await h.call('edm_workflow_context', {})).data.busy).toBe(false);
  expect(await h.call('edm_export_recovery', { sourceId: recoverySource.id })).toMatchObject({ ok: true, data: { status: 'download-requested' } });
  expect(capture).toHaveBeenCalledOnce();
  expect(JSON.parse(h.download.mock.calls[0][0].text).files[0].text).toBe('folder original');
  expect(h.app().connectedWorkbench).toBe(workbench);
});

it('preserves a successful download receipt when cancellation arrives during the download request', async () => {
  const control = new AbortController();
  const h = await harness({ downloadTextFile: () => { control.abort(); } });
  expect(await h.call('edm_export_recovery', { sourceId: h.app().recoveryControls!.source.id }, control.signal)).toMatchObject({ ok: true, data: { status: 'download-requested', receipt: { capturedFiles: 1 } } });
  expect(h.app().recoveryControls?.receipt).not.toBeNull();
});

it('blocks storage switching and overlapping exports during capture, and cancels before requesting any download', async () => {
  let resolve!: (value: Awaited<ReturnType<AppServices['captureWorkbenchRecovery']>>) => void;
  const capture = vi.fn<AppServices['captureWorkbenchRecovery']>(() => new Promise(yes => { resolve = yes; }));
  const connect = vi.fn<AppServices['connectWorkbenchDirectory']>();
  const h = await harness({ captureWorkbenchRecovery: capture, connectWorkbenchDirectory: connect });
  const sourceId = h.app().recoveryControls!.source.id; const control = new AbortController();
  let pending!: Promise<unknown>;
  await act(async () => { pending = h.execute('edm_export_recovery', { sourceId }, control.signal); });
  expect(h.app().workbenchInteractionLocked).toBe(true);
  expect(await h.call('edm_export_recovery', { sourceId })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
  await act(async () => { await h.app().handleConnectWorkbench(); }); expect(connect).not.toHaveBeenCalled();
  control.abort();
  await act(async () => {
    resolve({ text: '{}', receipt: { sourceId, fileName: 'recovery.json', archiveBytes: 2, archiveSha256: 'hash', capturedFiles: 0, omittedFiles: 0, inventoryComplete: false, contentComplete: false, inventoryChangedDuringCapture: false, coordination: 'web-lock', atomicSnapshot: false } });
    expect(await pending).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
  });
  expect(h.download).not.toHaveBeenCalled(); expect(h.app().recoveryControls?.receipt).toBeNull(); expect(h.app().workbenchInteractionLocked).toBe(false);
});
