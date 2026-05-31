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
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-row]')?.textContent).toContain(
      '0.000, 0.000 -> 10.000, 0.000'
    );
    expect(container.textContent).not.toContain('G1 X10.000 Y0.000');
    expect(container.textContent).toContain('2 path items');

    const rawManifest = window.localStorage.getItem('wire-edm-workbench:file:workbench.json');
    const manifest = JSON.parse(rawManifest || '{}');
    const projectPath = manifest.projects[0].path;
    const project = JSON.parse(
      window.localStorage.getItem(`wire-edm-workbench:file:${projectPath}`) || '{}'
    );

    expect(manifest.projects).toHaveLength(1);
    expect(project.source.kind).toBe('dxf');
    expect(project.upid.format).toBe('upid');
    expect(project.upid.document.plan.operations).toHaveLength(1);
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
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-row]')?.textContent).toContain(
      '0.000, 0.000 -> 10.000, 0.000'
    );
    expect(container.textContent).not.toContain('G1 X10.000 Y0.000');
  });

  it('opens persisted UPID-only projects without the legacy path planning payload', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'upid-only.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const manifest = JSON.parse(
      window.localStorage.getItem('wire-edm-workbench:file:workbench.json') || '{}'
    );
    const projectPath = manifest.projects[0].path;
    const storageKey = `wire-edm-workbench:file:${projectPath}`;
    const storedProject = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
    delete storedProject.pathPlanning;
    window.localStorage.setItem(storageKey, JSON.stringify(storedProject));

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const projectId = manifest.projects[0].id;
    const libraryOpenButton = container.querySelector(
      `button[aria-label="Open project ${projectId} in editor"]`
    ) as HTMLButtonElement | null;

    await act(async () => {
      libraryOpenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.textContent).toContain('Editor');
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-preview-source="path-document"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-row]')?.textContent).toContain(
      '0.000, 0.000 -> 10.000, 0.000'
    );
    expect(container.textContent).not.toContain('G1 X10.000 Y0.000');
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

  it('opens imported DXF projects into a path-first editor surface without header or footer drawers', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'path-surface.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-project-rail]')).not.toBeNull();
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-upid-contour-tree]')).not.toBeNull();
    expect(container.querySelector('[data-upid-contour-row]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-stack]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-row]')).not.toBeNull();
    expect(container.querySelector('[data-editor-path-plan-panel]')).toBeNull();
    expect(container.querySelector('[data-editor-posted-body-preview]')).toBeNull();
    expect(container.querySelector('[data-editor-code-section="lines"]')).toBeNull();
    expect(container.querySelector('[data-editor-code-section="text"]')).toBeNull();
    expect(container.querySelector('[data-editor-structure="header"]')).toBeNull();
    expect(container.querySelector('[data-editor-structure="footer"]')).toBeNull();
    expect(container.textContent).toContain('UPID Path Navigator');
    expect(container.textContent).toContain('Contour Tree');
    expect(container.textContent).not.toContain('Posted Body');
    expect(container.textContent).not.toContain('Program Lines');
    expect(container.textContent).not.toContain('Program Text');
    expect(container.textContent).not.toContain('Header');
    expect(container.textContent).not.toContain('Footer');
  });

  it('uses UPID-selected geometry details in the Inspector Rail for DXF projects', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'selected-geometry.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const inspector = container.querySelector('[data-editor-inspector-rail]');
    const selectedGeometry = container.querySelector('[data-upid-selected-geometry]');
    expect(inspector).not.toBeNull();
    expect(selectedGeometry).not.toBeNull();
    expect(selectedGeometry?.textContent).toContain('Selected Geometry');
    expect(selectedGeometry?.textContent).toContain('closed contour');
    expect(selectedGeometry?.textContent).toContain('4 segments');
    expect(container.querySelector('[data-upid-stat="operations"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-upid-stat="segments"]')?.textContent).toBe('4');
    expect(inspector?.textContent).not.toContain('Warnings');
    expect(inspector?.textContent).not.toContain('Errors');
    expect(inspector?.textContent).not.toContain('Lines');
  });

  it('shows nested UPID contour roles and containment in the navigator and inspector', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([nestedContourDxf()], 'nested-contours.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const contourRows = [...container.querySelectorAll('[data-upid-contour-row]')];
    expect(contourRows).toHaveLength(3);
    expect(contourRows.map((row) => row.getAttribute('data-upid-contour-role'))).toEqual([
      'island',
      'hole',
      'exterior'
    ]);
    expect(contourRows.map((row) => row.getAttribute('data-upid-contour-depth'))).toEqual([
      '2',
      '1',
      '0'
    ]);
    expect(contourRows[0].textContent).toContain('depth 2');
    expect(contourRows[1].textContent).toContain('depth 1');
    expect(contourRows[2].textContent).toContain('depth 0');

    await act(async () => {
      contourRows[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const selectedGeometry = container.querySelector('[data-upid-selected-geometry]');
    expect(selectedGeometry?.textContent).toContain('hole');
    expect(selectedGeometry?.textContent).toContain('Nest');
    expect(selectedGeometry?.textContent).toContain('depth 1');
    expect(selectedGeometry?.textContent).toContain('Children');
    expect(selectedGeometry?.textContent).toContain('1');
  });

  it('highlights selected UPID contours and segments on the canvas and in the inspector', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'selected-highlight.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const contourRow = container.querySelector('[data-upid-contour-row]') as HTMLElement | null;
    const operationId = contourRow?.getAttribute('data-upid-operation-id');
    expect(operationId).toBeTruthy();

    await act(async () => {
      contourRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const selectedOperationPaths = container.querySelectorAll(
      `path[data-preview-operation="${operationId}"][data-preview-selected="true"]`
    );
    expect(selectedOperationPaths).toHaveLength(4);

    const segmentRows = container.querySelectorAll('[data-upid-segment-row]');
    const segmentRow = segmentRows[1] as HTMLElement | undefined;
    const segmentId = segmentRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    await act(async () => {
      segmentRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(segmentRow?.getAttribute('data-upid-selected')).toBe('true');

    const selectedSegmentPath = container.querySelector(
      `path[data-preview-segment="${segmentId}"]`
    );
    expect(selectedSegmentPath?.getAttribute('data-preview-selected')).toBe('true');
    expect(selectedSegmentPath?.getAttribute('data-highlight')).toBe('selected');
    expect(
      container.querySelectorAll(
        `path[data-preview-operation="${operationId}"][data-preview-selected="true"]`
      )
    ).toHaveLength(1);

    const selectedSegment = container.querySelector('[data-upid-selected-segment]');
    expect(selectedSegment).not.toBeNull();
    expect(selectedSegment?.textContent).toContain('Selected Segment');
    expect(selectedSegment?.textContent).toContain('line');
  });

  it('shows manual UPID decisions in the selected geometry inspector', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'manual-decisions.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const reverseButton = container.querySelector(
      'button[aria-label="Reverse path operation"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      reverseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain(
      'Direction'
    );
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain(
      'reverse'
    );

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

    const startButton = container.querySelector(
      'button[aria-label="Set path start from canvas"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 10, y: 0 })
        })
      );
    });

    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain(
      'Start'
    );
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain(
      '10.000, 0.000'
    );
  });

  it('posts UPID to G-code only inside the explicit export preview', async () => {
    window.showDirectoryPicker = undefined;
    const downloadGeneratedProgram = vi.fn();

    await renderApp(context, { downloadGeneratedProgram });

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'export-preview.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-export-preview]')).toBeNull();
    expect(container.textContent).not.toContain('G1 X10.000 Y0.000');

    const openPreviewButton = container.querySelector(
      'button[aria-label="Open UPID export preview"]'
    ) as HTMLButtonElement | null;
    expect(openPreviewButton).not.toBeNull();

    await act(async () => {
      openPreviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const exportPreview = container.querySelector('[data-upid-export-preview]');
    const exportCode = container.querySelector('[data-upid-export-gcode]');
    expect(exportPreview).not.toBeNull();
    expect(exportPreview?.textContent).toContain('UPID Export Preview');
    expect(exportPreview?.textContent).toContain('Default Wire EDM');
    expect(exportCode?.textContent).toContain('G90 G21 G17 G40');
    expect(exportCode?.textContent).toContain('G1 X10.000 Y0.000');
    expect(exportCode?.textContent).toContain('M30');

    const downloadButton = container.querySelector(
      'button[aria-label="Download UPID export program"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^export-preview-\d{4}-\d{2}-\d{2}\.iso$/),
      text: expect.stringContaining('G1 X10.000 Y0.000')
    });
  });

  it('highlights UPID navigator segments from canvas hover when hover assist is enabled', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'hover-assist.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const hoverToggle = container.querySelector(
      'input[aria-label="Toggle canvas hover assist"]'
    ) as HTMLInputElement | null;
    expect(hoverToggle).not.toBeNull();

    await act(async () => {
      hoverToggle?.click();
    });

    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;
    const segmentId = segmentRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    const previewSegment = container.querySelector(
      `svg[aria-label="G-code path preview"] path[data-preview-segment="${segmentId}"]`
    );
    expect(previewSegment).not.toBeNull();
    expect(segmentRow?.getAttribute('data-upid-hovered')).not.toBe('true');

    await act(async () => {
      previewSegment?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(segmentRow?.getAttribute('data-upid-hovered')).toBe('true');

    await act(async () => {
      previewSegment?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });

    expect(segmentRow?.getAttribute('data-upid-hovered')).not.toBe('true');
  });

  it('shows a magnetic construction preview while hovering with perpendicular mode active', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'magnetic-preview.dxf')],
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

    const hoverToggle = container.querySelector(
      'input[aria-label="Toggle canvas hover assist"]'
    ) as HTMLInputElement | null;
    const snapToggle = container.querySelector(
      'input[aria-label="Toggle magnetic non-existing point snap"]'
    ) as HTMLInputElement | null;
    const perpendicularButton = container.querySelector(
      'button[aria-label="Magnetize latest point perpendicular"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      hoverToggle?.click();
    });
    await act(async () => {
      snapToggle?.click();
    });
    await act(async () => {
      perpendicularButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });

    const constructionPreview = container.querySelector('[data-upid-construction-preview]');
    expect(constructionPreview).not.toBeNull();
    expect(constructionPreview?.getAttribute('data-upid-construction-mode')).toBe('perpendicular');
  });

  it('uses existing contour points for Start Here until magnetic snap is enabled', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'start-existing-first.dxf')],
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

    const startButton = container.querySelector(
      'button[aria-label="Set path start from canvas"]'
    ) as HTMLButtonElement | null;

    expect(container.querySelectorAll('[data-upid-segment-row]')).toHaveLength(4);

    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });

    expect(container.querySelectorAll('[data-upid-segment-row]')).toHaveLength(4);

    const hoverToggle = container.querySelector(
      'input[aria-label="Toggle canvas hover assist"]'
    ) as HTMLInputElement | null;
    const snapToggle = container.querySelector(
      'input[aria-label="Toggle magnetic non-existing point snap"]'
    ) as HTMLInputElement | null;

    await act(async () => {
      hoverToggle?.click();
    });
    await act(async () => {
      snapToggle?.click();
    });
    await act(async () => {
      startButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 5 })
        })
      );
    });

    expect(container.querySelectorAll('[data-upid-segment-row]')).toHaveLength(5);
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

    expect(container.querySelector('[data-editor-posted-body-preview]')).toBeNull();
    expect(container.querySelector('[data-upid-contour-row]')?.textContent).toContain('reverse');
    expect(container.querySelector('textarea[aria-label="Program editor"]')).toBeNull();
    expect(container.textContent).toContain('Unsaved');

    const saveButton = container.querySelector(
      'button[aria-label="Save Path Plan"]'
    ) as HTMLButtonElement | null;

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

    expect(container.querySelector('[data-editor-posted-body-preview]')).toBeNull();
    expect(container.querySelector('[data-upid-contour-row]')?.textContent).toContain('forward');
  });

  it('keeps manual G-code text editing out of active DXF path plans', async () => {
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
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-editor-code-section="text"]')).toBeNull();
    expect(container.querySelector('textarea[aria-label="Program editor"]')).toBeNull();
    expect(container.textContent).not.toContain('Program Text');
  });

  it('does not let legacy line-edit commands clear an active DXF path plan', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'path-edit-guard.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const pointXInput = container.querySelector(
      'input[aria-label="Measurement point X"]'
    ) as HTMLInputElement | null;
    const pointYInput = container.querySelector(
      'input[aria-label="Measurement point Y"]'
    ) as HTMLInputElement | null;

    await act(async () => {
      if (pointXInput) setInputValue(pointXInput, '2');
      if (pointYInput) setInputValue(pointYInput, '3');
    });

    const addPointButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add Point')
    );

    await act(async () => {
      addPointButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const insertPointsButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Insert Points')
    ) as HTMLButtonElement | undefined;
    expect(insertPointsButton?.disabled).toBe(true);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Reverse path operation"]')).not.toBeNull();
    expect(container.querySelector('[data-editor-code-section="text"]')).toBeNull();
  });

  it('keeps DXF editor geometry path-native when profile headers contain blanks', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const headerEditor = container.querySelector(
      'textarea[aria-label="Header template"]'
    ) as HTMLTextAreaElement | null;
    expect(headerEditor).not.toBeNull();

    await act(async () => {
      if (headerEditor) setTextAreaValue(headerEditor, '%\n\nG90');
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
      value: [new File([rectangleDxf()], 'blank-header-lines.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-posted-body-row]')).toBeNull();
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-preview-source="path-document"]')).not.toBeNull();
    expect(container.textContent).not.toContain('G90');
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

  it('renders imported DXF previews from the internal path document', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'path-preview-source.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-preview-source="path-document"]')).not.toBeNull();
    expect(container.querySelector('[data-preview-source="gcode"]')).toBeNull();
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

function nestedContourDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...closedPolylineDxf([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 20 },
      { x: 0, y: 20 }
    ]),
    ...closedPolylineDxf([
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 15 },
      { x: 5, y: 15 }
    ]),
    ...closedPolylineDxf([
      { x: 10, y: 7 },
      { x: 15, y: 7 },
      { x: 15, y: 12 },
      { x: 10, y: 12 }
    ]),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function closedPolylineDxf(points: Array<{ x: number; y: number }>) {
  return [
    '0',
    'LWPOLYLINE',
    '90',
    String(points.length),
    '70',
    '1',
    ...points.flatMap((point) => ['10', String(point.x), '20', String(point.y)])
  ];
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
