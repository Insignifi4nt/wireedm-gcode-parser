import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeDirectoryHandle,
  cleanupAppTestContext,
  createAppTestContext,
  dispatchTouchEvent,
  flushAsync,
  parseSvgViewBox,
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

  it('starts with a local storage workbench when folder access is unavailable', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const text = container.textContent || '';

    expect(text).toContain('Local storage');
    expect(text).toContain('Import DXF');
    expect(text).toContain('Connect Local Storage');
    expect(text).not.toContain('Connect the workbench folder first');
    expect(text).not.toContain('The next real feature');
  });

  it('renders real cache and import actions without fake dashboard rows or dead mode tabs', async () => {
    window.showDirectoryPicker = vi.fn();

    await renderApp(context);

    const buttons = [...container.querySelectorAll('button')];
    const text = container.textContent || '';

    expect(buttons.some((button) => button.textContent?.includes('Import DXF'))).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes('Connect Local Storage'))).toBe(
      true
    );
    expect(text).toContain('Local storage');
    expect(text).not.toContain('Folder picker available');
    expect(text).not.toContain('flange-slot');
    expect(text).not.toContain('repair-job');
    expect(text).not.toContain('Verify');
    expect(text).not.toContain('Export');
  });

  it('collapses the app storage rail to give the editor more working width', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const shell = container.querySelector('[data-app-shell]');
    const collapseButton = container.querySelector(
      'button[aria-label="Collapse workbench sidebar"]'
    ) as HTMLButtonElement | null;

    expect(shell?.className).toContain('flex-col');
    expect(shell?.getAttribute('data-sidebar-collapsed')).toBe('false');
    expect(collapseButton).not.toBeNull();

    await act(async () => {
      collapseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(shell?.getAttribute('data-sidebar-collapsed')).toBe('true');
    expect(container.querySelector('button[aria-label="Expand workbench sidebar"]')).not.toBeNull();
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
    const programPath = project.generated.files.at(-1).path;
    const generatedProgram = window.localStorage.getItem(`wire-edm-workbench:file:${programPath}`);

    expect(programPath).toMatch(/^generated\/custom-output-\d{4}-\d{2}-\d{2}\.nc$/);
    expect(generatedProgram).toContain('%\nCUSTOM HEADER');
    expect(generatedProgram).toContain('CUSTOM FOOTER\n%');
    expect(generatedProgram).not.toContain('G90 G21 G17 G40');
  });

  it('clicking connect refreshes local storage without selecting a folder', async () => {
    const directory = new FakeDirectoryHandle('wire-jobs');
    window.showDirectoryPicker = vi.fn(async () => directory as unknown as FileSystemDirectoryHandle);
    window.localStorage.setItem(
      'wire-edm-workbench:file:templates/header.gcode',
      'CUSTOM HEADER'
    );

    await renderApp(context);

    const connectButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Connect Local Storage')
    );
    expect(connectButton).not.toBeNull();

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.showDirectoryPicker).not.toHaveBeenCalled();
    expect(directory.files.size).toBe(0);
    expect(window.localStorage.getItem('wire-edm-workbench:file:templates/header.gcode')).toBe(
      'CUSTOM HEADER'
    );
    expect(window.localStorage.getItem('wire-edm-workbench:file:templates/footer.gcode')).toContain(
      'M30'
    );
    expect(container.textContent).toContain('Local storage workbench active');
    expect(container.textContent).toContain('Local storage connected');
  });
});
