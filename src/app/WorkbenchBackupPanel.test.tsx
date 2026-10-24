import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';
import * as downloads from '@/domain/post/downloadProgramFile';
import { WorkbenchBackupPanel } from './WorkbenchBackupPanel';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('saved-file backup while an editor is open', () => {
  it('downloads a verified saved-file backup without enabling restore or cleanup', async () => {
    const adapter = createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });
    const opened = await initializeWorkbenchCatalog(adapter);
    if (!opened.ok) throw new Error(opened.error.message);
    const imported = await importExternalProgram(opened.workbench, { fileName: 'part.nc', text: 'G21\r\nG1 X10 Y5\r\n' });
    if (!imported.ok) throw new Error(imported.error.message);
    await adapter.writeText('retained-not-owned.txt', 'retain this original');
    const originals = new Map(await Promise.all((await adapter.listFiles!()).paths.map(async (path): Promise<[string,string|null]> => [path, await adapter.readExactText!(path)])));
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    const download = vi.spyOn(downloads, 'downloadProgramFile').mockImplementation(() => undefined);
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    const button = (text: string) => {
      const element = [...container.querySelectorAll('button')].find(element => element.textContent === text);
      if (!element) throw new Error(`Button missing: ${text}`);
      return element;
    };
    try {
      await act(async () => root.render(<WorkbenchBackupPanel workbench={imported.workbench} disabled={false} mutationsDisabled />));
      expect(button('Create and download backup').disabled).toBe(false);
      expect(button('Choose backup to restore').disabled).toBe(true);
      await act(async () => {
        button('Create and download backup').click();
        await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
      });
      expect(download).toHaveBeenCalledOnce();
      const archive = JSON.parse(download.mock.calls[0][0].text);
      expect(archive.files).toContainEqual(expect.objectContaining({path:imported.editorProgram.filePath,text:imported.editorProgram.text}));
      expect(container.textContent).toContain('unsaved edits are excluded');
      expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
      expect(write).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      for (const [path,text] of originals) expect(await adapter.readExactText!(path)).toBe(text);
      await act(async () => root.render(<WorkbenchBackupPanel workbench={imported.workbench} disabled mutationsDisabled />));
      expect(button('Create and download backup').disabled).toBe(true);
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
});
