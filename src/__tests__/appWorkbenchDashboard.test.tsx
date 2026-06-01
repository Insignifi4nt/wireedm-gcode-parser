import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

import {
  cleanupAppTestContext,
  createAppTestContext,
  flushAsync,
  renderApp,
  setSelectValue,
  setTextAreaValue,
  simpleLineDxf,
  type AppTestContext
} from './appTestHelpers';

describe('App dashboard and workbench shell', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('starts with a browser cache fallback when folder access is unavailable', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const text = container.textContent || '';

    expect(text).toContain('Browser cache');
    expect(text).toContain('imports, exports, templates, machines, editor, projects');
    expect(text).toContain('Import DXF');
    expect(text).toContain('Browser cache active');
    expect(text).toContain('This browser does not support choosing a workbench folder.');
    expect(text).not.toContain('imports, generated, exports');
    expect([...container.querySelectorAll('button')].some((button) =>
      button.textContent?.includes('Choose Workbench Folder')
    )).toBe(false);
    expect(container.querySelector('button[aria-label="Open settings"]')).not.toBeNull();
    expect(text).not.toContain('Connect the workbench folder first');
    expect(text).not.toContain('The next real feature');
  });

  it('opens a settings modal with storage navigation and workbench location details', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const settingsButton = container.querySelector(
      'button[aria-label="Open settings"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector(
      '[role="dialog"][aria-label="Workbench settings"]'
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('Storage');
    expect(dialog?.querySelector('[aria-current="page"]')?.textContent).toContain('Storage');
    expect(dialog?.textContent).toContain('Browser cache active');
    expect(dialog?.textContent).toContain('Browser cache fallback');
    expect(dialog?.textContent).toContain(
      'Yes - kept as site data until browser or site data is cleared.'
    );
    expect(dialog?.textContent).toContain('Current site cache');
    expect(dialog?.textContent).toContain('No chosen workbench folder is connected.');
    expect(dialog?.textContent).toContain('wire-edm-workbench:*');
    expect(dialog?.querySelector('button[aria-label="Choose Workbench Folder"]')).toBeNull();
  });

  it('renders real cache and import actions without fake dashboard rows or dead mode tabs', async () => {
    window.showDirectoryPicker = vi.fn();

    await renderApp(context);

    const buttons = [...container.querySelectorAll('button')];
    const text = container.textContent || '';

    expect(buttons.some((button) => button.textContent?.includes('Import DXF'))).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes('Choose Workbench Folder'))).toBe(false);
    expect(text).toContain('Browser cache');
    expect(text).not.toContain('Folder picker available');
    expect(text).not.toContain('flange-slot');
    expect(text).not.toContain('repair-job');
    expect(text).not.toContain('Verify');
    expect(text).toContain('Export preview only');
    expect(text).not.toContain('Download Program');
  });

  it('collapses the app storage rail to give the editor more working width', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const shell = container.querySelector('[data-app-shell]');
    const appRail = container.querySelector('[data-app-rail]');
    const appHeader = container.querySelector('[data-app-header]');
    const collapseButton = container.querySelector(
      'button[aria-label="Collapse workbench sidebar"]'
    ) as HTMLButtonElement | null;

    expect(shell?.className).toContain('flex-col');
    expect(shell?.getAttribute('data-sidebar-collapsed')).toBe('false');
    expect(collapseButton).not.toBeNull();
    expect(appRail?.contains(collapseButton)).toBe(true);
    expect(appHeader?.contains(collapseButton)).toBe(false);

    await act(async () => {
      collapseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(shell?.getAttribute('data-sidebar-collapsed')).toBe('true');
    const expandButton = container.querySelector(
      'button[aria-label="Expand workbench sidebar"]'
    ) as HTMLButtonElement | null;
    expect(expandButton).not.toBeNull();
    expect(appRail?.contains(expandButton)).toBe(true);
  });

  it('saves custom workbench templates and output settings in the browser cache', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const headerEditor = container.querySelector(
      'textarea[aria-label="Header template"]'
    ) as HTMLTextAreaElement | null;
    const footerEditor = container.querySelector(
      'textarea[aria-label="Footer template"]'
    ) as HTMLTextAreaElement | null;
    const outputExtension = container.querySelector(
      'select[aria-label="Output extension"]'
    ) as HTMLSelectElement | null;
    const lineEnding = container.querySelector(
      'select[aria-label="Line ending"]'
    ) as HTMLSelectElement | null;

    expect(headerEditor).not.toBeNull();
    expect(footerEditor).not.toBeNull();
    expect(outputExtension).not.toBeNull();
    expect(lineEnding).not.toBeNull();

    await act(async () => {
      if (headerEditor) setTextAreaValue(headerEditor, '%\nCUSTOM HEADER');
      if (footerEditor) setTextAreaValue(footerEditor, 'CUSTOM FOOTER\n%');
      if (outputExtension) setSelectValue(outputExtension, 'nc');
      if (lineEnding) setSelectValue(lineEnding, 'lf');
    });

    const saveSettingsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save Settings')
    );
    expect(saveSettingsButton).toBeDefined();

    await act(async () => {
      saveSettingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(window.localStorage.getItem('wire-edm-workbench:file:templates/header.gcode')).toBe(
      '%\nCUSTOM HEADER'
    );
    expect(window.localStorage.getItem('wire-edm-workbench:file:templates/footer.gcode')).toBe(
      'CUSTOM FOOTER\n%'
    );

    const manifest = JSON.parse(
      window.localStorage.getItem('wire-edm-workbench:file:workbench.json') || '{}'
    );
    expect(manifest.output).toEqual({
      extension: 'nc',
      lineEnding: 'lf'
    });
    expect(container.textContent).toContain('Settings saved');

    const dxfInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    expect(dxfInput).not.toBeNull();
    Object.defineProperty(dxfInput, 'files', {
      value: [new File([simpleLineDxf()], 'custom-output.dxf')],
      configurable: true
    });

    await act(async () => {
      dxfInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const importManifest = JSON.parse(
      window.localStorage.getItem('wire-edm-workbench:file:workbench.json') || '{}'
    );
    const project = JSON.parse(
      window.localStorage.getItem(`wire-edm-workbench:file:${importManifest.projects[0].path}`) ||
        '{}'
    );
    expect('generated' in project).toBe(false);
    expect(project.machine.templates).toEqual({
      header: '%\nCUSTOM HEADER',
      footer: 'CUSTOM FOOTER\n%'
    });
    expect(project.machine.output).toEqual({
      extension: 'nc',
      lineEnding: 'lf'
    });
  });

  it('chooses a workbench folder from settings and displays folder details', async () => {
    window.showDirectoryPicker = vi.fn();
    const folderWorkbench = createDirectoryWorkbench('wire-jobs');
    const connectWorkbenchDirectoryService = vi.fn(async () => folderWorkbench);

    await renderApp(context, {
      connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }),
      connectWorkbenchDirectory: connectWorkbenchDirectoryService
    });

    const settingsButton = container.querySelector(
      'button[aria-label="Open settings"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector(
      '[role="dialog"][aria-label="Workbench settings"]'
    );
    const connectButton = dialog?.querySelector(
      'button[aria-label="Choose Workbench Folder"]'
    ) as HTMLButtonElement | null;
    expect(connectButton).not.toBeNull();
    expect(container.textContent).toContain('Browser cache is active until then.');

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Workbench folder connected');
    expect(container.textContent).toContain('Chosen workbench folder');
    expect(container.textContent).toContain('Folder namewire-jobs');
    expect(connectWorkbenchDirectoryService).toHaveBeenCalledTimes(1);
  });

  it('labels unsupported persistent storage as temporary instead of connected local storage', async () => {
    const temporaryWorkbench = createTemporaryWorkbench();

    await renderApp(context, {
      connectCachedWorkbench: async () => temporaryWorkbench
    });

    expect(container.textContent).toContain('Temporary storage only');
    expect(container.textContent).toContain('Changes stay available only until this tab reloads.');
    expect(container.textContent).not.toContain('Workbench folder connected');

    const settingsButton = container.querySelector(
      'button[aria-label="Open settings"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector(
      '[role="dialog"][aria-label="Workbench settings"]'
    );
    expect(dialog?.textContent).toContain('Temporary memory');
    expect(dialog?.textContent).toContain('No - current tab only.');
    expect(dialog?.textContent).toContain('This workbench has no persistent storage location.');
  });
});

