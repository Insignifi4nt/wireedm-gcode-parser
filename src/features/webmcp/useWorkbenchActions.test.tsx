import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { useWorkbenchActions } from './useWorkbenchActions';
import type { DraftReadSnapshot } from './workbenchSiteTools';
import type { SiteTool } from './siteTools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const text = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'CIRCLE', '8', '0', '10', '0', '20', '0', '40', '10', '0', 'ENDSEC', '0', 'EOF'].join('\n');
let root: Root;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); window.localStorage.clear(); });

async function harness() {
  let tools: SiteTool[] = [];
  let app!: ReturnType<typeof useWorkbenchAppController>;
  let draft!: { current: DraftReadSnapshot | null };
  const generate = vi.fn();
  function Harness() {
    draft = useRef<DraftReadSnapshot | null>(null);
    app = useWorkbenchAppController({ connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }), generateControllerArtifact: generate }, () => draft.current);
    const actions = useWorkbenchActions(app, draft);
    tools = actions.tools;
    return actions.fileControl;
  }
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Harness />));
  async function call(name: string, input: unknown) {
    let result: unknown;
    await act(async () => { result = await tools.find(t => t.name === name)!.execute(input); });
    return result as { ok: boolean; data: Record<string, any>; error?: { code: string } };
  }
  return { call, app: () => app, draft: () => draft, generate };
}

describe('workbench agent actions', () => {
  it('previews then imports exact DXF units, consumes the preparation and blocks stale or destructive draft replacement', async () => {
    const h = await harness();
    const context = await h.call('edm_workflow_context', {});
    const prepared = await h.call('edm_prepare_dxf', { expectedVersion: context.data.version, source: { fileName: 'tool-test.dxf', text } });
    expect(prepared).toMatchObject({ ok: true, data: { entityCount: 1, defaultUnitCandidateId: 'millimeters' } });
    const input = { expectedVersion: context.data.version, preparationId: prepared.data.preparationId, unitCandidateId: 'inches', declaredUnitOverrideAcknowledged: false };
    expect(await h.call('edm_import_dxf', input)).toMatchObject({ ok: false, error: { code: 'DXF_IMPORT_DECLARED_UNIT_OVERRIDE_UNACKNOWLEDGED' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(0);
    const imported = await h.call('edm_import_dxf', { ...input, unitCandidateId: 'millimeters' });
    expect(imported).toMatchObject({ ok: true, data: { imported: true, opened: true } });
    expect(await h.call('edm_import_dxf', input)).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(1);
    const program = h.app().loadedEditorProgram!;
    if (program.model !== 'upid-document') throw new Error('Wrong model');
    h.draft().current = { projectId: program.project.id, version: 'draft', document: program.pathDocument, dirty: true, workflowOpen: false };
    const next = await h.call('edm_workflow_context', {});
    expect(await h.call('edm_open_project', { expectedVersion: next.data.version, projectId: program.project.id })).toMatchObject({ ok: false, error: { code: 'DRAFT_IN_USE' } });
    expect(await h.call('edm_generate_controller', { expectedVersion: next.data.version, draftVersion: 'draft', machineId: 'unknown', bindingId: 'unknown' })).toMatchObject({ ok: false, error: { code: 'UNSAVED_DRAFT' } });
    expect(await h.app().handleGenerateControllerArtifact({ machineId: 'unknown' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('Save the draft') } });
    expect(h.generate).not.toHaveBeenCalled();
    h.draft().current!.workflowOpen = true;
    expect(await h.call('edm_save_project', { draftVersion: 'draft' })).toMatchObject({ ok: false, error: { code: 'WORKFLOW_OPEN' } });
    expect(await h.call('edm_save_project', { draftVersion: 'old' })).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    h.draft().current = { ...h.draft().current!, dirty: false, workflowCommand: 'export.preview' };
    // The human export dialog is itself a view workflow; it must still reach machine validation.
    expect(await h.app().handleGenerateControllerArtifact({ machineId: 'unknown' })).toMatchObject({ ok: false, error: { message: 'Machine not found: unknown.' } });
  });

  it('rejects overlapping writes and changed uploads while file reading is pending', async () => {
    const h = await harness();
    let finish!: (value: string) => void;
    const file = new File([], 'delayed.dxf');
    Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    const input = container.querySelector('input')!;
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const context = await h.call('edm_workflow_context', {});
    let pending!: Promise<unknown>;
    // Start directly to keep the asynchronous read open while exercising a second call.
    pending = h.call('edm_prepare_dxf', { expectedVersion: context.data.version });
    expect(await h.call('edm_import_upid', { expectedVersion: context.data.version, source: { fileName: 'x.json', text: '{}' } })).toMatchObject({ ok: false, error: { code: 'BUSY' } });
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [new File([], 'replacement.dxf')] });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => finish(text));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'STALE_STATE' } });
    expect(h.app().connectedWorkbench?.manifest.projects).toHaveLength(0);
  });
});
