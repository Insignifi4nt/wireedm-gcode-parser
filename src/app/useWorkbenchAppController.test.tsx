import { buildMachinePackageArchive, prepareStoredMachinePackageInstallation } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import { connectWorkbenchDirectory } from '@/domain/storage/connectWorkbenchDirectory';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { defaultAppServices, type AppServices } from './appServices';
import { createDxfImportServices } from './dxfImportServices';
import { directDxfProcessor } from '@/features/dxf-import/dxfProcessorTestSupport';
const testDxfServices = createDxfImportServices(directDxfProcessor);
import { useWorkbenchAppController } from './useWorkbenchAppController';
import { MAX_PORTABLE_UPID_BYTES } from '@/domain/upid/portableUpidProject';
import { DXF_RESOURCE_LIMITS } from '@/domain/dxf/dxfResourceLimits';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('workbench controller asynchronous operations', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    window.localStorage.clear();
    Reflect.deleteProperty(window, 'showSaveFilePicker');
  });

  async function mount(overrides: Partial<AppServices> = {}) {
    let current: ReturnType<typeof useWorkbenchAppController> | undefined;
    function Harness() {
      current = useWorkbenchAppController({
        ...testDxfServices,
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

  it('rejects oversized DXF before reading the file and permits a later bounded import', async () => {
    const prepare = vi.fn(testDxfServices.prepareDxfProjectImport);
    const read = await mount({ prepareDxfProjectImport: prepare });
    const before = read().connectedWorkbench;
    const dxf = '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n5\n0\nENDSEC\n0\nEOF\n';
    const readText = vi.fn(async () => dxf);
    const oversized = new File([], 'large.dxf');
    Object.defineProperty(oversized, 'size', { value: DXF_RESOURCE_LIMITS.inputBytes + 1 });
    Object.defineProperty(oversized, 'text', { value: readText });
    await act(async () => { await read().handleImportDxfFile(oversized); });
    expect(readText).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(read().importErrorMessage).toContain('No geometry was imported');
    expect(read().pendingDxfImport).toBeNull();
    expect(read().connectedWorkbench).toBe(before);

    const small = new File([dxf], 'small.dxf');
    Object.defineProperty(small, 'text', { value: readText });
    await act(async () => { await read().handleImportDxfFile(small); });
    expect(readText).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(read().pendingDxfImport).not.toBeNull();
    expect(read().importErrorMessage).toBeNull();
    expect(read().connectedWorkbench).toBe(before);
  });

  it('rejects oversized UPID before reading bytes and permits a later small import', async () => {
    const imported = vi.fn(defaultAppServices.importPortableUpidProject);
    const read = await mount({ importPortableUpidProject: imported });
    const before = read().connectedWorkbench;
    const oversized = new File([], 'large.upid.json');
    const readText = vi.fn(async () => '{}');
    Object.defineProperty(oversized, 'size', { value: MAX_PORTABLE_UPID_BYTES + 1 });
    Object.defineProperty(oversized, 'text', { value: readText });
    await act(async () => { await read().handleImportUpidFile(oversized); });
    expect(readText).not.toHaveBeenCalled();
    expect(imported).not.toHaveBeenCalled();
    expect(read().importErrorMessage).toContain('64 MiB');
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().connectedWorkbench).toBe(before);
    const small = new File(['{}'], 'small.upid.json');
    Object.defineProperty(small, 'text', { value: readText });
    await act(async () => { await read().handleImportUpidFile(small); });
    expect(readText).toHaveBeenCalledOnce();
    expect(imported).toHaveBeenCalledOnce();
    expect(read().workbenchInteractionLocked).toBe(false);
  });

  it('cancels a pending file read without preparing or reopening the import', async () => {
    const prepare = vi.fn(testDxfServices.prepareDxfProjectImport);
    const read = await mount({ prepareDxfProjectImport: prepare });
    const contents = deferred<string>();
    const file = new File([], 'slow.dxf');
    Object.defineProperty(file, 'text', { value: () => contents.promise });
    let pending!: Promise<void>;
    await act(async () => { pending = read().handleImportDxfFile(file); });
    expect(read().importStatus).toBe('importing');
    await act(async () => { read().handleCancelDxfImport(); });
    await act(async () => { contents.resolve('0\nEOF'); await pending; });
    expect(prepare).not.toHaveBeenCalled();
    expect(read().pendingDxfImport).toBeNull();
    expect(read().importStatus).toBe('idle');
    expect(read().workbenchInteractionLocked).toBe(false);
  });

  it('aborts replaced preparations and ignores their later failure', async () => {
    const old = deferred<Awaited<ReturnType<AppServices['prepareDxfProjectImport']>>>();
    let oldSignal: AbortSignal | undefined;
    const prepare = vi.fn(testDxfServices.prepareDxfProjectImport).mockImplementationOnce((_workbench, _input, signal) => {
      oldSignal = signal; return old.promise;
    });
    const read = await mount({ prepareDxfProjectImport: prepare });
    const text = '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n5\n0\nENDSEC\n0\nEOF\n';
    let pending!: Promise<void>;
    await act(async () => { pending = read().handleImportDxfFile(new File([text], 'old.dxf')); });
    await act(async () => { await read().handleImportDxfFile(new File([text], 'current.dxf')); });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => { old.resolve({ ok: false, error: { code: 'DXF_IMPORT_GEOMETRY_REQUIRED', message: 'Obsolete failure' } }); await pending; });
    const result = read().pendingDxfImport?.preparationResult;
    expect(result?.ok && result.preparation.fileName).toBe('current.dxf');
    expect(read().importErrorMessage).toBeNull();
    expect(read().importStatus).toBe('idle');
  });

  it('aborts preparation when the controller unmounts', async () => {
    const waiting = deferred<Awaited<ReturnType<AppServices['prepareDxfProjectImport']>>>();
    let signal: AbortSignal | undefined;
    const read = await mount({ prepareDxfProjectImport: async (_workbench, _input, taskSignal) => {
      signal = taskSignal; return waiting.promise;
    } });
    let pending!: Promise<void>;
    await act(async () => { pending = read().handleImportDxfFile(new File(['0\nEOF'], 'unmount.dxf')); });
    act(() => root?.unmount()); root = undefined;
    expect(signal?.aborted).toBe(true);
    waiting.resolve({ ok: false, error: { code: 'DXF_IMPORT_GEOMETRY_REQUIRED', message: 'Late failure' } });
    await pending;
  });

  it('does not advertise DXF cancellation while a UPID import is running', async () => {
    const waiting = deferred<Awaited<ReturnType<AppServices['importPortableUpidProject']>>>();
    const read = await mount({ importPortableUpidProject: () => waiting.promise });
    let pending!: Promise<void>;
    await act(async () => { pending = read().handleImportUpidFile(new File(['{}'], 'part.upid.json')); });
    expect(read().importStatus).toBe('importing');
    expect(read().dxfImportCancellable).toBe(false);
    await act(async () => {
      waiting.resolve({ ok: false, error: { code: 'PORTABLE_UPID_DOCUMENT_INVALID', message: 'Fixture rejected' } });
      await pending;
    });
  });

  it('keeps a committed DXF receipt and unlocks the UI when opening its editor throws', async () => {
    const read = await mount({ loadEditorProgram: vi.fn(defaultAppServices.loadEditorProgram).mockRejectedValueOnce(new Error('Editor read interrupted')) });
    const text = '0\nSECTION\n2\nENTITIES\n0\nLINE\n10\n0\n20\n0\n11\n10\n21\n5\n0\nENDSEC\n0\nEOF\n';
    await act(async () => { await read().handleImportDxfFile(new File([text], 'committed.dxf')); });
    await act(async () => { read().handleDxfImportUnitCandidateChange('millimeters'); });
    await act(async () => { await read().handleConfirmDxfImport(); });
    expect(read().connectedWorkbench?.manifest.projects).toHaveLength(1);
    expect(read().latestImport?.project.name).toBe('committed');
    expect(read().pendingDxfImport).toBeNull();
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().statusToasts.at(-1)?.message).toContain('DXF was committed, but its editor document could not be opened: Editor read interrupted');
  });

  it('rejects a machine package prepared for another workbench before committing', async () => {
    const other = await connectWorkbenchDirectory({ requestDirectory: async () => new FakeDirectoryHandle('other-workbench') as unknown as FileSystemDirectoryHandle,
      handleStore: { read: async () => null, write: async () => {} } });
    if (!other.ok) throw new Error(other.error.message);
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(other.workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const commit = vi.fn(defaultAppServices.commitStoredMachinePackageInstallation);
    const read = await mount({ commitStoredMachinePackageInstallation: commit });
    await act(async () => {
      expect(await read().handleCommitMachinePackage(prepared.prepared, { kind: 'install-new' })).toBe(false);
    });
    expect(commit).not.toHaveBeenCalled();
    expect(read().settingsErrorMessage).toContain('workbench changed');
    expect(read().connectedWorkbench?.machines.machines).toHaveLength(0);
  });

  it.each(['service result', 'service rejection', 'download'] as const)('reports an export %s failure and permits retry', async (failure) => {
    const seeded = await seedProgram();
    const exported = { ok: true as const, file: { fileName: 'part.upid.json', text: '{"fixture":true}' } };
    const exportProject = vi.fn<AppServices['exportPortableUpidProject']>().mockResolvedValue(exported);
    const download = vi.fn<AppServices['downloadTextFile']>();
    if (failure === 'service result') exportProject.mockResolvedValueOnce({ ok: false,
      error: { code: 'PORTABLE_UPID_DOCUMENT_INVALID', message: 'Cannot read geometry' } });
    if (failure === 'service rejection') exportProject.mockRejectedValueOnce(new Error('Cannot read geometry'));
    if (failure === 'download') download.mockImplementationOnce(() => { throw new Error('Download unavailable'); });
    const read = await mount({ exportPortableUpidProject: exportProject, downloadTextFile: download });
    const before = read().connectedWorkbench;
    await act(async () => { await read().handleExportUpidProject(seeded.project.id); });
    expect(read().statusToasts.at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('Could not export UPID:') });
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().connectedWorkbench).toBe(before);
    await act(async () => { await read().handleExportUpidProject(seeded.project.id); });
    expect(download).toHaveBeenLastCalledWith({ ...exported.file, mimeType: 'application/json;charset=utf-8' });
    expect(read().statusToasts.at(-1)).toMatchObject({ type: 'success' });
  });

  it('locks project actions during export and releases them after download', async () => {
    const seeded = await seedProgram();
    const gate = deferred<Awaited<ReturnType<AppServices['exportPortableUpidProject']>>>();
    const exportProject = vi.fn(() => gate.promise);
    const rename = vi.fn(defaultAppServices.renameWorkbenchProject);
    const remove = vi.fn(defaultAppServices.deleteWorkbenchProject);
    const download = vi.fn();
    const read = await mount({ exportPortableUpidProject: exportProject, renameWorkbenchProject: rename,
      deleteWorkbenchProject: remove, downloadTextFile: download });
    let exporting: Promise<void> | undefined;
    await act(async () => { exporting = read().handleExportUpidProject(seeded.project.id); });
    expect(read().workbenchInteractionLocked).toBe(true);
    await act(async () => {
      await expect(read().handleRenameWorkbenchProject(seeded.project.id, 'Changed')).rejects.toThrow('in progress');
      await expect(read().handleDeleteWorkbenchProject(seeded.project.id)).rejects.toThrow('in progress');
      await read().handleExportUpidProject(seeded.project.id);
      await read().handleOpenWorkbenchProject(seeded.project.id);
    });
    expect(exportProject).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    await act(async () => { gate.resolve({ ok: true, file: { fileName: 'part.upid.json', text: '{}' } }); await exporting; });
    expect(download).toHaveBeenCalledTimes(1);
    expect(read().workbenchInteractionLocked).toBe(false);
    await act(async () => { await read().handleRenameWorkbenchProject(seeded.project.id, 'Changed'); });
    expect(read().connectedWorkbench?.manifest.projects[0].name).toBe('Changed');
    expect(read().workbenchInteractionLocked).toBe(false);
  });

  it('chooses a save destination before exporting and writes the UPID file there', async () => {
    const seeded = await seedProgram();
    const write = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write, close }) }));
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: picker });
    const exportProject = vi.fn<AppServices['exportPortableUpidProject']>().mockResolvedValue({
      ok: true, file: { fileName: 'part.upid.json', text: '{"fixture":true}' }
    });
    const read = await mount({ exportPortableUpidProject: exportProject });
    await act(async () => { await read().handleSaveUpidProjectAs(seeded.project.id); });
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'part.upid.json' }));
    expect(exportProject).toHaveBeenCalledOnce();
    expect(picker.mock.invocationCallOrder[0]).toBeLessThan(exportProject.mock.invocationCallOrder[0]);
    expect(write).toHaveBeenCalledWith('{"fixture":true}');
    expect(close).toHaveBeenCalledOnce();
    expect(read().statusToasts.at(-1)).toMatchObject({ type: 'success' });
  });

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
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    const currentWorkbench = read().connectedWorkbench;
    const currentProgram = read().loadedEditorProgram;
    let connecting: Promise<void> | undefined;
    await act(async () => { connecting = read().handleConnectWorkbench(); });
    expect(read().workbenchInteractionLocked).toBe(true);
    await act(async () => { gate.reject(new DOMException('Cancelled', 'AbortError')); await connecting; });
    expect(read().workbenchStatus).toBe('ready');
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().connectedWorkbench).toBe(currentWorkbench);
    expect(read().loadedEditorProgram).toBe(currentProgram);
    expect(read().activeView).toBe('editor');
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
  });

  it('switches to the selected folder and closes the old folder-owned editor project', async () => {
    const seeded = await seedProgram();
    const selected = new FakeDirectoryHandle('selected-jobs');
    const forgetFolder = vi.fn().mockResolvedValue(undefined);
    const read = await mount({
      forgetWorkbenchDirectory: forgetFolder,
      connectWorkbenchDirectory: () => connectWorkbenchDirectory({
        requestDirectory: async () => selected as unknown as FileSystemDirectoryHandle,
        handleStore: { read: async () => null, write: async () => {} }
      })
    });
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
    await act(async () => { await read().handleConnectWorkbench(); });
    expect(read().connectedWorkbench?.adapter).toMatchObject({ kind: 'directory', name: 'selected-jobs' });
    expect(read().connectedWorkbench?.manifest.projects).toHaveLength(0);
    expect(read().loadedEditorProgram).toBeNull();
    expect(read().activeView).toBe('dashboard');
    expect(read().storageActionLabel).toBe('Choose another Workbench Folder');
    expect(await seeded.workbench.adapter.readText(seeded.editorProgram.filePath)).toBe(seeded.editorProgram.text);
    await act(async () => { await read().handleUseBrowserCache(); });
    expect(read().connectedWorkbench?.adapter.kind).toBe('browser-cache');
    expect(read().connectedWorkbench?.manifest.projects.map((project) => project.id)).toContain(seeded.project.id);
    expect(forgetFolder).toHaveBeenCalledTimes(1);
    expect(selected.files.has('workbench.json')).toBe(true);
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
  });

  it.each(['cache', 'remembered preference'] as const)('retains the folder after a %s switch failure and permits retry', async (failure) => {
    const cached = vi.fn(connectCachedWorkbench);
    const forgetFolder = vi.fn<AppServices['forgetWorkbenchDirectory']>().mockResolvedValue(undefined);
    const selected = new FakeDirectoryHandle('selected-jobs');
    const read = await mount({
      connectCachedWorkbench: cached,
      forgetWorkbenchDirectory: forgetFolder,
      connectWorkbenchDirectory: () => connectWorkbenchDirectory({
        requestDirectory: async () => selected as unknown as FileSystemDirectoryHandle,
        handleStore: { read: async () => null, write: async () => {} }
      })
    });
    await act(async () => { await read().handleConnectWorkbench(); });
    const folder = read().connectedWorkbench;
    if (failure === 'cache') cached.mockRejectedValueOnce(new Error('Cache unavailable'));
    else forgetFolder.mockRejectedValueOnce(new Error('Preference unavailable'));
    await act(async () => { await read().handleUseBrowserCache(); });
    expect(read().connectedWorkbench).toBe(folder);
    expect(read().workbenchStatus).toBe('ready');
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().errorMessage).toContain('unavailable');
    if (failure === 'cache') expect(forgetFolder).not.toHaveBeenCalled();
    await act(async () => { await read().handleUseBrowserCache(); });
    expect(read().connectedWorkbench?.adapter.kind).toBe('browser-cache');
    expect(read().errorMessage).toBeNull();
  });

  it('keeps the current project usable after a selected folder fails validation', async () => {
    const seeded = await seedProgram();
    const selected = new FakeDirectoryHandle('invalid-jobs');
    selected.files.set('workbench.json', '{"schemaVersion":1}');
    const read = await mount({
      connectWorkbenchDirectory: () => connectWorkbenchDirectory({
        requestDirectory: async () => selected as unknown as FileSystemDirectoryHandle,
        handleStore: { read: async () => null, write: async () => {} }
      })
    });
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    const currentWorkbench = read().connectedWorkbench;
    await act(async () => { await read().handleConnectWorkbench(); });
    expect(read().workbenchStatus).toBe('ready');
    expect(read().connectedWorkbench).toBe(currentWorkbench);
    expect(read().loadedEditorProgram?.project.id).toBe(seeded.project.id);
    expect(read().errorMessage).toBeTruthy();
    await act(async () => {
      expect(await read().handleSaveEditorDraft({ model: 'gcode-text', text: 'G0 X2 Y3' })).not.toBeNull();
    });
    expect(await seeded.workbench.adapter.readText(seeded.editorProgram.filePath)).toBe('G0 X2 Y3');
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
      commitDxfProjectImport: vi.fn(testDxfServices.commitDxfProjectImport)
        .mockRejectedValueOnce(new Error('Import interrupted')),
      prepareDxfProjectReimport: vi.fn(testDxfServices.prepareDxfProjectReimport)
        .mockRejectedValueOnce(new Error('Source read interrupted')),
      commitDxfProjectReimport: vi.fn(testDxfServices.commitDxfProjectReimport)
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
    const save = vi.fn(defaultAppServices.saveEditorProgram)
      .mockRejectedValueOnce(new Error('Save interrupted'));
    const read = await mount({ saveEditorProgram: save });
    await act(async () => { await read().handleOpenWorkbenchProject(seeded.project.id); });
    const draft = { model: 'gcode-text', text: 'G0 X0 Y0\nG1 X20 Y10' } as const;
    await act(async () => { expect(await read().handleSaveEditorDraft(draft)).toBeNull(); });
    expect(read().workbenchInteractionLocked).toBe(false);
    expect(read().editorSaveStatus).toBe('error');
    expect(read().loadedEditorProgram?.text).toBe(seeded.editorProgram.text);
    await act(async () => { await read().handleSaveEditorDraft(draft); });
    expect(save).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      expectedText: seeded.editorProgram.text
    }));
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
