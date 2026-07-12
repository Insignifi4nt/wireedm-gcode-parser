import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import { updateWorkbenchSettings } from '@/domain/storage/updateWorkbenchSettings';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';

import {
  cleanupAppTestContext,
  createAppTestContext,
  flushAsync,
  renderApp,
  setInputValue,
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
    expect(text).not.toContain('imports, exports, templates, machines, editor, projects');
    expect(text).toContain('Import DXF');
    expect(text).toContain('Browser cache active');
    expect(text).not.toContain('imports, generated, exports');
    expect([...container.querySelectorAll('button')].some((button) =>
      button.textContent?.includes('Choose Workbench Folder')
    )).toBe(false);
    expect(container.querySelector('button[aria-label="Open settings"]')).not.toBeNull();
    expect(text).not.toContain('Connect the workbench folder first');
    expect(text).not.toContain('The next real feature');

    await act(async () => {
      container
        .querySelector('button[aria-label="Open settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(
      container.querySelector('[role="dialog"][aria-label="Workbench settings"]')?.textContent
    ).toContain('This browser does not support choosing a workbench folder.');
  });

  it('opens a settings modal with storage navigation and workbench location details', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const settingsButton = container.querySelector(
      'button[aria-label="Open settings"]'
    ) as HTMLButtonElement | null;
    settingsButton?.focus();

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

    const closeButton = dialog?.querySelector(
      'button[aria-label="Close settings"]'
    ) as HTMLButtonElement | null;
    expect(document.activeElement).toBe(closeButton);
    for (const selector of ['[data-app-header]', '[data-app-workspace-grid]', '[data-app-status-bar]']) {
      const backgroundRegion = container.querySelector(selector) as HTMLElement | null;
      expect(backgroundRegion?.inert).toBe(true);
      expect(backgroundRegion?.getAttribute('aria-hidden')).toBe('true');
    }

    const focusableElements = [...dialog!.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )];
    const lastFocusable = focusableElements.at(-1)!;
    lastFocusable.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
    });
    expect(document.activeElement).toBe(closeButton);

    closeButton?.focus();
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true })
      );
    });
    expect(document.activeElement).toBe(lastFocusable);

    settingsButton?.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
    });
    expect(document.activeElement).toBe(closeButton);
  });

  it('closes the settings modal when Escape is pressed', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const settingsButton = container.querySelector(
      'button[aria-label="Open settings"]'
    ) as HTMLButtonElement | null;
    const workspaceRegion = container.querySelector('[data-app-workspace-grid]') as HTMLElement;
    const statusRegion = container.querySelector('[data-app-status-bar]') as HTMLElement;
    workspaceRegion.setAttribute('aria-hidden', 'false');
    workspaceRegion.inert = false;
    statusRegion.inert = true;
    settingsButton?.focus();

    await act(async () => {
      settingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(
      container.querySelector('[role="dialog"][aria-label="Workbench settings"]')
    ).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[role="dialog"][aria-label="Workbench settings"]')).toBeNull();
    expect(document.activeElement).toBe(settingsButton);
    expect(workspaceRegion.getAttribute('aria-hidden')).toBe('false');
    expect(workspaceRegion.inert).toBe(false);
    expect(statusRegion.inert).toBe(true);
    expect(statusRegion.getAttribute('aria-hidden')).toBeNull();
  });

  it('restores the settings opener after close-button and backdrop dismissal', async () => {
    window.showDirectoryPicker = undefined;
    await renderApp(context);
    const settingsButton = container.querySelector(
      'button[aria-label="Open settings"]'
    ) as HTMLButtonElement;

    for (const closeRoute of ['button', 'backdrop'] as const) {
      settingsButton.focus();
      await act(async () => {
        settingsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close settings');

      await act(async () => {
        if (closeRoute === 'button') {
          container
            .querySelector('button[aria-label="Close settings"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } else {
          container
            .querySelector('[data-workbench-settings-overlay]')
            ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        }
      });
      await flushAsync();
      expect(container.querySelector('[data-workbench-settings-overlay]')).toBeNull();
      expect(document.activeElement).toBe(settingsButton);
    }
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
    expect(text).not.toContain('Export preview only');
    expect(text).not.toContain('Download Program');
  });

  it('makes the project library the primary Workbench surface before any session activity', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const workbenchPage = container.querySelector('[data-workbench-page]');
    const projectLibrary = container.querySelector('[data-project-library]');
    const projectList = projectLibrary?.querySelector('[aria-label="Project list"]');

    expect(workbenchPage).not.toBeNull();
    expect(projectLibrary).not.toBeNull();
    expect(projectList?.textContent).toContain('No projects yet');
    expect(projectList?.textContent).toContain('Path Project');
    expect(projectList?.textContent).toContain('Machine Program');
    expect(container.textContent).not.toContain('Latest DXF Import');
  });

  it('uses the full workbench width when there is no contextual rail', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const shell = container.querySelector('[data-app-shell]');
    const appRail = container.querySelector('[data-app-rail]');
    const collapseButton = container.querySelector(
      'button[aria-label="Collapse workbench sidebar"]'
    ) as HTMLButtonElement | null;

    expect(shell?.className).toContain('flex-col');
    expect(shell?.getAttribute('data-sidebar-collapsed')).toBe('false');
    expect(appRail).toBeNull();
    expect(container.querySelector('[data-app-rail-resizer]')).toBeNull();
    expect(collapseButton).toBeNull();
    expect(container.querySelector('main')?.parentElement?.style.gridTemplateColumns).toBe(
      'minmax(0, 1fr)'
    );
  });

  it('saves custom workbench templates and output settings in the browser cache', async () => {
    window.showDirectoryPicker = undefined;
    const updateWorkbenchSettingsService = vi.fn(updateWorkbenchSettings);

    await renderApp(context, { updateWorkbenchSettings: updateWorkbenchSettingsService });

    await act(async () => {
      container
        .querySelector('button[aria-label="Open settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const machineOutputSettingsButton = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Machine & Output settings'
    );
    expect(machineOutputSettingsButton).toBeDefined();
    await act(async () => {
      machineOutputSettingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

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
    const coordinatePrecision = container.querySelector(
      'input[aria-label="Coordinate precision"]'
    ) as HTMLInputElement | null;
    const customExtension = container.querySelector(
      'input[aria-label="Custom output extension"]'
    ) as HTMLInputElement | null;
    const machineName = container.querySelector(
      'input[aria-label="Machine profile name"]'
    ) as HTMLInputElement | null;
    const workAreaWidth = container.querySelector(
      'input[aria-label="Machine max width"]'
    ) as HTMLInputElement | null;
    const workAreaLength = container.querySelector(
      'input[aria-label="Machine max length"]'
    ) as HTMLInputElement | null;

    expect(headerEditor).not.toBeNull();
    expect(footerEditor).not.toBeNull();
    expect(outputExtension).not.toBeNull();
    expect(lineEnding).not.toBeNull();
    expect(coordinatePrecision).not.toBeNull();
    expect(coordinatePrecision?.min).toBe('0');
    expect(coordinatePrecision?.max).toBe('6');
    expect(coordinatePrecision?.step).toBe('1');
    expect(machineName).not.toBeNull();
    expect(workAreaWidth).not.toBeNull();
    expect(workAreaLength).not.toBeNull();

    await act(async () => {
      if (headerEditor) setTextAreaValue(headerEditor, '%\nCUSTOM HEADER');
      if (footerEditor) setTextAreaValue(footerEditor, 'CUSTOM FOOTER\n%');
      if (outputExtension) setSelectValue(outputExtension, 'custom');
      if (lineEnding) setSelectValue(lineEnding, 'lf');
      if (coordinatePrecision) setInputValue(coordinatePrecision, '5');
      if (machineName) setInputValue(machineName, 'Shop Wire EDM');
      if (workAreaWidth) setInputValue(workAreaWidth, '320.5');
      if (workAreaLength) setInputValue(workAreaLength, '470');
    });

    const visibleCustomExtension = container.querySelector(
      'input[aria-label="Custom output extension"]'
    ) as HTMLInputElement | null;
    expect(customExtension).toBeNull();
    expect(visibleCustomExtension).not.toBeNull();
    await act(async () => {
      if (visibleCustomExtension) setInputValue(visibleCustomExtension, '.CUT');
    });

    const saveSettingsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save Settings')
    );
    expect(saveSettingsButton).toBeDefined();

    await act(async () => {
      saveSettingsButton?.click();
    });
    await flushAsync();

    expect(updateWorkbenchSettingsService).toHaveBeenCalledOnce();
    expect(updateWorkbenchSettingsService.mock.calls[0]?.[1]).toMatchObject({
      header: '%\nCUSTOM HEADER',
      footer: 'CUSTOM FOOTER\n%',
      machineProfile: {
        name: 'Shop Wire EDM',
        output: {
          extension: 'custom',
          customExtension: '.CUT',
          lineEnding: 'lf',
          coordinatePrecision: 5
        },
        workArea: {
          widthMm: 320.5,
          lengthMm: 470
        }
      }
    });

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
      extension: 'custom',
      customExtension: 'cut',
      lineEnding: 'lf',
      coordinatePrecision: 5
    });
    expect(manifest.machineProfiles[0]).toMatchObject({
      name: 'Shop Wire EDM',
      workArea: {
        widthMm: 320.5,
        lengthMm: 470
      }
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
      extension: 'custom',
      customExtension: 'cut',
      lineEnding: 'lf',
      coordinatePrecision: 5
    });
    expect(project.machine.workArea).toEqual({
      widthMm: 320.5,
      lengthMm: 470
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

  it('keeps the browser-cache workbench active when a folder upgrade fails', async () => {
    window.showDirectoryPicker = vi.fn();
    const connectWorkbenchDirectoryService = vi.fn(async () => {
      throw new Error('Folder permission was denied.');
    });

    await renderApp(context, {
      connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }),
      connectWorkbenchDirectory: connectWorkbenchDirectoryService
    });
    await act(async () => {
      container
        .querySelector('button[aria-label="Open settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const connectButton = container.querySelector(
      'button[aria-label="Choose Workbench Folder"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(connectWorkbenchDirectoryService).toHaveBeenCalledOnce();
    expect(container.textContent).toContain('Folder permission was denied.');
    expect(container.querySelector('[data-storage-status-label]')?.textContent).toContain(
      'Browser cache'
    );
    expect(container.querySelector('[data-workbench-page]')).not.toBeNull();
    expect(
      [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Import DXF as Path Project')
      )?.disabled
    ).toBe(false);
  });

  it('requires returning to Workbench before switching storage and unloads the old editor document', async () => {
    window.showDirectoryPicker = vi.fn();
    const folderWorkbench = createDirectoryWorkbench('production-jobs');
    const connectWorkbenchDirectoryService = vi.fn(async () => folderWorkbench);

    await renderApp(context, {
      connectRememberedWorkbenchDirectory: async () => ({ status: 'missing' }),
      connectWorkbenchDirectory: connectWorkbenchDirectoryService
    });

    const programInput = container.querySelector(
      'input[aria-label="Machine program file"]'
    ) as HTMLInputElement | null;
    expect(programInput).not.toBeNull();
    Object.defineProperty(programInput, 'files', {
      configurable: true,
      value: [new File(['G0 X0 Y0\nG1 X8 Y4\nM30'], 'cache-program.nc')]
    });
    await act(async () => {
      programInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-context="machine-program"]')).not.toBeNull();
    await act(async () => {
      container
        .querySelector('button[aria-label="Open settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    let connectButton = container.querySelector(
      'button[aria-label="Choose Workbench Folder"]'
    ) as HTMLButtonElement | null;
    expect(connectButton?.disabled).toBe(true);
    expect(container.textContent).toContain('Return to Workbench before switching storage');
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(connectWorkbenchDirectoryService).not.toHaveBeenCalled();

    await act(async () => {
      container
        .querySelector('button[aria-label="Close settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      container
        .querySelector('button[aria-label="Back to Dashboard"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
    await act(async () => {
      container
        .querySelector('button[aria-label="Open settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    connectButton = container.querySelector(
      'button[aria-label="Choose Workbench Folder"]'
    ) as HTMLButtonElement | null;
    expect(connectButton?.disabled).toBe(false);
    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
    expect(connectWorkbenchDirectoryService).toHaveBeenCalledOnce();

    await act(async () => {
      container
        .querySelector('button[aria-label="Close settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Open Editor'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
    expect(container.querySelector('[data-editor-context="empty-program"]')).not.toBeNull();
    const emptyProgramEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(emptyProgramEditor?.value).toBe('');
    expect(emptyProgramEditor?.disabled).toBe(true);
  });

  it('labels unsupported persistent storage as temporary instead of connected local storage', async () => {
    const temporaryWorkbench = createTemporaryWorkbench();

    await renderApp(context, {
      connectCachedWorkbench: async () => temporaryWorkbench
    });

    expect(container.textContent).toContain('Temporary storage only');
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
    expect(dialog?.textContent).toContain('Changes stay available only until this tab reloads.');
    expect(dialog?.textContent).toContain('Temporary memory');
    expect(dialog?.textContent).toContain('No - current tab only.');
    expect(dialog?.textContent).toContain('This workbench has no persistent storage location.');
  });

  it('searches project sources by visible labels without replacing raw filter values', async () => {
    const workbench = createDirectoryWorkbench('wire-jobs');
    workbench.manifest.projects = [
      {
        id: 'path-project',
        name: 'Alpha bracket',
        path: 'projects/alpha/project.json',
        sourceKind: 'dxf',
        updatedAt: '2026-05-30T10:00:00.000Z'
      },
      {
        id: 'machine-program',
        name: 'Zeta repair',
        path: 'projects/zeta/project.json',
        sourceKind: 'external-gcode',
        updatedAt: '2026-05-31T10:00:00.000Z'
      }
    ];

    await renderApp(context, {
      connectCachedWorkbench: async () => workbench
    });

    const sourceSelect = container.querySelector(
      'select[aria-label="Project source filter"]'
    ) as HTMLSelectElement | null;
    const searchInput = container.querySelector(
      'input[aria-label="Search projects"]'
    ) as HTMLInputElement | null;

    expect(sourceSelect?.querySelector('option[value="dxf"]')?.textContent).toBe('Path Project');
    expect(sourceSelect?.querySelector('option[value="external-gcode"]')?.textContent).toBe(
      'Machine Program'
    );
    expect(searchInput).not.toBeNull();

    await act(async () => {
      if (searchInput) setInputValue(searchInput, 'Path Project');
    });

    expect(container.querySelector('[data-project-source="dxf"]')).not.toBeNull();
    expect(container.querySelector('[data-project-source="external-gcode"]')).toBeNull();

    await act(async () => {
      if (searchInput) setInputValue(searchInput, 'Machine Program');
    });

    expect(container.querySelector('[data-project-source="dxf"]')).toBeNull();
    expect(container.querySelector('[data-project-source="external-gcode"]')).not.toBeNull();
  });

  it('filters and sorts dashboard projects without changing project actions', async () => {
    const workbench = createDirectoryWorkbench('wire-jobs');
    workbench.manifest.projects = [
      {
        id: 'old-dxf',
        name: 'Alpha bracket',
        path: 'projects/alpha/project.json',
        sourceKind: 'dxf',
        updatedAt: '2026-05-30T10:00:00.000Z'
      },
      {
        id: 'new-gcode',
        name: 'Zeta repair',
        path: 'projects/zeta/project.json',
        sourceKind: 'external-gcode',
        updatedAt: '2026-05-31T10:00:00.000Z'
      }
    ];

    await renderApp(context, {
      connectCachedWorkbench: async () => workbench
    });

    const projectText = () =>
      container.querySelector('[aria-label="Project list"]')?.textContent ?? '';
    const pathProjectRow = container.querySelector('[data-project-source="dxf"]');
    const machineProgramRow = container.querySelector(
      '[data-project-source="external-gcode"]'
    );

    expect(pathProjectRow).not.toBeNull();
    expect(machineProgramRow).not.toBeNull();
    expect(pathProjectRow?.textContent ?? '').toContain('Path Project');
    expect(machineProgramRow?.textContent ?? '').toContain('Machine Program');
    expect(machineProgramRow?.textContent ?? '').not.toContain('Rename');
    expect(machineProgramRow?.textContent ?? '').not.toContain('Delete');
    expect(
      machineProgramRow?.querySelector('button[aria-label="Rename project new-gcode"]')
    ).not.toBeNull();
    expect(
      machineProgramRow?.querySelector('button[aria-label="Delete project new-gcode"]')
    ).not.toBeNull();
    expect(projectText()).toContain('Zeta repair');
    expect(projectText()).toContain('Alpha bracket');
    expect(projectText().indexOf('Zeta repair')).toBeLessThan(
      projectText().indexOf('Alpha bracket')
    );

    const sortSelect = container.querySelector(
      'select[aria-label="Project sort"]'
    ) as HTMLSelectElement | null;
    expect(sortSelect).not.toBeNull();

    await act(async () => {
      if (sortSelect) setSelectValue(sortSelect, 'name-asc');
    });

    expect(projectText().indexOf('Alpha bracket')).toBeLessThan(
      projectText().indexOf('Zeta repair')
    );

    const sourceSelect = container.querySelector(
      'select[aria-label="Project source filter"]'
    ) as HTMLSelectElement | null;
    expect(sourceSelect).not.toBeNull();

    await act(async () => {
      if (sourceSelect) setSelectValue(sourceSelect, 'external-gcode');
    });

    expect(projectText()).toContain('Zeta repair');
    expect(projectText()).not.toContain('Alpha bracket');
    expect(container.textContent).toContain('1 / 2 projects');

    const searchInput = container.querySelector(
      'input[aria-label="Search projects"]'
    ) as HTMLInputElement | null;
    expect(searchInput).not.toBeNull();

    await act(async () => {
      if (searchInput) setInputValue(searchInput, 'missing');
    });

    expect(projectText()).not.toContain('Zeta repair');
    expect(projectText()).toContain('No projects match the active filters.');
    expect(container.querySelector('button[aria-label="Rename project new-gcode"]')).toBeNull();
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
      deleteText: async () => undefined,
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
        lineEnding: 'crlf',
        coordinatePrecision: 3
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
      deleteText: async () => undefined,
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
        lineEnding: 'crlf',
        coordinatePrecision: 3
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
