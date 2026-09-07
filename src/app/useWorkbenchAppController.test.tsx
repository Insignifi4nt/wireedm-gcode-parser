import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import { defaultAppServices, type AppServices } from './appServices';
import { useWorkbenchAppController } from './useWorkbenchAppController';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('workbench controller asynchronous operations', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    window.localStorage.clear();
  });

  async function mount(overrides: Partial<AppServices> = {}) {
    let current: ReturnType<typeof useWorkbenchAppController> | undefined;
    function Harness() {
      current = useWorkbenchAppController({
        connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }),
        ...overrides
      });
      return null;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<Harness />));
    return () => {
      if (!current) throw new Error('Controller has not mounted.');
      return current;
    };
  }

  async function seedProgram() {
    const connected = await connectCachedWorkbench();
    if (!connected.ok) throw new Error(connected.error.message);
    const imported = await importExternalProgram(connected.workbench, {
      fileName: 'part.nc', text: 'G0 X0 Y0\nG1 X10 Y5'
    });
    if (!imported.ok) throw new Error(imported.error.message);
    return imported;
  }

  it('locks competing project opens and imports until a slow project read completes', async () => {
    const seeded = await seedProgram();
    const gate = deferred<void>();
    const openProject = vi.fn(async (...args: Parameters<AppServices['openWorkbenchProject']>) => {
      await gate.promise;
      return defaultAppServices.openWorkbenchProject(...args);
    });
    const read = await mount({ openWorkbenchProject: openProject });
    let opening: Promise<void> | undefined;
    await act(async () => { opening = read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().workbenchInteractionLocked).toBe(true);
    await act(async () => {
      await read().handleOpenWorkbenchProject(seeded.project.id);
      await read().handleImportExternalProgram(new File(['G0 X2'], 'other.nc'));
    });
    expect(openProject).toHaveBeenCalledTimes(1);
    expect(read().connectedWorkbench?.manifest.projects).toHaveLength(1);
    await act(async () => { gate.resolve(); await opening; });
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
  });

  it('keeps actions locked while choosing a folder and restores the current workbench after cancellation', async () => {
    const seeded = await seedProgram();
    const gate = deferred<Awaited<ReturnType<AppServices['connectWorkbenchDirectory']>>>();
    const read = await mount({ connectWorkbenchDirectory: () => gate.promise });
    let connecting: Promise<void> | undefined;
    await act(async () => { connecting = read().handleConnectWorkbench(); });
    expect(read().workbenchInteractionLocked).toBe(true);
    await act(async () => { gate.reject(new DOMException('Cancelled', 'AbortError')); await connecting; });
    expect(read().workbenchStatus).toBe('ready');
    expect(read().workbenchInteractionLocked).toBe(false);
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
  });

  it('recovers from a rejected project read and permits a successful retry', async () => {
    const seeded = await seedProgram();
    const read = await mount({
      openWorkbenchProject: vi.fn(defaultAppServices.openWorkbenchProject)
        .mockRejectedValueOnce(new Error('Read interrupted'))
    });
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().activeView).toBe('dashboard');
    expect(read().statusToasts.at(-1)?.message).toBe('Read interrupted');
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
  });

  it('recovers DXF import and reimport after rejected service operations', async () => {
    const read = await mount({
      commitDxfProjectImport: vi.fn(defaultAppServices.commitDxfProjectImport)
        .mockRejectedValueOnce(new Error('Import interrupted')),
      prepareDxfProjectReimport: vi.fn(defaultAppServices.prepareDxfProjectReimport)
        .mockRejectedValueOnce(new Error('Source read interrupted')),
      commitDxfProjectReimport: vi.fn(defaultAppServices.commitDxfProjectReimport)
        .mockRejectedValueOnce(new Error('Reimport interrupted'))
    });
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4',
      '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'CUT', '10', '0', '20', '0', '11', '1', '21', '0',
      '0', 'ENDSEC', '0', 'EOF'
    ].join('\n');
    await act(async () => { await read().handleImportDxfFile(new File([dxf], 'part.dxf')); });
    await act(async () => { read().handleDxfImportUnitCandidateChange('millimeters'); });
    await act(async () => { await read().handleConfirmDxfImport(); });
    expect(read().importErrorMessage).toBe('Import interrupted');
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().connectedWorkbench?.manifest.projects).toHaveLength(0);
    expect(read().pendingDxfImport).not.toBeNull();
    await act(async () => { await read().handleConfirmDxfImport(); });
    expect(read().loadedEditorProgram?.model).toBe('upid-document');
    expect(read().connectedWorkbench?.manifest.projects).toHaveLength(1);

    await act(async () => { await read().handlePrepareDxfReimport(); });
    expect(read().dxfReimportErrorMessage).toBe('Source read interrupted');
    expect(read().workbenchInteractionLocked).toBe(false);
    await act(async () => { await read().handlePrepareDxfReimport(); });
    await act(async () => { read().handleDxfReimportUnitCandidateChange('millimeters'); });
    await act(async () => { await read().handleConfirmDxfReimport(); });
    expect(read().dxfReimportErrorMessage).toBe('Reimport interrupted');
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().pendingDxfReimport).not.toBeNull();
    await act(async () => { await read().handleConfirmDxfReimport(); });
    expect(read().dxfReimportStatus).toBe('idle');
    expect(read().pendingDxfReimport).toBeNull();
  });

  it('preserves the saved program after a rejected save and persists a later retry', async () => {
    const seeded = await seedProgram();
    const read = await mount({
      saveEditorProgram: vi.fn(defaultAppServices.saveEditorProgram)
        .mockRejectedValueOnce(new Error('Save interrupted'))
    });
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    const draft = { model: 'gcode-text', text: 'G0 X0 Y0\nG1 X20 Y10' } as const;
    await act(async () => { expect(await read().handleSaveEditorDraft(draft)).toBeNull(); });
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().editorSaveStatus).toBe('error');
    expect(read().loadedEditorProgram?.text).toBe(seeded.editorProgram.text);
    await act(async () => { await read().handleSaveEditorDraft(draft); });
    expect(read().editorSaveStatus).toBe('idle');
    expect(read().loadedEditorProgram?.text).toBe(draft.text);
    expect(await seeded.workbench.adapter.readText(seeded.editorProgram.filePath)).toBe(draft.text);
  });
});

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
