import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeDirectoryHandle,
  cleanupAppTestContext,
  createAppTestContext,
  dispatchTouchEvent,
  enableAutoOpenEditorWorkspacePanels,
  flushAsync,
  parseSvgViewBox,
  renderApp,
  setInputValue,
  setSelectValue,
  setTextAreaValue,
  simpleLineDxf,
  type AppTestContext
} from './appTestHelpers';

describe('Editor import, export, and parse feedback', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    enableAutoOpenEditorWorkspacePanels();
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('opens the editor and imports external G-code files through the active cache workbench', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X12 Y4', 'M30', '%'].join('\n');

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );
    expect(openEditorButton).toBeDefined();

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('Editor');
    expect(container.textContent).toContain('Import Program');
    expect(container.querySelector('[data-editor-empty-preview]')?.className).toContain('h-full');

    const fileInput = container.querySelector('input[aria-label="G-code program file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, 'files', {
      value: [new File([programText], 'shop-output.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('editor/shop-output-');
    expect(container.textContent).toContain('G1 X12 Y4');
    expect(container.textContent).toContain('2 path items');
    expect(container.querySelector('[data-editor-layout="canvas-first"]')).not.toBeNull();
    expect(container.querySelector('[data-editor-canvas-panel]')).not.toBeNull();
    expect(container.querySelector('[data-editor-inspector-panel]')).not.toBeNull();
    expect(container.querySelector('[data-editor-side-code-panel]')).not.toBeNull();
    expect(container.querySelector('[data-editor-line-toolbar]')).not.toBeNull();
    const codePanel = container.querySelector('[data-editor-side-code-panel]');
    const statsSection = container.querySelector('[data-editor-stats-section]') as HTMLDetailsElement | null;
    expect(statsSection).not.toBeNull();
    expect(statsSection?.open).toBe(true);
    expect(codePanel?.compareDocumentPosition(statsSection!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(container.querySelector('[data-editor-structure="header"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-editor-structure="body"]')?.textContent).toBe('2');
    expect(container.querySelector('[data-editor-structure="footer"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-editor-structure="groups"]')?.textContent).toBe('2');
    expect(container.querySelector('svg[aria-label="G-code path preview"] path[data-type="cut"]')).not.toBeNull();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    const rawProgramDetails = container.querySelector(
      '[data-editor-code-section="text"]'
    ) as HTMLDetailsElement | null;
    expect(programEditor).not.toBeNull();
    expect(rawProgramDetails).toBeInstanceOf(HTMLDetailsElement);
    expect(rawProgramDetails?.open).toBe(false);

    const firstCutRow = container.querySelector(
      '[data-editor-line="2"]'
    ) as HTMLButtonElement | null;
    const secondCutRow = container.querySelector(
      '[data-editor-line="3"]'
    ) as HTMLButtonElement | null;
    const firstCutPin = container.querySelector(
      'button[data-editor-pin-line="2"]'
    ) as HTMLButtonElement | null;
    const firstCutPath = container.querySelector(
      'svg[aria-label="G-code path preview"] path[data-line="2"]'
    );
    const secondCutPath = container.querySelector(
      'svg[aria-label="G-code path preview"] path[data-line="3"]'
    );

    expect(firstCutRow).not.toBeNull();
    expect(secondCutRow).not.toBeNull();
    expect(firstCutPin).not.toBeNull();
    expect(firstCutPath).not.toBeNull();
    expect(secondCutPath).not.toBeNull();
    expect(secondCutPath?.getAttribute('stroke')).toBe('#39ff14');
    expect(secondCutPath?.getAttribute('stroke-width')).toBe('1.8');

    await act(async () => {
      firstCutRow?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(firstCutPath?.getAttribute('data-highlight')).toBe('hover');
    expect(
      container.querySelector(
        'svg[aria-label="G-code path preview"] circle[data-preview-path-point-highlight="hover"][data-line="2"]'
      )
    ).not.toBeNull();

    await act(async () => {
      firstCutRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(firstCutRow?.getAttribute('aria-pressed')).toBe('true');
    expect(
      container.querySelector(
        'svg[aria-label="G-code path preview"] circle[data-preview-path-point-highlight="selected"][data-line="2"]'
      )
    ).not.toBeNull();
    expect(firstCutPath?.getAttribute('data-highlight')).toBe('selected');

    await act(async () => {
      secondCutRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });

    expect(firstCutRow?.getAttribute('aria-pressed')).toBe('true');
    expect(secondCutRow?.getAttribute('aria-pressed')).toBe('true');
    expect(secondCutPath?.getAttribute('data-highlight')).toBe('selected');

    await act(async () => {
      firstCutPin?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(firstCutPin?.getAttribute('aria-pressed')).toBe('true');
    expect(
      container.querySelector(
        'svg[aria-label="G-code path preview"] circle[data-preview-path-point-highlight="pinned"][data-line="2"]'
      )
    ).not.toBeNull();
    expect(firstCutPath?.getAttribute('data-pinned')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(firstCutRow?.getAttribute('aria-pressed')).toBe('false');
    expect(secondCutRow?.getAttribute('aria-pressed')).toBe('false');
    expect(firstCutPath?.getAttribute('data-pinned')).toBe('true');

    const clearPinsButton = container.querySelector(
      'button[aria-label="Clear pinned line highlights"]'
    ) as HTMLButtonElement | null;
    expect(clearPinsButton).not.toBeNull();

    await act(async () => {
      clearPinsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(firstCutPin?.getAttribute('aria-pressed')).toBe('false');
    expect(firstCutPath?.getAttribute('data-pinned')).toBeNull();

    const footerRow = container.querySelector('[data-editor-line="4"]') as HTMLButtonElement | null;
    expect(footerRow).not.toBeNull();

    await act(async () => {
      firstCutRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    await act(async () => {
      footerRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });

    expect(firstCutRow?.getAttribute('aria-pressed')).toBe('true');
    expect(secondCutRow?.getAttribute('aria-pressed')).toBe('true');
    expect(footerRow?.getAttribute('aria-pressed')).toBe('true');

    const deleteSelectedButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Delete Selected')
    );
    expect(deleteSelectedButton).toBeDefined();

    await act(async () => {
      deleteSelectedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe('G90 G21');
    expect(container.textContent).toContain('Unsaved');
    expect(container.querySelector('svg[aria-label="G-code path preview"] path[data-line="2"]')).toBeNull();

    const rawManifest = window.localStorage.getItem('wire-edm-workbench:file:workbench.json');
    const manifest = JSON.parse(rawManifest || '{}');
    const projectPath = manifest.projects[0].path;
    const project = JSON.parse(
      window.localStorage.getItem(`wire-edm-workbench:file:${projectPath}`) || '{}'
    );

    expect(project.source.kind).toBe('external-gcode');
    expect('sourceRequiresCleanup' in project.editor).toBe(false);
    expect(project.editor.activeFilePath).toMatch(/^editor\/shop-output-\d{4}-\d{2}-\d{2}\.nc$/);

    const updatedProgramText = [
      '%',
      'G90 G21',
      'G0 X0 Y0',
      'G1 X20 Y5',
      'G2 X24 Y5 I2 J0',
      'M30',
      '%'
    ].join('\n');

    const normalizeButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Normalize Draft')
    );
    expect(normalizeButton).toBeDefined();

    await act(async () => {
      normalizeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toContain('%\nN10 G90 G21');
    expect(programEditor?.value).toContain('N20 M02');
    expect(container.textContent).toContain('Unsaved');

    await act(async () => {
      if (programEditor) setTextAreaValue(programEditor, updatedProgramText);
    });

    const saveButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save Program')
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(programEditor?.value).toBe(updatedProgramText);
    expect(container.textContent).toContain('3 path items');
    expect(container.textContent).toContain('1');
    expect(
      window.localStorage.getItem(`wire-edm-workbench:file:${project.editor.activeFilePath}`)
    ).toBe(updatedProgramText);
  });

  it('auto-dismisses compact status toasts while keeping top-bar notification history', async () => {
    vi.useFakeTimers();
    window.showDirectoryPicker = undefined;

    try {
      await renderApp(context);

      const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
        button.textContent?.includes('Open Editor')
      );

      await act(async () => {
        openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flushAsync();

      const fileInput = container.querySelector(
        'input[aria-label="G-code program file"]'
      ) as HTMLInputElement | null;
      Object.defineProperty(fileInput, 'files', {
        value: [new File(['G0 X0 Y0\nG1 X5 Y5\nM30'], 'toast-import.nc')],
        configurable: true
      });

      await act(async () => {
        fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flushAsync();

      const toastContainer = container.querySelector('[data-status-toast-container]');
      expect(toastContainer?.getAttribute('data-status-toast-placement')).toBe('top-center');

      const toast = container.querySelector('[data-status-toast="success"]') as HTMLButtonElement | null;
      expect(toast).not.toBeNull();
      expect(toast?.textContent).toContain('Program imported');
      expect(toast?.textContent).toContain('toast-import.nc');

      Object.defineProperty(fileInput, 'files', {
        value: [new File(['G0 X1 Y1\nM30'], 'toast-import-2.nc')],
        configurable: true
      });

      await act(async () => {
        fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flushAsync();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4500);
      });
      await flushAsync();

      expect(container.querySelector('[data-status-toast="success"]')).toBeNull();

      const notificationsButton = container.querySelector(
        'button[aria-label="Open notifications"]'
      ) as HTMLButtonElement | null;
      expect(notificationsButton).not.toBeNull();

      await act(async () => {
        notificationsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const historyItems = [...container.querySelectorAll('[data-status-notification-item]')];
      expect(historyItems[0]?.textContent).toContain('toast-import-2.nc');
      expect(historyItems[1]?.textContent).toContain('toast-import.nc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exports the current editor draft as a normalized ISO file without mutating the draft', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();

    await renderApp(context, { downloadGeneratedProgram });

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const fileInput = container.querySelector(
      'input[aria-label="G-code program file"]'
    ) as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [
        new File(
          [['%', 'N100 G00 X0 Y0 ; rapid', 'N200 G01 X1 Y0 (cut)', 'N300 M30', '%'].join('\n')],
          'messy.nc'
        )
      ],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    const exportIsoButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Export ISO')
    );

    expect(programEditor?.value).toContain('G0 X0 Y0 ; rapid');
    expect(programEditor?.value).not.toContain('N10 G0 X0 Y0');
    expect(exportIsoButton).toBeDefined();

    await act(async () => {
      exportIsoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^normalized-\d{4}-\d{2}-\d{2}\.iso$/),
      text: ['%', 'N10 G0 X0 Y0', 'N20 G1 X1 Y0', 'N30 M30', 'N40 M02', ''].join('\r\n')
    });
    expect(programEditor?.value).toContain('G0 X0 Y0 ; rapid');
    expect(programEditor?.value).not.toContain('N10 G0 X0 Y0');
  });

  it('imports an external G-code program by dropping it into the editor', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const dropZone = container.querySelector('[data-editor-drop-zone="true"]') as HTMLElement | null;
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        files: [new File(['G0 X0 Y0\nG1 X9 Y3\nM30'], 'dropped.nc')]
      }
    });

    expect(dropZone).not.toBeNull();

    await act(async () => {
      dropZone?.dispatchEvent(dropEvent);
    });
    await flushAsync();

    expect(container.textContent).toContain('editor/dropped-');
    expect(container.textContent).toContain('G1 X9 Y3');
    expect(container.textContent).toContain('2 path items');
  });

  it('shows editor parse warning details instead of only warning counts', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const fileInput = container.querySelector(
      'input[aria-label="G-code program file"]'
    ) as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([['G90', 'BAD X1', 'M30'].join('\n')], 'warnings.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('Warnings');
    expect(container.textContent).toContain('Line 2');
    expect(container.textContent).toContain('Unknown G-code command: BAD X1');
  });
});
