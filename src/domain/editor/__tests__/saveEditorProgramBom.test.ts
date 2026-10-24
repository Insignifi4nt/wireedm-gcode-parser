import { File as NodeFile } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { openIndexedDbWorkbench } from '@/domain/storage/indexedDbWorkbenchAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { importExternalProgram } from '../importExternalProgram';
import { loadEditorProgram } from '../loadEditorProgram';
import { saveEditorProgram } from '../saveEditorProgram';

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps the legacy non-UTF-8 folder display while refusing to overwrite its unrepresentable original', async () => {
  vi.stubGlobal('File', NodeFile);
  const directory = new FakeDirectoryHandle('legacy-encoding');
  const adapter = createBrowserDirectoryAdapter(directory as unknown as FileSystemDirectoryHandle);
  const opened = await initializeWorkbenchCatalog(adapter);
  if (!opened.ok) throw new Error(opened.error.message);
  const imported = await importExternalProgram(opened.workbench, { fileName: 'legacy.nc', text: 'G21\nG1 X1 Y1' });
  if (!imported.ok) throw new Error(imported.error.message);
  const projectDirectory = await (await directory.getDirectoryHandle('projects')).getDirectoryHandle(imported.project.id);
  const getFileHandle = projectDirectory.getFileHandle.bind(projectDirectory);
  const raw = new Uint8Array([...new TextEncoder().encode('G21\nG1 X1 Y1\n(steel '), 0xe9, 0x29, 0x0a]);
  vi.spyOn(projectDirectory, 'getFileHandle').mockImplementation(async (name, options) => {
    const handle = await getFileHandle(name, options);
    if (name === 'editable.nc') handle.getFile = async () => new File([raw], name);
    return handle;
  });
  await expect(adapter.readExactText!(imported.editorProgram.filePath)).rejects.toThrow('exact UTF-8');
  const loaded = await loadEditorProgram(imported.workbench, imported.project.id);
  if (!loaded.ok || loaded.editorProgram.model !== 'gcode-text') throw new Error('Expected the legacy display reader');
  expect(loaded.editorProgram.text).toBe(new TextDecoder().decode(raw));
  expect(loaded.editorProgram.parseResult.path).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'cut', x: 1, y: 1, line: 2 })
  ]));
  const preservedPaths = ['workbench.json', `projects/${imported.project.id}.json`, imported.project.source.files[0].path];
  const originals = await Promise.all(preservedPaths.map(path => adapter.readExactText!(path)));
  const write = vi.spyOn(adapter, 'writeText');
  const remove = vi.spyOn(adapter, 'deleteText');
  expect(await saveEditorProgram(imported.workbench, {
    projectId: imported.project.id, expectedText: loaded.editorProgram.text,
    expectedContent: loaded.editorProgram.project.content, draft: { model: 'gcode-text', text: 'G21\nG1 X3 Y3' }
  })).toMatchObject({ ok: false, error: {
    code: 'WORKBENCH_PROJECT_STORAGE_ACCESS_FAILED', operation: 'read', path: imported.editorProgram.filePath
  } });
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(await Promise.all(preservedPaths.map(path => adapter.readExactText!(path)))).toEqual(originals);
  const preservedFile = await (await projectDirectory.getFileHandle('editable.nc')).getFile();
  const retainedBytes = await preservedFile.arrayBuffer();
  expect(new Uint8Array(retainedBytes)).toEqual(raw);
  expect(await adapter.readText('transactions/workbench-files.json')).toBeNull();
});

describe.each(['legacy-cache', 'indexeddb', 'directory'] as const)('exact external program edits in %s', kind => {
  it('rejects a BOM-only external change and permits an exact reviewed retry after reopening', async () => {
    vi.stubGlobal('File', NodeFile);
    const database = kind === 'indexeddb' ? await openIndexedDbWorkbench({ factory: new IDBFactory(), legacyStorage: null }) : null;
    const adapter = database ?? (kind === 'legacy-cache'
      ? createBrowserCacheAdapter(localStorage)
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('bom-conflict') as unknown as FileSystemDirectoryHandle));
    try {
      const opened = await initializeWorkbenchCatalog(adapter);
      if (!opened.ok) throw new Error(opened.error.message);
      const imported = await importExternalProgram(opened.workbench, { fileName: 'part.nc', text: 'G1 X1 Y1' });
      if (!imported.ok) throw new Error(imported.error.message);
      const editedPath = imported.editorProgram.filePath;
      const externalText = '\uFEFF' + imported.editorProgram.text;
      await adapter.writeText(editedPath, externalText);
      const paths = [editedPath, imported.project.source.files[0].path, `projects/${imported.project.id}.json`, 'workbench.json'];
      const originals = await Promise.all(paths.map(path => adapter.readExactText!(path)));
      const stale = await saveEditorProgram(imported.workbench, {
        projectId: imported.project.id, expectedContent: imported.project.content,
        expectedText: imported.editorProgram.text, draft: { model: 'gcode-text', text: 'G1 X2 Y2' }
      });
      expect(stale).toMatchObject({ ok: false, error: { code: 'WORKBENCH_PROJECT_CONTENT_CHANGED' } });
      expect(await Promise.all(paths.map(path => adapter.readExactText!(path)))).toEqual(originals);
      expect(await adapter.readText('transactions/workbench-files.json')).toBeNull();
      const reopened = await loadEditorProgram(imported.workbench, imported.project.id);
      if (!reopened.ok || reopened.editorProgram.model !== 'gcode-text') throw new Error('Expected the saved external program');
      expect(reopened.editorProgram.text).toBe(externalText);
      const reviewedText = externalText + '\nM02';
      expect(await saveEditorProgram(imported.workbench, {
        projectId: imported.project.id, expectedText: reopened.editorProgram.text,
        expectedContent: reopened.editorProgram.project.content, draft: { model: 'gcode-text', text: reviewedText }
      })).toMatchObject({ ok: true });
      expect(await adapter.readExactText!(editedPath)).toBe(reviewedText);
      expect(await adapter.readExactText!(imported.project.source.files[0].path)).toBe('G1 X1 Y1');
    } finally { database?.close(); }
  });
});
