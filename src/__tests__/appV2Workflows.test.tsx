import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';

import {
  cleanupAppTestContext,
  createAppTestContext,
  flushAsync,
  prepareDxfImport,
  renderApp,
  setSelectValue,
  simpleLineDxf,
  type AppTestContext
} from './appTestHelpers';

const storagePrefix = 'wire-edm-workbench:file:';

describe('V2 app workflows', () => {
  let context: AppTestContext;

  beforeEach(() => {
    context = createAppTestContext();
    window.showDirectoryPicker = undefined;
  });

  afterEach(() => cleanupAppTestContext(context));

  it('creates a strict browser-cache catalog with no machine or export defaults', async () => {
    await renderApp(context);

    const manifest = await storedJson('workbench.json');
    const machines = await storedJson('machines/library.json');
    const posts = await storedJson('posts/library.json');

    expect(manifest).toMatchObject({
      format: 'wire-edm-workbench',
      schemaVersion: 3,
      preferences: {
        importUnits: { mode: 'ask' },
        recentPlanningMachineId: null
      },
      projects: []
    });
    expect(machines).toMatchObject({
      format: 'wire-edm-machine-library',
      schemaVersion: 1,
      machines: []
    });
    expect(posts).toMatchObject({
      format: 'wire-edm-post-library',
      schemaVersion: 1,
      installations: []
    });
  });

  it('requires an explicit unit decision and persists controller-neutral UPID', async () => {
    await renderApp(context);
    await prepareDxfImport(
      context.container,
      new File([simpleLineDxf()], 'neutral.dxf', { type: 'application/dxf' })
    );

    const dialog = context.container.querySelector(
      '[role="dialog"][aria-label="Review DXF import"]'
    );
    const unitSelect = dialog?.querySelector('select[aria-label="DXF units"]') as HTMLSelectElement;
    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.trim() === 'Import and open'
    ) as HTMLButtonElement;

    expect(unitSelect.value).toBe('');
    expect(confirm.disabled).toBe(true);

    await act(async () => setSelectValue(unitSelect, 'millimeters'));
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    await flushAsync();

    await vi.waitFor(() => expect(context.container.querySelector('[data-editor-context="path-project"]')).not.toBeNull());
    const manifest = await storedJson('workbench.json');
    const project = await storedJson(manifest.projects[0].path);
    expect(project).toMatchObject({
      format: 'wire-edm-project',
      schemaVersion: 2,
      source: { kind: 'dxf' },
      content: { kind: 'upid-document' },
      savedRevisionIds: []
    });
    expect(project).not.toHaveProperty('machine');
    expect(project).not.toHaveProperty('post');
  });

  it('reports an invalid legacy catalog instead of opening replacement storage', async () => {
    window.localStorage.setItem(`${storagePrefix}workbench.json`, JSON.stringify({
      format: 'wire-edm-workbench',
      schemaVersion: 1
    }));

    await renderApp(context);

    await vi.waitFor(() => expect(context.container.textContent).toContain('Legacy workbench manifest schema violation'));
    expect(context.container.textContent).toContain('Storage not connected');
    expect((await storedJson('workbench.json')).schemaVersion).toBe(1);
  });

  it('exposes exact machine and post libraries in settings without creating a selection', async () => {
    await renderApp(context);
    await vi.waitFor(() => expect(context.container.textContent).not.toContain('Loading projects…'));
    await act(async () => {
      (context.container.querySelector('button[aria-label="Open settings"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      [...context.container.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === 'Machines & setups')
        ?.click();
    });

    expect(context.container.textContent).toContain('Install a machine package');
    expect(context.container.textContent).toContain('Installed machines');
    expect((context.container.querySelector('select') as HTMLSelectElement).value).toBe('ask');
    expect(context.container.textContent).toContain('No machines installed');
  });
});

async function storedJson(path: string) {
  const text = await createBrowserCacheAdapter(window.localStorage).readText(path);
  if (text === null) throw new Error(`Missing browser-cache file: ${path}.`);
  return JSON.parse(text);
}
