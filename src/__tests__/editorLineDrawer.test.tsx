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

describe('Editor line drawer operations', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('moves and deletes body groups from the editor draft', async () => {
    window.showDirectoryPicker = undefined;
    const groupedProgramText = [
      'G90 G21',
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G0 X20 Y0',
      'G1 X30 Y0',
      'M30'
    ].join('\n');

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const fileInput = container.querySelector('input[aria-label="G-code program file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, 'files', {
      value: [new File([groupedProgramText], 'grouped.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    const moveDownButton = container.querySelector(
      'button[aria-label="Move group contour-1 down"]'
    ) as HTMLButtonElement | null;

    expect(programEditor?.value).toBe(groupedProgramText);
    expect(moveDownButton).not.toBeNull();

    await act(async () => {
      moveDownButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(
      ['G90 G21', 'G0 X0 Y0', 'G0 X20 Y0', 'G1 X10 Y0', 'G1 X30 Y0', 'M30'].join(
        '\n'
      )
    );
    expect(container.textContent).toContain('Unsaved');

    const deleteGroupButton = container.querySelector(
      'button[aria-label="Delete group contour-1"]'
    ) as HTMLButtonElement | null;
    expect(deleteGroupButton).not.toBeNull();

    await act(async () => {
      deleteGroupButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(['G90 G21', 'G0 X0 Y0', 'G0 X20 Y0', 'M30'].join('\n'));
    expect(container.querySelector('[data-editor-group="contour-1"]')).toBeNull();

    const undoButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Undo')
    );
    const redoButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Redo')
    );
    expect(undoButton).toBeDefined();
    expect(redoButton).toBeDefined();

    await act(async () => {
      undoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(
      ['G90 G21', 'G0 X0 Y0', 'G0 X20 Y0', 'G1 X10 Y0', 'G1 X30 Y0', 'M30'].join(
        '\n'
      )
    );

    await act(async () => {
      undoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(groupedProgramText);

    await act(async () => {
      redoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(
      ['G90 G21', 'G0 X0 Y0', 'G0 X20 Y0', 'G1 X10 Y0', 'G1 X30 Y0', 'M30'].join(
        '\n'
      )
    );
  });

  it('asks before deleting body groups with more than three lines', async () => {
    window.showDirectoryPicker = undefined;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const programText = [
      'G90 G21',
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G1 X10 Y10',
      'G1 X0 Y10',
      'G1 X0 Y0',
      'M30'
    ].join('\n');

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
      value: [new File([programText], 'confirmed-group-delete.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    const deleteGroupButton = container.querySelector(
      'button[aria-label="Delete group contour-1"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      deleteGroupButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete folder 'contour-1' with 4 lines? Use Ctrl+Z to undo."
    );
    expect(programEditor?.value).toBe(programText);

    confirmSpy.mockReturnValue(true);

    await act(async () => {
      deleteGroupButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(['G90 G21', 'G0 X0 Y0', 'M30'].join('\n'));
    confirmSpy.mockRestore();
  });

  it('moves selected drawer lines up and down from the selection toolbar', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['A', 'B', 'C', 'D', 'E'].join('\n');

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
      value: [new File([programText], 'line-move.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const rowB = container.querySelector('[data-editor-line="2"]') as HTMLButtonElement | null;
    const rowC = container.querySelector('[data-editor-line="3"]') as HTMLButtonElement | null;
    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;

    await act(async () => {
      rowB?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      rowC?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });

    const moveSelectedDownButton = container.querySelector(
      'button[aria-label="Move selected lines down"]'
    ) as HTMLButtonElement | null;
    const moveSelectedUpButton = container.querySelector(
      'button[aria-label="Move selected lines up"]'
    ) as HTMLButtonElement | null;

    expect(moveSelectedDownButton).not.toBeNull();
    expect(moveSelectedUpButton).not.toBeNull();

    await act(async () => {
      moveSelectedDownButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(['A', 'D', 'B', 'C', 'E'].join('\n'));
    expect(container.querySelector('[data-editor-line="3"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(container.querySelector('[data-editor-line="4"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );

    await act(async () => {
      moveSelectedUpButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(programText);
    expect(container.querySelector('[data-editor-line="2"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(container.querySelector('[data-editor-line="3"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
  });

  it('deletes selected drawer lines with the old Delete keyboard shortcut', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'M30'].join('\n');

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
      value: [new File([programText], 'keyboard-delete.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const cutRow = container.querySelector('[data-editor-line="3"]') as HTMLButtonElement | null;
    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;

    await act(async () => {
      cutRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    });

    expect(programEditor?.value).toBe(['G90 G21', 'G0 X0 Y0', 'M30'].join('\n'));
    expect(container.querySelector('[data-editor-line="3"]')?.getAttribute('aria-pressed')).toBe(
      'false'
    );
  });

  it('asks before deleting more than three selected drawer lines like the old editor', async () => {
    window.showDirectoryPicker = undefined;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const programText = [
      'G90 G21',
      'G0 X0 Y0',
      'G1 X10 Y0',
      'G1 X10 Y10',
      'G1 X0 Y10',
      'G1 X0 Y0',
      'M30'
    ].join('\n');

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
      value: [new File([programText], 'confirmed-delete.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const selectedRows = [2, 3, 4, 5].map(
      (lineNumber) =>
        container.querySelector(`[data-editor-line="${lineNumber}"]`) as HTMLButtonElement | null
    );
    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;

    await act(async () => {
      selectedRows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    for (const row of selectedRows.slice(1)) {
      await act(async () => {
        row?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      });
    }

    expect(container.textContent).toContain('4 selected');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    });

    expect(confirmSpy).toHaveBeenCalledWith('Delete 4 selected lines? Use Ctrl+Z to undo if needed.');
    expect(programEditor?.value).toBe(programText);

    confirmSpy.mockReturnValue(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Delete' }));
    });

    expect(programEditor?.value).toBe(['G90 G21', 'G1 X0 Y0', 'M30'].join('\n'));
    confirmSpy.mockRestore();
  });

  it('restores the old persisted Select/Edit drawer mode preference', async () => {
    window.showDirectoryPicker = undefined;
    window.localStorage.setItem('gcodeDrawerMode', 'edit');
    const programText = ['G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'M30'].join('\n');

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
      value: [new File([programText], 'mode-memory.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const selectModeButton = container.querySelector(
      'button[aria-label="Select line mode"]'
    ) as HTMLButtonElement | null;
    const editModeButton = container.querySelector(
      'button[aria-label="Edit line mode"]'
    ) as HTMLButtonElement | null;

    expect(editModeButton?.getAttribute('aria-pressed')).toBe('true');
    expect(selectModeButton?.getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      selectModeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.localStorage.getItem('gcodeDrawerMode')).toBe('select');

    await act(async () => {
      editModeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.localStorage.getItem('gcodeDrawerMode')).toBe('edit');
  });

  it('edits individual drawer lines in Edit mode and supports undo', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'M30'].join('\n');

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
      value: [new File([programText], 'line-edit.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const editModeButton = container.querySelector(
      'button[aria-label="Edit line mode"]'
    ) as HTMLButtonElement | null;
    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;

    expect(editModeButton).not.toBeNull();

    await act(async () => {
      editModeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const lineEditor = container.querySelector(
      'input[aria-label="Edit line 3"]'
    ) as HTMLInputElement | null;

    expect(lineEditor).not.toBeNull();

    await act(async () => {
      lineEditor?.focus();
      if (lineEditor) setInputValue(lineEditor, 'G1 X12 Y0');
      lineEditor?.blur();
    });

    expect(programEditor?.value).toBe(['G90 G21', 'G0 X0 Y0', 'G1 X12 Y0', 'M30'].join('\n'));
    expect(container.textContent).toContain('Unsaved');

    const undoButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Undo')
    );

    await act(async () => {
      undoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(programText);
  });

  it('keeps edit-mode line inputs in sync with draft text changes', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'M30'].join('\n');
    const updatedProgramText = ['G90 G21', 'G0 X0 Y0', 'G1 X20 Y0', 'M30'].join('\n');

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
      value: [new File([programText], 'line-edit-sync.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const editModeButton = container.querySelector(
      'button[aria-label="Edit line mode"]'
    ) as HTMLButtonElement | null;
    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;

    await act(async () => {
      editModeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const lineEditor = container.querySelector(
      'input[aria-label="Edit line 3"]'
    ) as HTMLInputElement | null;
    expect(lineEditor?.value).toBe('G1 X10 Y0');

    await act(async () => {
      if (programEditor) setTextAreaValue(programEditor, updatedProgramText);
    });

    const syncedLineEditor = container.querySelector(
      'input[aria-label="Edit line 3"]'
    ) as HTMLInputElement | null;
    expect(syncedLineEditor?.value).toBe('G1 X20 Y0');

    await act(async () => {
      syncedLineEditor?.blur();
    });

    expect(programEditor?.value).toBe(updatedProgramText);
  });

  it('collapses and restores program line sections from the drawer headers', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'M30', '%'].join('\n');

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
      value: [new File([programText], 'section-folding.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const headerGroup = container.querySelector('[data-editor-group="header"]');
    const headerToggle = container.querySelector(
      'button[aria-label="Collapse group header"]'
    ) as HTMLButtonElement | null;

    expect(headerGroup?.getAttribute('aria-expanded')).toBe('true');
    expect(headerToggle).not.toBeNull();
    expect(container.querySelector('[data-editor-line="1"]')).not.toBeNull();

    await act(async () => {
      headerToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(headerGroup?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-editor-line="1"]')).toBeNull();
    expect(window.localStorage.getItem('gcodeDrawer.folder.header')).toBe('false');

    const headerExpandToggle = container.querySelector(
      'button[aria-label="Expand group header"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      headerExpandToggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(headerGroup?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-editor-line="1"]')).not.toBeNull();
    expect(window.localStorage.getItem('gcodeDrawer.folder.header')).toBe('true');
  });

  it('closes and reopens the program line drawer while preserving the editor text', async () => {
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
      value: [new File(['G90\nG0 X0 Y0\nG1 X10 Y0\nM30'], 'drawer-toggle.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-lines-panel]')).not.toBeNull();

    const closeDrawerButton = container.querySelector(
      'button[aria-label="Close G-code drawer"]'
    ) as HTMLButtonElement | null;
    expect(closeDrawerButton).not.toBeNull();

    await act(async () => {
      closeDrawerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-editor-lines-panel]')).toBeNull();
    expect(container.textContent).toContain('G-code drawer closed');

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(programEditor?.value).toContain('G1 X10 Y0');

    const openDrawerButton = container.querySelector(
      'button[aria-label="Open G-code drawer"]'
    ) as HTMLButtonElement | null;
    expect(openDrawerButton).not.toBeNull();

    await act(async () => {
      openDrawerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-editor-lines-panel]')).not.toBeNull();
    expect(container.querySelector('[data-editor-line="3"]')?.textContent).toContain('G1 X10 Y0');
  });

  it('sets a selected contour line as the new program start', async () => {
    window.showDirectoryPicker = undefined;
    const closedContourText = [
      'G92X0Y0',
      'G60',
      'G41D0',
      'G0X0Y0',
      'G1X10Y0',
      'G1X10Y10',
      'G1X0Y10',
      'G1X0Y0',
      'M02'
    ].join('\n');

    await renderApp(context);

    const openEditorButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open Editor')
    );

    await act(async () => {
      openEditorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const fileInput = container.querySelector('input[aria-label="G-code program file"]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    Object.defineProperty(fileInput, 'files', {
      value: [new File([closedContourText], 'closed.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const selectedStartRow = container.querySelector(
      '[data-editor-line="6"]'
    ) as HTMLButtonElement | null;
    const startHereButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Start Here')
    );
    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;

    expect(selectedStartRow).not.toBeNull();
    expect(startHereButton).toBeDefined();

    await act(async () => {
      selectedStartRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    await act(async () => {
      startHereButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const rotatedLines = programEditor?.value.split('\n') ?? [];
    expect(rotatedLines.slice(0, 3)).toEqual(['G92X0Y0', 'G60', 'G41D0']);
    expect(rotatedLines[3]).toBe('G1X10Y10');
    expect(container.querySelector('[data-editor-line="4"]')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(container.textContent).toContain('Unsaved');

    const undoButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Undo')
    );

    await act(async () => {
      undoButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(programEditor?.value).toBe(
      ['G92X0Y0', 'G60', 'G41D0', 'G0X0Y0', 'G1X10Y0', 'G1X10Y10', 'G1X0Y10', 'G1X0Y0'].join(
        '\n'
      )
    );
  });

  it('shows the old Start Here warning when the selected line is not a body motion line', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['G90 G21', 'G0 X0 Y0', 'G1 X10 Y0', 'M30'].join('\n');

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
      value: [new File([programText], 'invalid-start.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const headerRow = container.querySelector('[data-editor-line="1"]') as HTMLButtonElement | null;

    await act(async () => {
      headerRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const startHereButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Start Here')
    );

    await act(async () => {
      startHereButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain(
      'Invalid selection: choose a motion line (G0/G1/G2/G3) within the body.'
    );
  });

  it('clears temporary drawer line selection from the selected counter', async () => {
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
      value: [new File(['G0 X0 Y0\nG1 X10 Y0\nG1 X10 Y10\nM30'], 'selection.nc')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const firstCutRow = container.querySelector('[data-editor-line="2"]') as HTMLButtonElement | null;
    const secondCutRow = container.querySelector('[data-editor-line="3"]') as HTMLButtonElement | null;

    await act(async () => {
      firstCutRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      secondCutRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });

    const clearSelectionButton = container.querySelector(
      'button[aria-label="Clear 2 selected lines"]'
    ) as HTMLButtonElement | null;

    expect(clearSelectionButton).not.toBeNull();
    expect(clearSelectionButton?.textContent).toContain('2 selected');

    await act(async () => {
      clearSelectionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(firstCutRow?.getAttribute('aria-pressed')).toBe('false');
    expect(secondCutRow?.getAttribute('aria-pressed')).toBe('false');
  });
});
