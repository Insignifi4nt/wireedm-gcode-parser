import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class FakeFileHandle {
  constructor(
    readonly name: string,
    private readonly getContents: () => string,
    private readonly setContents: (contents: string) => void
  ) {}

  async getFile() {
    return new File([this.getContents()], this.name);
  }

  async createWritable() {
    return {
      write: async (contents: string) => this.setContents(String(contents)),
      close: async () => undefined
    };
  }
}

class FakeDirectoryHandle {
  readonly kind = 'directory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(
    readonly name: string,
    private readonly prefix = '',
    private readonly root?: FakeDirectoryHandle
  ) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}) {
    const root = this.root ?? this;
    const path = this.prefix ? `${this.prefix}/${name}` : name;

    if (!root.directories.has(path)) {
      if (!options.create) throw new DOMException('Not found', 'NotFoundError');
      root.directories.add(path);
    }

    return new FakeDirectoryHandle(name, path, root);
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}) {
    const root = this.root ?? this;
    const path = this.prefix ? `${this.prefix}/${name}` : name;

    if (!root.files.has(path)) {
      if (!options.create) throw new DOMException('Not found', 'NotFoundError');
      root.files.set(path, '');
    }

    return new FakeFileHandle(
      name,
      () => root.files.get(path) || '',
      (contents) => root.files.set(path, contents)
    );
  }
}

describe('App workbench connection', () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousPicker: Window['showDirectoryPicker'];

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    previousPicker = window.showDirectoryPicker;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.showDirectoryPicker = previousPicker;
    window.localStorage.clear();
  });

  it('starts with a browser cache workbench when folder access is unavailable', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const text = container.textContent || '';

    expect(text).toContain('Browser cache');
    expect(text).toContain('Import DXF');
    expect(text).toContain('Folder picker unavailable');
    expect(text).not.toContain('Connect the workbench folder first');
    expect(text).not.toContain('The next real feature');
  });

  it('renders real cache and import actions without fake dashboard rows or dead mode tabs', async () => {
    window.showDirectoryPicker = vi.fn();

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const buttons = [...container.querySelectorAll('button')];
    const text = container.textContent || '';

    expect(buttons.some((button) => button.textContent?.includes('Import DXF'))).toBe(true);
    expect(buttons.some((button) => button.textContent?.includes('Use Workbench Folder'))).toBe(true);
    expect(text).toContain('Browser cache');
    expect(text).not.toContain('flange-slot');
    expect(text).not.toContain('repair-job');
    expect(text).not.toContain('Verify');
    expect(text).not.toContain('Export');
  });

  it('collapses the app storage rail to give the editor more working width', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('opens the editor and imports external G-code files through the active cache workbench', async () => {
    window.showDirectoryPicker = undefined;
    const programText = ['%', 'G90 G21', 'G0 X0 Y0', 'G1 X12 Y4', 'M30', '%'].join('\n');

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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
    expect(statsSection?.open).toBe(false);
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
    expect(project.editor.sourceRequiresCleanup).toBe(true);
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

  it('shows dismissible status toasts for editor imports like the old status system', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    const toast = container.querySelector('[data-status-toast="success"]') as HTMLButtonElement | null;
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain('Program imported');
    expect(toast?.textContent).toContain('toast-import.nc');

    await act(async () => {
      toast?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-status-toast="success"]')).toBeNull();
  });

  it('exports the current editor draft as a normalized ISO file without mutating the draft', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();

    await act(async () => {
      root.render(<App services={{ downloadGeneratedProgram }} />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('adds measurement points, inserts them into the editor draft, and exports them', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();

    await act(async () => {
      root.render(<App services={{ downloadGeneratedProgram }} />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('adds measurement points from preview clicks and renders them on the preview', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    const touch = { clientX: 70, clientY: 80, identifier: 1, target: preview as SVGSVGElement };

    await act(async () => {
      dispatchTouchEvent(preview, 'touchstart', [touch], [touch]);
      dispatchTouchEvent(preview, 'touchend', [], [touch]);
    });

    expect(container.querySelector('[data-measurement-point-row="1"]')?.textContent).toContain(
      '5.000'
    );
    expect(container.querySelector('[data-measurement-point="1"]')).not.toBeNull();
  });

  it('pans the preview on touch drag without adding a measurement point', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('clears temporary drawer line selection from the selected counter', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('imports an external G-code program by dropping it into the editor', async () => {
    window.showDirectoryPicker = undefined;

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('imports a DXF through the browser cache workbench and opens the generated program in the editor', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();
    const dxfText = simpleLineDxf();

    await act(async () => {
      root.render(<App services={{ downloadGeneratedProgram }} />);
    });
    await flushAsync();

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

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

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

  it('clicking connect initializes the selected workbench folder and displays real manifest state', async () => {
    const directory = new FakeDirectoryHandle('wire-jobs');
    window.showDirectoryPicker = vi.fn(async () => directory as unknown as FileSystemDirectoryHandle);

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const connectButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Use Workbench Folder')
    );
    expect(connectButton).not.toBeNull();

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(window.showDirectoryPicker).toHaveBeenCalledWith({
      id: 'wire-edm-workbench',
      mode: 'readwrite'
    });
    expect([...directory.directories].sort()).toEqual([
      'editor',
      'exports',
      'generated',
      'imports',
      'machines',
      'projects',
      'templates'
    ]);
    expect(directory.files.has('workbench.json')).toBe(true);
    expect(directory.files.get('templates/header.gcode')).toContain('G90 G21 G17 G40');
    expect(directory.files.get('templates/footer.gcode')).toContain('M30');
    expect(container.textContent).toContain('Directory workbench active');
    expect(container.textContent).toContain('wire-jobs');
  });
});

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setTextAreaValue(element: HTMLTextAreaElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLSelectElement.prototype,
    'value'
  )?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function setInputValue(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  valueSetter?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function parseSvgViewBox(value: string) {
  const [minX, minY, width, height] = value.split(/\s+/).map(Number);
  return { minX, minY, width, height };
}

function dispatchTouchEvent(
  element: Element | null,
  type: string,
  touches: Array<Partial<Touch>>,
  changedTouches: Array<Partial<Touch>>
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  element?.dispatchEvent(event);
}

function simpleLineDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LINE',
    '10',
    '0',
    '20',
    '0',
    '11',
    '10',
    '21',
    '0',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}
