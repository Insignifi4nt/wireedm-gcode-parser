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

describe('Editor measurement points', () => {
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

  it('adds measurement points, inserts them into the editor draft, and exports them', async () => {
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

    const fileInput = container.querySelector('input[aria-label="G-code program file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['G90\nG0 X0 Y0\nM30'], 'points.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const xInput = container.querySelector('input[aria-label="Measurement point X"]') as HTMLInputElement | null;
    const yInput = container.querySelector('input[aria-label="Measurement point Y"]') as HTMLInputElement | null;
    const addPointButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Point')
    );

    expect(xInput).not.toBeNull();
    expect(yInput).not.toBeNull();
    expect(addPointButton).toBeDefined();

    await act(async () => {
      if (xInput) setInputValue(xInput, '12.5');
      if (yInput) setInputValue(yInput, '-3');
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      if (xInput) setInputValue(xInput, '1');
      if (yInput) setInputValue(yInput, '2');
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('P1');
    expect(container.textContent).toContain('12.500');
    expect(container.textContent).toContain('P2');

    const insertAfterRow = container.querySelector('[data-editor-line="2"]') as HTMLButtonElement | null;
    await act(async () => {
      insertAfterRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const insertPointsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Insert Points')
    );
    expect(insertPointsButton).toBeDefined();

    await act(async () => {
      insertPointsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(programEditor?.value).toContain('; inserted G0 P1\nG0 X12.500 Y-3.000');
    expect(programEditor?.value).toContain('; inserted G0 P2\nG0 X1.000 Y2.000');

    const exportCsvButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Export CSV')
    );
    const exportGCodeButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Export G-code')
    );
    const exportPointIsoButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Export Point ISO')
    );

    await act(async () => {
      exportCsvButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      exportGCodeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      exportPointIsoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^measurement-points-\d{4}-\d{2}-\d{2}\.csv$/),
      text: ['Point,X,Y', 'P1,12.500,-3.000', 'P2,1.000,2.000'].join('\n')
    });
    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^measurement-points-\d{4}-\d{2}-\d{2}\.gcode$/),
      text: expect.stringContaining('G0 X12.500 Y-3.000')
    });
    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^measurement-points-\d{4}-\d{2}-\d{2}\.iso$/),
      text: expect.stringContaining('N70 G1 X1.000 Y2.000')
    });
    expect(downloadGeneratedProgram).not.toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^measurement-points-\d{4}-\d{2}-\d{2}\.iso$/),
      text: expect.stringContaining('F1000')
    });
  });

  it('deletes individual measurement points and reindexes the remaining list', async () => {
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
      value: [new File(['G90\nG0 X0 Y0\nM30'], 'point-delete.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const xInput = container.querySelector('input[aria-label="Measurement point X"]') as HTMLInputElement | null;
    const yInput = container.querySelector('input[aria-label="Measurement point Y"]') as HTMLInputElement | null;
    const addPointButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Point')
    );

    await act(async () => {
      if (xInput) setInputValue(xInput, '12.5');
      if (yInput) setInputValue(yInput, '-3');
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      if (xInput) setInputValue(xInput, '1');
      if (yInput) setInputValue(yInput, '2');
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const firstPointRow = container.querySelector('[data-measurement-point-row="1"]');
    const secondPointRow = container.querySelector('[data-measurement-point-row="2"]');
    const deleteFirstPointButton = container.querySelector(
      'button[aria-label="Delete measurement point P1"]'
    ) as HTMLButtonElement | null;

    expect(firstPointRow).not.toBeNull();
    expect(secondPointRow).not.toBeNull();
    expect(firstPointRow?.textContent).toContain('12.500');
    expect(secondPointRow?.textContent).toContain('1.000');
    expect(deleteFirstPointButton).not.toBeNull();

    await act(async () => {
      deleteFirstPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const remainingPointRow = container.querySelector('[data-measurement-point-row="1"]');

    expect(container.querySelector('[data-measurement-point-row="2"]')).toBeNull();
    expect(remainingPointRow?.textContent).toContain('P1');
    expect(remainingPointRow?.textContent).toContain('1.000');
    expect(remainingPointRow?.textContent).toContain('2.000');
    expect(container.querySelector('[data-measurement-point="2"]')).toBeNull();
    expect(container.querySelector('[data-measurement-point-label="1"]')?.textContent).toBe('P1');
  });

  it('clears measurement points with the old Ctrl+C shortcut outside editor inputs', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const pointXInput = container.querySelector(
      'input[aria-label="Measurement point X"]'
    ) as HTMLInputElement | null;
    const pointYInput = container.querySelector(
      'input[aria-label="Measurement point Y"]'
    ) as HTMLInputElement | null;
    const addPointButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Point')
    );

    await act(async () => {
      if (pointXInput) setInputValue(pointXInput, '1.25');
      if (pointYInput) setInputValue(pointYInput, '2.5');
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-measurement-point-row="1"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          code: 'KeyC',
          ctrlKey: true,
          key: 'c'
        })
      );
    });

    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
  });

  it('keeps preview clicks in select mode until point placement is enabled', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'preview-click.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const preview = container.querySelector(
      'svg[aria-label="G-code path preview"]'
    ) as SVGSVGElement | null;
    expect(preview).not.toBeNull();
    Object.defineProperty(preview, 'getBoundingClientRect', {
      value: () => ({
        left: 10,
        top: 20,
        width: 120,
        height: 120,
        right: 130,
        bottom: 140,
        x: 10,
        y: 20,
        toJSON: () => ({})
      }),
      configurable: true
    });

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 70,
          clientY: 80
        })
      );
    });

    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();

    const pointModeButton = [...container.querySelectorAll('button')].find((button) =>
      button.getAttribute('aria-label') === 'Place measurement points on canvas'
    );
    await act(async () => {
      pointModeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 70,
          clientY: 80
        })
      );
    });

    expect(container.textContent).toContain('P1');
    expect(container.textContent).toContain('5.000');
    expect(container.querySelector('[data-measurement-point="1"]')).not.toBeNull();
    expect(container.querySelector('[data-path-marker="start"]')).not.toBeNull();
    expect(container.querySelector('[data-path-marker="end"]')).not.toBeNull();
    expect(container.textContent).toContain('START');
    expect(container.textContent).toContain('END');

    const insertPointsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Insert Points')
    );
    await act(async () => {
      insertPointsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(programEditor?.value).toContain('G0 X5.000 Y5.000');
  });

  it('adds measurement points from preview touch taps like the old mobile canvas', async () => {
    window.showDirectoryPicker = undefined;
    vi.useFakeTimers();

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
        value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'touch.nc')],
        configurable: true
      });

      await act(async () => {
        fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await flushAsync();

      const preview = container.querySelector(
        'svg[aria-label="G-code path preview"]'
      ) as SVGSVGElement | null;
      Object.defineProperty(preview, 'getBoundingClientRect', {
        value: () => ({
          left: 10,
          top: 20,
          width: 120,
          height: 120,
          right: 130,
          bottom: 140,
          x: 10,
          y: 20,
          toJSON: () => ({})
        }),
        configurable: true
      });

      const pointModeButton = [...container.querySelectorAll('button')].find((button) =>
        button.getAttribute('aria-label') === 'Place measurement points on canvas'
      );
      await act(async () => {
        pointModeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });

      const touch = { clientX: 70, clientY: 80, identifier: 1, target: preview as SVGSVGElement };

      await act(async () => {
        dispatchTouchEvent(preview, 'touchstart', [touch], [touch]);
        dispatchTouchEvent(preview, 'touchend', [], [touch]);
        await vi.advanceTimersByTimeAsync(500);
      });

      expect(container.querySelector('[data-measurement-point-row="1"]')?.textContent).toContain(
        '5.000'
      );
      expect(container.querySelector('[data-measurement-point="1"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
