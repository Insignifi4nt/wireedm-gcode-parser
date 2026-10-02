import { File as NodeFile } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { withWorkbenchMutationLock } from '@/domain/storage/workbenchMutationLock';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { importExternalProgram } from '../importExternalProgram';
import { loadEditorProgram } from '../loadEditorProgram';
import { saveEditorProgram } from '../saveEditorProgram';

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

describe.each(['browser-cache', 'directory'] as const)('external program stale saves in %s', (kind) => {
  async function fixture() {
    vi.stubGlobal('File', NodeFile);
    const adapter = kind === 'browser-cache'
      ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('save-concurrency') as unknown as FileSystemDirectoryHandle);
    const opened = await initializeWorkbenchCatalog(adapter);
    if (!opened.ok) throw new Error(opened.error.message);
    const imported = await importExternalProgram(opened.workbench, { fileName: 'part.iso', text: 'G0 X0 Y0\nG1 X10 Y0' });
    if (!imported.ok) throw new Error(imported.error.message);
    return { adapter, imported };
  }

  it('preserves an externally edited file and permits saving after reopening it', async () => {
    const { adapter, imported } = await fixture();
    const externalText = 'G0 X0 Y0\nG1 X100 Y0';
    await adapter.writeText(imported.editorProgram.filePath, externalText);
    const manifest = await adapter.readText('workbench.json');
    const saved = await saveEditorProgram(imported.workbench, {
      projectId: imported.project.id, expectedContent: imported.project.content,
      expectedText: imported.editorProgram.text,
      draft: { model: 'gcode-text', text: 'G0 X0 Y0\nG1 X20 Y0' }
    });
    expect(saved).toMatchObject({ ok: false, error: { code: 'WORKBENCH_PROJECT_CONTENT_CHANGED' } });
    expect(await adapter.readText(imported.editorProgram.filePath)).toBe(externalText);
    expect(await adapter.readText('workbench.json')).toBe(manifest);
    expect(await adapter.readText('transactions/workbench-files.json')).toBeNull();
    const reopened = await loadEditorProgram(imported.workbench, imported.project.id);
    if (!reopened.ok || reopened.editorProgram.model !== 'gcode-text') throw new Error('Expected external program');
    const retry = await saveEditorProgram(imported.workbench, {
      projectId: imported.project.id, expectedContent: reopened.editorProgram.project.content,
      expectedText: reopened.editorProgram.text,
      draft: { model: 'gcode-text', text: `${externalText}\nM02` }
    });
    expect(retry.ok).toBe(true);
    expect(await adapter.readText(imported.editorProgram.filePath)).toBe(`${externalText}\nM02`);
    expect(await adapter.readText(imported.project.source.files[0].path)).toBe('G0 X0 Y0\nG1 X10 Y0');
  });

  it('checks the file after a queued save obtains the mutation lock', async () => {
    const { adapter, imported } = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const locked = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const holder = withWorkbenchMutationLock(adapter, async () => { entered(); await gate; });
    await locked;
    const pending = saveEditorProgram(imported.workbench, {
      projectId: imported.project.id, expectedContent: imported.project.content,
      expectedText: imported.editorProgram.text,
      draft: { model: 'gcode-text', text: 'G0 X20 Y0' }
    });
    try {
      await new Promise(resolve => setTimeout(resolve, 0));
      await adapter.writeText(imported.editorProgram.filePath, 'G0 X100 Y0');
    } finally { release(); }
    await holder;
    expect(await pending).toMatchObject({ ok: false, error: { code: 'WORKBENCH_PROJECT_CONTENT_CHANGED' } });
    expect(await adapter.readText(imported.editorProgram.filePath)).toBe('G0 X100 Y0');
  });
});
