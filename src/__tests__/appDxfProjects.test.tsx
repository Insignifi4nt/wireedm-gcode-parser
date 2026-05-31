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

describe('App DXF imports and project library', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('imports a DXF through the browser cache workbench and opens the generated program in the editor', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();
    const dxfText = simpleLineDxf();

    await renderApp(context, { downloadGeneratedProgram });

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, 'files', {
      value: [new File([dxfText], 'part.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('Editor');
    expect(container.textContent).toContain('generated/part-');
    expect(container.textContent).toContain('G1 X10.000 Y0.000');
    expect(container.textContent).toContain('2 path items');

    const rawManifest = window.localStorage.getItem('wire-edm-workbench:file:workbench.json');
    const manifest = JSON.parse(rawManifest || '{}');
    const projectPath = manifest.projects[0].path;
    const project = JSON.parse(
      window.localStorage.getItem(`wire-edm-workbench:file:${projectPath}`) || '{}'
    );

    expect(manifest.projects).toHaveLength(1);
    expect(project.source.kind).toBe('dxf');
    expect(project.generated.body).toContain('G1 X10.000 Y0.000');

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );
    expect(dashboardButton).toBeDefined();

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('part');
    expect(container.textContent).toContain('1 project');
    expect(container.textContent).toContain('G1 X10.000 Y0.000');

    const downloadButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Download Program')
    );
    expect(downloadButton).not.toBeNull();

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^part-\d{4}-\d{2}-\d{2}\.iso$/),
      text: expect.stringContaining('G1 X10.000 Y0.000')
    });

    expect(container.textContent).toContain('Open in Editor');
  });

  it('opens a stored project from the dashboard library instead of only the latest import panel', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'library-open.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );
    expect(dashboardButton).toBeDefined();

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const manifest = JSON.parse(
      window.localStorage.getItem('wire-edm-workbench:file:workbench.json') || '{}'
    );
    const projectId = manifest.projects[0].id;
    const libraryOpenButton = container.querySelector(
      `button[aria-label="Open project ${projectId} in editor"]`
    ) as HTMLButtonElement | null;

    expect(libraryOpenButton).not.toBeNull();

    await act(async () => {
      libraryOpenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('Editor');
    expect(container.textContent).toContain('generated/library-open-');
    expect(container.textContent).toContain('G1 X10.000 Y0.000');
  });

  it('warns in the editor when imported DXF geometry exceeds the active machine profile work area', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const maxWidthInput = container.querySelector(
      'input[aria-label="Machine max width"]'
    ) as HTMLInputElement | null;
    const maxLengthInput = container.querySelector(
      'input[aria-label="Machine max length"]'
    ) as HTMLInputElement | null;

    expect(maxWidthInput).not.toBeNull();
    expect(maxLengthInput).not.toBeNull();

    await act(async () => {
      if (maxWidthInput) setInputValue(maxWidthInput, '5');
      if (maxLengthInput) setInputValue(maxLengthInput, '5');
    });

    const saveSettingsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save Settings')
    );

    await act(async () => {
      saveSettingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'oversized.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const machineWarning = container.querySelector('[data-editor-machine-fit="too-large"]');
    expect(machineWarning).not.toBeNull();
    expect(machineWarning?.closest('details')).toBeNull();
    expect(machineWarning?.textContent).toContain(
      'width 10.000 > 5.000 mm'
    );
  });
});
