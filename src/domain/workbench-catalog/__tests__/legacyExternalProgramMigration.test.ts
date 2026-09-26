import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '@/domain/storage/browserDirectoryAdapter';
import { FakeDirectoryHandle } from '@/domain/storage/__tests__/fakeDirectoryHandle';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { WORKBENCH_FILE_TRANSACTION_PATH } from '@/domain/storage/workbenchFileTransaction';
import { loadEditorProgram } from '@/domain/editor/loadEditorProgram';
import { initializeWorkbenchCatalog } from '../workbenchCatalog';

const id = 'prisma1-2026-07-14';
const timestamp = '2026-07-14T12:00:00.000Z';
const activeFilePath = `editor/${id}.iso`;
const canonicalPath = `projects/${id}.json`;
const backupPath = `legacy/v1/projects/${id}.json`;
const originalProgram = '\uFEFF%\r\nG90\r\nG1 X1 Y2\r\nM02\r\n';
// The editable copy can differ from the original import and must remain the active program.
const editedProgram = 'G90\nG1 X40 Y20\n';

async function fixture(kind: 'browser-cache' | 'directory', layout = 'nested', bom = '') {
  const adapter = kind === 'browser-cache'
    ? createBrowserCacheAdapter(localStorage, { namespace: `legacy-migration-${crypto.randomUUID()}` })
    : createBrowserDirectoryAdapter(new FakeDirectoryHandle('Legacy shop') as unknown as FileSystemDirectoryHandle);
  const path = layout === 'nested' ? `projects/${id}/project.json` : canonicalPath;
  const project = bom + JSON.stringify({
    schemaVersion: 1, id, name: 'Prisma1', createdAt: timestamp, updatedAt: timestamp,
    source: { kind: 'external-gcode', files: [{ name: `${id}.iso`, path: `imports/${id}.iso`, kind: 'external-gcode', createdAt: timestamp }] },
    machine: { id: 'legacy-machine' }, editor: { activeFilePath, pinnedLineNumbers: [2] }
  }, null, 2) + '\n';
  const manifest = bom + JSON.stringify({
    schemaVersion: 1, name: 'Legacy shop', createdAt: timestamp, updatedAt: timestamp,
    templates: { headerPath: 'templates/header.gcode' }, output: { extension: 'iso' },
    activeMachineProfileId: 'legacy-machine', machineProfiles: [],
    projects: [{ id, name: 'Prisma1', path, sourceKind: 'external-gcode', updatedAt: timestamp }]
  }, null, 2) + '\n';
  await adapter.writeText(path, project);
  await adapter.writeText(`imports/${id}.iso`, originalProgram);
  await adapter.writeText(activeFilePath, editedProgram);
  await adapter.writeText('workbench.json', manifest);
  return { adapter, path, project, manifest };
}

const exact = (adapter: WorkbenchStorageAdapter, path: string) => adapter.readExactText?.(path) ?? adapter.readText(path);

describe.each(['browser-cache', 'directory'] as const)('legacy external program startup with %s storage', (kind) => {
  it.each(['nested', 'canonical'])('opens the actual former %s project layout and retains both program copies', async (layout) => {
    const { adapter, path, project, manifest } = await fixture(kind, layout, '\uFEFF');
    const result = await initializeWorkbenchCatalog(adapter);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.workbench.manifest.projects).toMatchObject([{ id, path: canonicalPath }]);
    const loaded = await loadEditorProgram(result.workbench, id);
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(loaded.editorProgram).toMatchObject({ filePath: activeFilePath, text: editedProgram });
    expect(loaded.editorProgram.project.source.files.map((file) => file.path)).toEqual([`imports/${id}.iso`, activeFilePath]);
    expect(loaded.editorProgram.project.editor.pinnedLineNumbers).toEqual([2]);
    expect(await exact(adapter, 'legacy/v1/workbench.json')).toBe(manifest);
    expect(await exact(adapter, backupPath)).toBe(project);
    expect(await exact(adapter, `imports/${id}.iso`)).toBe(originalProgram);
    expect(await exact(adapter, activeFilePath)).toBe(editedProgram);
    if (layout === 'nested') expect(await exact(adapter, path)).toBe(project);
    const currentManifest = await exact(adapter, 'workbench.json');
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true, kind: 'opened' });
    expect(await exact(adapter, 'workbench.json')).toBe(currentManifest);
  });

  it('rejects a missing editable program before writing backups or changing the legacy index', async () => {
    const { adapter, path, project, manifest } = await fixture(kind);
    await adapter.deleteText(activeFilePath);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: false, error: { code: 'WORKBENCH_CATALOG_PROJECT_SOURCE_DANGLING', path: activeFilePath } });
    expect(await exact(adapter, 'workbench.json')).toBe(manifest);
    expect(await exact(adapter, path)).toBe(project);
    expect(await exact(adapter, backupPath)).toBeNull();
  });

  it.each(['backup', 'destination'])('preserves a conflicting %s instead of overwriting it', async (conflict) => {
    const { adapter, path, project, manifest } = await fixture(kind);
    const conflictPath = conflict === 'backup' ? backupPath : canonicalPath;
    const conflicting = conflict === 'backup' ? project.replace('Prisma1', 'Different project') : '{unrelated project}';
    await adapter.writeText(conflictPath, conflicting);
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: false, error: { code: 'WORKBENCH_CATALOG_INCOMPLETE' } });
    expect(await exact(adapter, conflictPath)).toBe(conflicting);
    expect(await exact(adapter, 'workbench.json')).toBe(manifest);
    expect(await exact(adapter, path)).toBe(project);
  });

  it('retains exact backups after quota failure and safely retries the migration', async () => {
    const { adapter, path, project, manifest } = await fixture(kind);
    const write = adapter.writeText.bind(adapter);
    adapter.writeText = vi.fn(async (target, text) => {
      if (target === canonicalPath) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      await write(target, text);
    });
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, 'workbench.json')).toBe(manifest);
    expect(await exact(adapter, path)).toBe(project);
    expect(await exact(adapter, canonicalPath)).toBeNull();
    expect(await exact(adapter, backupPath)).toBe(project);
    adapter.writeText = write;
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true });
    expect(await exact(adapter, activeFilePath)).toBe(editedProgram);
  });

  it('recovers an interrupted upgrade with a retained file journal and retries', async () => {
    const { adapter, path, project, manifest } = await fixture(kind);
    const write = adapter.writeText.bind(adapter);
    let disconnected = false;
    adapter.writeText = vi.fn(async (target, text) => {
      if (target === 'posts/library.json') disconnected = true;
      if (disconnected) throw new Error('Storage disconnected');
      await write(target, text);
    });
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: false });
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
    expect(await exact(adapter, 'workbench.json')).toBe(manifest);
    expect(await exact(adapter, path)).toBe(project);
    adapter.writeText = write;
    expect(await initializeWorkbenchCatalog(adapter)).toMatchObject({ ok: true });
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    expect(await exact(adapter, backupPath)).toBe(project);
    expect(await exact(adapter, activeFilePath)).toBe(editedProgram);
  });
});
