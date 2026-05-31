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

describe('Editor preview controls and guide', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('pans the preview on touch drag without adding a measurement point', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'touch-pan.nc')],
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

    const initialViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    const startTouch = { clientX: 70, clientY: 80, identifier: 1, target: preview as SVGSVGElement };
    const movedTouch = { clientX: 95, clientY: 80, identifier: 1, target: preview as SVGSVGElement };

    await act(async () => {
      dispatchTouchEvent(preview, 'touchstart', [startTouch], [startTouch]);
      dispatchTouchEvent(preview, 'touchmove', [movedTouch], [movedTouch]);
      dispatchTouchEvent(preview, 'touchend', [], [movedTouch]);
    });

    const pannedViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(pannedViewBox.minX).not.toBe(initialViewBox.minX);
    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
  });

  it('zooms the preview on touch pinch without adding a measurement point', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'touch-pinch.nc')],
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

    const initialViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    const startTouches = [
      { clientX: 60, clientY: 80, identifier: 1, target: preview as SVGSVGElement },
      { clientX: 80, clientY: 80, identifier: 2, target: preview as SVGSVGElement }
    ];
    const movedTouches = [
      { clientX: 40, clientY: 80, identifier: 1, target: preview as SVGSVGElement },
      { clientX: 100, clientY: 80, identifier: 2, target: preview as SVGSVGElement }
    ];

    await act(async () => {
      dispatchTouchEvent(preview, 'touchstart', startTouches, startTouches);
      dispatchTouchEvent(preview, 'touchmove', movedTouches, movedTouches);
      dispatchTouchEvent(preview, 'touchend', [], movedTouches);
    });

    const zoomedViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(zoomedViewBox.width).toBeLessThan(initialViewBox.width);
    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
  });

  it('fits the preview to screen on touch double tap like the old mobile canvas', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'double-tap.nc')],
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

    const initialViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    const zoomInButton = container.querySelector(
      'button[aria-label="Zoom preview in"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      zoomInButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(parseSvgViewBox(preview?.getAttribute('viewBox') ?? '').width).toBeLessThan(
      initialViewBox.width
    );

    const touch = { clientX: 70, clientY: 80, identifier: 1, target: preview as SVGSVGElement };

    await act(async () => {
      dispatchTouchEvent(preview, 'touchstart', [touch], [touch]);
      dispatchTouchEvent(preview, 'touchend', [], [touch]);
      dispatchTouchEvent(preview, 'touchstart', [touch], [touch]);
      dispatchTouchEvent(preview, 'touchend', [], [touch]);
    });

    expect(parseSvgViewBox(preview?.getAttribute('viewBox') ?? '')).toEqual(initialViewBox);
  });

  it('shows live preview cursor coordinates like the old sidebar', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'cursor.nc')],
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

    expect(container.querySelector('[data-editor-cursor="x"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-editor-cursor="y"]')?.textContent).toBe('-');

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 70,
          clientY: 80
        })
      );
    });

    expect(container.querySelector('[data-editor-cursor="x"]')?.textContent).toBe('5.000');
    expect(container.querySelector('[data-editor-cursor="y"]')?.textContent).toBe('5.000');

    await act(async () => {
      preview?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });

    expect(container.querySelector('[data-editor-cursor="x"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-editor-cursor="y"]')?.textContent).toBe('-');
  });

  it('shows old sidebar-style path stats, bounds, and file name', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y0\nG2 X10 Y10 I0 J5\nM30'], 'stats.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-stat="total-moves"]')?.textContent).toBe('3');
    expect(container.querySelector('[data-editor-stat="rapid-moves"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-editor-stat="cutting-moves"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-editor-stat="arc-moves"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-editor-stat="bounds"]')?.textContent).toContain(
      'X0.000..10.000'
    );
    expect(container.querySelector('[data-editor-stat="bounds"]')?.textContent).toContain(
      'Y0.000..10.000'
    );
    expect(container.querySelector('[data-editor-stat="file"]')?.textContent).toContain('stats');
  });

  it('opens a centered bilingual editor manual and highlights real controls', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const guideButton = container.querySelector(
      'button[aria-label="Open usage guide"]'
    ) as HTMLButtonElement | null;
    expect(guideButton).not.toBeNull();

    await act(async () => {
      guideButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog).not.toBeNull();
    expect(container.querySelector('[data-editor-guide-overlay]')).not.toBeNull();
    expect(dialog?.textContent).toContain('Wire EDM Workbench Manual');
    expect(dialog?.textContent).toContain('Import Program');
    expect(dialog?.textContent).toContain('Path Operations');
    expect(dialog?.textContent).toContain('Close or reopen Program Lines');

    const romanianToggle = dialog?.querySelector(
      'button[data-editor-guide-language="ro"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      romanianToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.localStorage.getItem('wireedm.guideLanguage')).toBe('ro');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'Manual Wire EDM Workbench'
    );

    const englishToggle = container.querySelector(
      'button[data-editor-guide-language="en"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      englishToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const importHighlightButton = container.querySelector(
      'button[data-editor-guide-highlight="import-program"]'
    ) as HTMLButtonElement | null;
    expect(importHighlightButton).not.toBeNull();

    await act(async () => {
      importHighlightButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(
      container
        .querySelector('[data-guide-target="import-program"]')
        ?.getAttribute('data-guide-highlighted')
    ).toBe('true');
  });

  it('snaps preview cursor coordinates and clicked points to the grid when grid snap is enabled', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'snap.nc')],
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

    const snapToggle = container.querySelector(
      'button[aria-label="Toggle preview grid snap"]'
    ) as HTMLButtonElement | null;
    expect(snapToggle).not.toBeNull();
    expect(container.querySelector('[data-editor-grid-snap]')?.textContent).toBe('OFF');

    await act(async () => {
      snapToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(snapToggle?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-editor-grid-snap]')?.textContent).toBe('ON');

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 82,
          clientY: 68
        })
      );
    });

    expect(container.querySelector('[data-editor-cursor="x"]')?.textContent).toBe('5.000');
    expect(container.querySelector('[data-editor-cursor="y"]')?.textContent).toBe('5.000');

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 82,
          clientY: 68
        })
      );
    });

    expect(container.querySelector('[data-measurement-point-row="1"]')?.textContent).toContain(
      '5.000'
    );
  });

  it('supports preview zoom controls and fit reset like the old toolbar', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'zoom.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const preview = container.querySelector(
      'svg[aria-label="G-code path preview"]'
    ) as SVGSVGElement | null;
    const zoomInButton = container.querySelector(
      'button[aria-label="Zoom preview in"]'
    ) as HTMLButtonElement | null;
    const zoomOutButton = container.querySelector(
      'button[aria-label="Zoom preview out"]'
    ) as HTMLButtonElement | null;
    const fitButton = container.querySelector(
      'button[aria-label="Fit preview to screen"]'
    ) as HTMLButtonElement | null;

    expect(preview).not.toBeNull();
    expect(zoomInButton).not.toBeNull();
    expect(zoomOutButton).not.toBeNull();
    expect(fitButton).not.toBeNull();

    const initialViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(container.textContent).toContain('100%');

    await act(async () => {
      zoomInButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const zoomedInViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(zoomedInViewBox.width).toBeLessThan(initialViewBox.width);
    expect(zoomedInViewBox.height).toBeLessThan(initialViewBox.height);
    expect(container.textContent).toContain('125%');

    await act(async () => {
      zoomOutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('100%');

    await act(async () => {
      zoomInButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      fitButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const fitViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(fitViewBox).toEqual(initialViewBox);
    expect(container.textContent).toContain('100%');
  });

  it('supports old canvas wheel zoom and shift-drag preview panning', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'pan-zoom.nc')],
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
        left: 20,
        top: 30,
        width: 120,
        height: 120,
        right: 140,
        bottom: 150,
        x: 20,
        y: 30,
        toJSON: () => ({})
      }),
      configurable: true
    });

    const initialViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');

    await act(async () => {
      preview?.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -120,
          clientX: 80,
          clientY: 90
        })
      );
    });

    const wheelZoomedViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(wheelZoomedViewBox.width).toBeLessThan(initialViewBox.width);
    expect(container.textContent).toContain('125%');

    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          buttons: 1,
          shiftKey: true,
          clientX: 80,
          clientY: 90
        })
      );
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          buttons: 1,
          shiftKey: true,
          clientX: 100,
          clientY: 110
        })
      );
      preview?.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 0,
          shiftKey: true,
          clientX: 100,
          clientY: 110
        })
      );
    });

    const pannedViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(pannedViewBox.width).toBe(wheelZoomedViewBox.width);
    expect(pannedViewBox.height).toBe(wheelZoomedViewBox.height);
    expect(pannedViewBox.minX).not.toBe(wheelZoomedViewBox.minX);
    expect(pannedViewBox.minY).not.toBe(wheelZoomedViewBox.minY);
  });

  it('prevents the browser context menu on the preview like the old canvas handler', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'context-menu.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const preview = container.querySelector(
      'svg[aria-label="G-code path preview"]'
    ) as SVGSVGElement | null;
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    });

    preview?.dispatchEvent(contextMenuEvent);

    expect(contextMenuEvent.defaultPrevented).toBe(true);
  });

  it('renders the old canvas grid context and axes behind the preview path', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'grid.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const preview = container.querySelector('svg[aria-label="G-code path preview"]');

    expect(preview?.querySelector('[data-preview-grid="minor"]')).not.toBeNull();
    expect(preview?.querySelector('[data-preview-axis="x"]')).not.toBeNull();
    expect(preview?.querySelector('[data-preview-axis="y"]')).not.toBeNull();
    expect(preview?.querySelector('[data-preview-grid-label="x"]')).not.toBeNull();
    expect(preview?.querySelector('[data-preview-grid-label="y"]')).not.toBeNull();
    expect(
      Number(preview?.querySelector('[data-preview-grid-label="x"]')?.getAttribute('font-size'))
    ).toBeLessThan(0.45);
  });

  it('supports old preview keyboard shortcuts without stealing input editing', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'shortcuts.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const preview = container.querySelector(
      'svg[aria-label="G-code path preview"]'
    ) as SVGSVGElement | null;
    const initialViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');

    expect(preview?.querySelector('[data-preview-grid="minor"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyG', key: 'g' }));
    });
    expect(preview?.querySelector('[data-preview-grid="minor"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyG', key: 'g' }));
    });
    expect(preview?.querySelector('[data-preview-grid="minor"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, code: 'Equal', ctrlKey: true, key: '=' })
      );
    });

    const zoomedViewBox = parseSvgViewBox(preview?.getAttribute('viewBox') ?? '');
    expect(zoomedViewBox.width).toBeLessThan(initialViewBox.width);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyF', key: 'f' }));
    });

    expect(parseSvgViewBox(preview?.getAttribute('viewBox') ?? '')).toEqual(initialViewBox);

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    programEditor?.focus();

    await act(async () => {
      programEditor?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, code: 'KeyG', key: 'g' })
      );
    });

    expect(preview?.querySelector('[data-preview-grid="minor"]')).not.toBeNull();
  });

  it('does not run preview keyboard shortcuts while the editor guide is open', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y10\nM30'], 'guide-shortcuts.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const guideButton = container.querySelector(
      'button[aria-label="Open usage guide"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      guideButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-editor-guide-overlay]')).not.toBeNull();
    expect(container.querySelector('[data-preview-grid="minor"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, code: 'KeyG', key: 'g' }));
    });

    expect(container.querySelector('[data-preview-grid="minor"]')).not.toBeNull();
  });
});
