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

  it('edits imported DXF path direction through path controls instead of line text surgery', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();

    await renderApp(context, { downloadGeneratedProgram });

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'rectangle.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const reverseButton = container.querySelector(
      'button[aria-label="Reverse path operation"]'
    ) as HTMLButtonElement | null;
    expect(reverseButton).not.toBeNull();

    await act(async () => {
      reverseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(programEditor?.value).toContain(
      ['G0 X0.000 Y0.000', 'G1 X0.000 Y5.000', 'G1 X10.000 Y5.000'].join('\n')
    );
    expect(programEditor?.value.split(/\r?\n/).filter(Boolean).slice(-3)).toEqual(['G40', 'M30', '%']);
    expect(container.textContent).toContain('Unsaved');

    const saveButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save Program')
    );

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const manifest = JSON.parse(
      window.localStorage.getItem('wire-edm-workbench:file:workbench.json') || '{}'
    );
    const savedProject = JSON.parse(
      window.localStorage.getItem(`wire-edm-workbench:file:${manifest.projects[0].path}`) || '{}'
    );
    const bodyFile = window.localStorage.getItem(
      `wire-edm-workbench:file:generated/${savedProject.id}.body.gcode`
    );

    expect(savedProject.pathPlanning.document.plan.operations[0].direction).toBe('reverse');
    expect(savedProject.generated.body).toContain('G1 X0.000 Y5.000');
    expect(bodyFile).toContain('G1 X0.000 Y5.000');

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const downloadButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Download Program')
    );

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^rectangle-\d{4}-\d{2}-\d{2}\.iso$/),
      text: expect.stringContaining('G1 X0.000 Y5.000')
    });

    const openLatestButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open in Editor')
    );

    await act(async () => {
      openLatestButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const reopenedReverseButton = container.querySelector(
      'button[aria-label="Reverse path operation"]'
    ) as HTMLButtonElement | null;
    expect(reopenedReverseButton).not.toBeNull();

    await act(async () => {
      reopenedReverseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const reopenedProgramEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(reopenedProgramEditor?.value).toContain(
      ['G0 X0.000 Y0.000', 'G1 X10.000 Y0.000', 'G1 X10.000 Y5.000'].join('\n')
    );
  });

  it('disables structured DXF path controls after manual program text edits', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'manual-path-edit.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('button[aria-label="Reverse path operation"]')).not.toBeNull();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(programEditor).not.toBeNull();

    await act(async () => {
      if (programEditor) setTextAreaValue(programEditor, `${programEditor.value}\n(MANUAL EDIT)`);
    });
    await flushAsync();

    expect(container.querySelector('button[aria-label="Reverse path operation"]')).toBeNull();

    const saveButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Save Program')
    );

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('Manifest');
    expect(container.textContent).not.toContain('Download Program');
  });

  it('creates and slides path-constrained measurement points from contour magnetize', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'magnetize-path.dxf')],
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
          ...worldClientPoint(preview!, { x: 5, y: 2 })
        })
      );
    });
    expect(container.querySelector('[data-measurement-point-row="1"]')?.textContent).toContain(
      '2.000'
    );

    const perpendicularButton = container.querySelector(
      'button[aria-label="Magnetize latest point perpendicular"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      perpendicularButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });

    const secondPointRow = container.querySelector('[data-measurement-point-row="2"]');
    expect(secondPointRow?.textContent).toContain('5.000');
    expect(container.querySelector('[data-measurement-point-mode="2"]')?.textContent).toBe('Perp');

    const secondPointHandle = container.querySelector(
      '[data-measurement-point-handle="2"]'
    ) as SVGCircleElement | null;

    await act(async () => {
      secondPointHandle?.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 8, y: 5 })
        })
      );
      preview?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(container.querySelector('[data-measurement-point-row="2"]')?.textContent).toContain(
      '8.000'
    );
    expect(container.querySelector('[data-measurement-point-row="2"]')?.textContent).toContain(
      '5.000'
    );
  });

  it('labels tangent fallback honestly when tangent construction is impossible', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'tangent-fallback.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const tangentButton = container.querySelector(
      'button[aria-label="Magnetize latest point tangent"]'
    ) as HTMLButtonElement | null;
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

    await act(async () => {
      tangentButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });

    expect(container.querySelector('[data-measurement-point-mode="1"]')?.textContent).toBe('Snap');
  });
});

function rectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'LWPOLYLINE',
    '90',
    '4',
    '70',
    '1',
    '10',
    '0',
    '20',
    '0',
    '10',
    '10',
    '20',
    '0',
    '10',
    '10',
    '20',
    '5',
    '10',
    '0',
    '20',
    '5',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function worldClientPoint(preview: SVGSVGElement, point: { x: number; y: number }) {
  const viewBox = parseSvgViewBox(preview.getAttribute('viewBox') || '0 0 1 1');
  const rect = preview.getBoundingClientRect();
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  const renderedWidth = viewBox.width * scale;
  const renderedHeight = viewBox.height * scale;
  const offsetX = (rect.width - renderedWidth) / 2;
  const offsetY = (rect.height - renderedHeight) / 2;
  const flipY = 5;

  return {
    clientX: rect.left + offsetX + (point.x - viewBox.minX) * scale,
    clientY: rect.top + offsetY + (flipY - point.y - viewBox.minY) * scale
  };
}