function createTemporaryWorkbench(): ConnectedWorkbench {
  const activeMachineProfile = createDefaultMachineProfile();

  return {
    adapter: {
      name: 'Temporary storage',
      kind: 'memory',
      ensureDirectory: async () => undefined,
      readText: async () => null,
      writeText: async () => undefined
    },
    manifest: {
      schemaVersion: 1,
      name: 'Temporary storage',
      createdAt: '2026-05-30T18:00:00.000Z',
      updatedAt: '2026-05-30T18:00:00.000Z',
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: {
        extension: 'iso',
        lineEnding: 'crlf'
      },
      activeMachineProfileId: activeMachineProfile.id,
      machineProfiles: [activeMachineProfile],
      projects: []
    },
    activeMachineProfile,
    header: '%',
    footer: '%'
  };
}

function createDirectoryWorkbench(name: string): ConnectedWorkbench {
  const activeMachineProfile = createDefaultMachineProfile();

  return {
    adapter: {
      name,
      kind: 'directory',
      ensureDirectory: async () => undefined,
      readText: async () => null,
      writeText: async () => undefined
    },
    manifest: {
      schemaVersion: 1,
      name,
      createdAt: '2026-05-30T18:00:00.000Z',
      updatedAt: '2026-05-30T18:00:00.000Z',
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: {
        extension: 'iso',
        lineEnding: 'crlf'
      },
      activeMachineProfileId: activeMachineProfile.id,
      machineProfiles: [activeMachineProfile],
      projects: []
    },
    activeMachineProfile,
    header: '%',
    footer: '%'
  };
}
