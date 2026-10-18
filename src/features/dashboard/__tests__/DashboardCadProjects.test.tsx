import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { cadDocumentPath, loadCadDocument, saveCadDocument } from '@/domain/cad/cadStorage';
import * as cadStorage from '@/domain/cad/cadStorage';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { DashboardPage } from '../DashboardPage';

describe('saved CAD projects in the shared dashboard', () => {
  let container: HTMLDivElement;
  let root: Root;
  let libraryRead: MockInstance<typeof cadStorage.listCadProjectLibrary>;
  let documentRead: MockInstance<typeof cadStorage.loadCadDocument>;
  let archive: MockInstance<typeof cadStorage.archiveCadDocument>;
  let restore: MockInstance<typeof cadStorage.restoreCadDocument>;
  beforeEach(() => {
    localStorage.clear(); container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    libraryRead = vi.spyOn(cadStorage, 'listCadProjectLibrary');
    documentRead = vi.spyOn(cadStorage, 'loadCadDocument');
    archive = vi.spyOn(cadStorage, 'archiveCadDocument');
    restore = vi.spyOn(cadStorage, 'restoreCadDocument');
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });
  const props = {
    workbenchStatus: 'ready', importStatus: 'idle', importErrorMessage: null, interactionLocked: false,
    programImportStatus: 'idle', programImportErrorMessage: null, latestImport: null, pendingDxfImport: null,
    onOpenEditor: vi.fn(), onOpenLatestImportInEditor: vi.fn(), onOpenProject: vi.fn(), onDeleteProject: vi.fn(),
    onDeleteSavedRevisions: vi.fn(), onRestoreProject: vi.fn(), onPurgeArchivedProject: vi.fn(), onExportUpidProject: vi.fn(),
    onSaveUpidProjectAs: vi.fn(), onRenameProject: vi.fn(), onImportDxfFile: vi.fn(), onImportUpidFile: vi.fn(),
    onCancelDxfImport: vi.fn(), onConfirmDxfImport: vi.fn(), onDxfImportOverrideAcknowledgedChange: vi.fn(),
    onDxfImportUnitCandidateChange: vi.fn(), onImportProgramFile: vi.fn()
  } satisfies Omit<Parameters<typeof DashboardPage>[0], 'connectedWorkbench'>;
  async function workbench(namespace: string) {
    const opened = await initializeWorkbenchCatalog(createBrowserCacheAdapter(localStorage, { namespace }));
    if (!opened.ok) throw new Error(opened.error.message);
    return opened.workbench;
  }
  function button(label: string) {
    const control = [...container.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent === label);
    if (!control) throw new Error(`Missing action: ${label}`);
    return control;
  }
  async function settle(assertion: () => void) {
    await act(async () => {
      for (const operation of [documentRead, archive, restore]) {
        const latest = operation.mock.results.at(-1);
        if (latest?.type === 'return') await latest.value;
      }
    });
    // An action's committed React update starts its inventory refresh. Await
    // that actual read too, rather than leave gaps between timed polling probes.
    await act(async () => {
      const latest = libraryRead.mock.results.at(-1);
      if (latest?.type === 'return') await latest.value;
    });
    assertion();
  }
  async function selectState(value: string) {
    await act(async () => button('Filter projects').click());
    await act(async () => {
      const control = container.querySelector<HTMLButtonElement>(`[aria-label="Project state filter"] button[value="${value}"]`);
      if (!control) throw new Error('Missing project state filter');
      control.click();
    });
    await act(async () => controlEscape());
  }
  function controlEscape() { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); }

  it('opens saved CAD beside CAM, downloads importable data, and archives/restores through the same list', async () => {
    const storage = await workbench('shared-projects');
    const document = createCadDocument('Module 3', 'cad_module3');
    await saveCadDocument(storage.adapter, document, { expectedSavedVersion: null });
    await storage.adapter.writeText('cad/documents/cad_broken.cad.json', '{exact broken source');
    const connected: ConnectedWorkbenchCatalog = { ...storage, manifest: { ...storage.manifest, projects: [
      { id: 'paths', name: 'Toolpath', sourceKind: 'upid', path: 'projects/paths.json', updatedAt: '2026-10-16T00:00:00.000Z' }
    ] } };
    let openedDocument: CadDocument | undefined;
    const openCad = vi.fn(async (id: string) => { openedDocument = (await loadCadDocument(storage.adapter, id)).document; });
    const status = vi.fn();
    const downloads: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { if (blob instanceof Blob) downloads.push(blob); return 'blob:cad-project'; });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => root.render(<DashboardPage {...props} connectedWorkbench={connected} onOpenCadProject={openCad} onStatusMessage={status} />));
    await settle(() => expect(container.querySelectorAll('[data-project-row]')).toHaveLength(2));
    expect(status).toHaveBeenCalledWith(expect.stringContaining('cad_broken.cad.json'), 'warning');
    await act(async () => { button('Open project cad_module3 in CAD').click(); await openCad.mock.results[0].value; });
    expect(openedDocument).toEqual(document);
    await act(async () => button('Download CAD project cad_module3').click());
    await settle(() => expect(downloads).toHaveLength(1));
    expect(parseCadDocument(JSON.parse(await downloads[0].text()))).toEqual(document);
    const exact = await storage.adapter.readExactText?.(cadDocumentPath(document.id));
    await act(async () => button('Delete project cad_module3').click());
    await act(async () => button('Delete').click());
    await settle(() => expect(container.querySelector('[data-project-source="cad"]')).toBeNull());
    await selectState('archived');
    await settle(() => expect(container.querySelector('[data-project-source="cad"]')?.getAttribute('data-project-state')).toBe('archived'));
    await act(async () => button('Restore Module 3').click());
    await settle(() => expect(container.querySelector('[data-project-source="cad"]')?.getAttribute('data-project-state')).toBe('active'));
    expect(await storage.adapter.readExactText?.(cadDocumentPath(document.id))).toBe(exact);
    expect(await storage.adapter.readExactText?.('cad/documents/cad_broken.cad.json')).toBe('{exact broken source');
  });

  it('cancels old inventory after a storage switch and never displays its late results', async () => {
    const first = await workbench('first-cad-store');
    const second = await workbench('second-cad-store');
    const firstDocument = createCadDocument('First store', 'cad_first');
    const secondDocument = createCadDocument('Second store', 'cad_second');
    await saveCadDocument(first.adapter, firstDocument, { expectedSavedVersion: null });
    await saveCadDocument(second.adapter, secondDocument, { expectedSavedVersion: null });
    let resolveInventory: (value: { paths: string[]; truncated: boolean }) => void = () => {};
    const delayed = new Promise<{ paths: string[]; truncated: boolean }>(resolve => { resolveInventory = resolve; });
    vi.spyOn(first.adapter, 'listFiles').mockReturnValue(delayed);
    await act(async () => root.render(<DashboardPage {...props} connectedWorkbench={first} onOpenCadProject={vi.fn()} />));
    await act(async () => root.render(<DashboardPage {...props} connectedWorkbench={second} onOpenCadProject={vi.fn()} />));
    await settle(() => expect(container.querySelector('[data-project-source="cad"]')?.textContent).toContain('Second store'));
    await act(async () => resolveInventory({ paths: [cadDocumentPath(firstDocument.id)], truncated: false }));
    expect(container.querySelectorAll('[data-project-source="cad"]')).toHaveLength(1);
    expect(container.querySelector('[data-project-source="cad"]')?.textContent).toContain('Second store');
    expect((await loadCadDocument(first.adapter, firstDocument.id)).document).toEqual(firstDocument);
  });
});
