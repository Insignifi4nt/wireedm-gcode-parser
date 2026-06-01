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

  it('imports a DXF through the browser cache workbench and opens the UPID path project in the editor', async () => {
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
    expect(container.textContent).toContain('imports/part-');
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('svg[aria-label="UPID path preview"]')?.getAttribute('data-preview-model')).toBe(
      'upid'
    );
    expect(container.querySelector('svg[aria-label="G-code path preview"]')).toBeNull();
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
    expect('generated' in project).toBe(false);
    expect(window.localStorage.getItem(`wire-edm-workbench:file:generated/${project.id}.iso`)).toBeNull();

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
    expect(container.textContent).toContain('UPID on demand');
    expect(container.textContent).not.toContain('G1 X10.000 Y0.000');

    const downloadButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Download Program')
    );
    expect(downloadButton).toBeUndefined();
    expect(downloadGeneratedProgram).not.toHaveBeenCalled();
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
    expect(container.textContent).toContain('imports/library-open-');
    expect(container.querySelector('[data-upid-path-navigator]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-row]')?.textContent).toContain(
      '0.000, 0.000 -> 10.000, 0.000'
    );
    expect(container.textContent).not.toContain('G1 X10.000 Y0.000');
  });

  it('surfaces UPID path diagnostics in the Project Rail navigator', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'open-diagnostic.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const diagnostics = container.querySelector('[data-upid-diagnostics]');
    const diagnosticRows = [...container.querySelectorAll('[data-upid-diagnostic-row]')];

    expect(diagnostics).not.toBeNull();
    expect(diagnostics?.textContent).toContain('Path Diagnostics');
    expect(diagnostics?.textContent).toContain('1 issue');
    expect(diagnosticRows).toHaveLength(1);
    expect(diagnosticRows[0].getAttribute('data-upid-diagnostic-code')).toBe('open-chain');
    expect(diagnosticRows[0].getAttribute('data-upid-diagnostic-severity')).toBe('warning');
    expect(diagnosticRows[0].textContent).toContain('open chain');
  });

  it('highlights UPID geometry related to a path diagnostic', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'diagnostic-hover.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const diagnosticRow = container.querySelector('[data-upid-diagnostic-row]') as HTMLElement | null;
    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;
    const segmentId = segmentRow?.getAttribute('data-upid-segment-id');
    const previewSegment = container.querySelector(
      `svg[aria-label="UPID path preview"] path[data-preview-segment="${segmentId}"]`
    );
    expect(diagnosticRow).not.toBeNull();
    expect(segmentId).toBeTruthy();
    expect(previewSegment).not.toBeNull();

    await act(async () => {
      diagnosticRow?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(diagnosticRow?.getAttribute('data-upid-hovered')).toBe('true');
    expect(segmentRow?.getAttribute('data-upid-hovered')).toBe('true');
    expect(previewSegment?.getAttribute('data-preview-hovered')).toBe('true');

    await act(async () => {
      diagnosticRow?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });

    expect(diagnosticRow?.getAttribute('data-upid-hovered')).not.toBe('true');
    expect(segmentRow?.getAttribute('data-upid-hovered')).not.toBe('true');
    expect(previewSegment?.getAttribute('data-preview-hovered')).not.toBe('true');
  });

  it('selects UPID geometry related to a path diagnostic', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'diagnostic-select.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const diagnosticRow = container.querySelector('[data-upid-diagnostic-row]') as HTMLElement | null;
    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;
    const segmentId = segmentRow?.getAttribute('data-upid-segment-id');
    const previewSegment = container.querySelector(
      `svg[aria-label="UPID path preview"] path[data-preview-segment="${segmentId}"]`
    );
    expect(diagnosticRow).not.toBeNull();
    expect(segmentId).toBeTruthy();
    expect(previewSegment).not.toBeNull();

    await act(async () => {
      diagnosticRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(diagnosticRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(segmentRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(previewSegment?.getAttribute('data-preview-selected')).toBe('true');
    expect(container.querySelector('[data-upid-selected-segment]')?.textContent).toContain(
      'Selected Segment'
    );
  });

  it('opens persisted UPID projects from the first-class path document', async () => {
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
    expect(storedProject.upid?.format).toBe('upid');
    expect(storedProject.pathPlanning).toBeUndefined();

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

  it('uses UPID geometry for editor path stats instead of stale generated G-code', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'upid-stats.dxf')],
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
    const project = JSON.parse(
      window.localStorage.getItem(`wire-edm-workbench:file:${projectPath}`) || '{}'
    );
    const activeProgramPath = project.editor.activeFilePath;
    window.localStorage.setItem(
      `wire-edm-workbench:file:${activeProgramPath}`,
      'G0 X0 Y0\nG1 X1 Y0\nM30'
    );

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const libraryOpenButton = container.querySelector(
      `button[aria-label="Open project ${manifest.projects[0].id} in editor"]`
    ) as HTMLButtonElement | null;

    await act(async () => {
      libraryOpenButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-canvas-panel]')?.textContent).toContain('5 path items');
    expect(container.querySelector('[data-editor-stat="bounds"]')?.textContent).toBe(
      'X0.000..10.000 Y0.000..5.000'
    );
    expect(container.querySelector('[data-upid-stat="segments"]')?.textContent).toBe('4');
    expect(container.textContent).not.toContain('G1 X1 Y0');
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

    const contourRow = container.querySelector('[data-upid-contour-row]') as HTMLElement | null;
    await act(async () => {
      contourRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

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

  it('opens DXF path projects without selecting the first cut sequence', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'unselected-path.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-cut-sequence-row][data-upid-selected="true"]')).toBeNull();
    expect(container.querySelector('[data-upid-contour-row][data-upid-selected="true"]')).toBeNull();
    expect(container.querySelector('[data-preview-selected="true"]')).toBeNull();
    expect(container.querySelector('[data-upid-selected-geometry]')).toBeNull();
  });

  it('clears UPID path selection with Escape', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'escape-clears-path.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const contourRow = container.querySelector('[data-upid-contour-row]') as HTMLElement | null;
    await act(async () => {
      contourRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(contourRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(container.querySelector('[data-preview-selected="true"]')).not.toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(container.querySelector('[data-upid-cut-sequence-row][data-upid-selected="true"]')).toBeNull();
    expect(container.querySelector('[data-upid-contour-row][data-upid-selected="true"]')).toBeNull();
    expect(container.querySelector('[data-preview-selected="true"]')).toBeNull();
    expect(container.querySelector('[data-upid-selected-geometry]')).toBeNull();
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
    expect(contourRows.map((row) => row.getAttribute('data-upid-contour-label'))).toEqual([
      'Contour 1',
      'Contour 2',
      'Contour 3'
    ]);
    expect(contourRows.map((row) => row.getAttribute('data-upid-path-element-id'))).toEqual([
      'contour_0001',
      'contour_0002',
      'contour_0003'
    ]);
    expect(contourRows.map((row) => row.getAttribute('data-upid-contour-source-entities'))).toEqual([
      '1',
      '1',
      '1'
    ]);
    expect(contourRows.map((row) => row.getAttribute('data-upid-contour-role'))).toEqual([
      'exterior',
      'hole',
      'island'
    ]);
    expect(contourRows.map((row) => row.getAttribute('data-upid-contour-depth'))).toEqual([
      '0',
      '1',
      '2'
    ]);
    expect(contourRows[0].textContent).toContain('depth 0');
    expect(contourRows[1].textContent).toContain('depth 1');
    expect(contourRows[2].textContent).toContain('depth 2');
    const contourGroups = [...container.querySelectorAll('[data-upid-contour-group]')];
    expect(contourGroups.map((group) => group.getAttribute('data-upid-tree-depth'))).toEqual([
      '0',
      '1',
      '2'
    ]);
    expect(contourGroups.map((group) => group.getAttribute('data-upid-path-element-id'))).toEqual([
      'contour_0001',
      'contour_0002',
      'contour_0003'
    ]);
    expect(contourGroups[1].parentElement?.closest('[data-upid-contour-group]')).toBe(contourGroups[0]);
    expect(contourGroups[2].parentElement?.closest('[data-upid-contour-group]')).toBe(contourGroups[1]);

    const cutSequence = container.querySelector('[data-upid-cut-sequence]');
    const cutSequenceRows = [...container.querySelectorAll('[data-upid-cut-sequence-row]')];
    expect(cutSequence).not.toBeNull();
    expect(cutSequence?.textContent).toContain('Cut Sequence');
    expect(cutSequenceRows).toHaveLength(3);
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-label'))).toEqual([
      'Contour 3',
      'Contour 2',
      'Contour 1'
    ]);
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-path-element-id'))).toEqual([
      'contour_0003',
      'contour_0002',
      'contour_0001'
    ]);
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-source-entities'))).toEqual([
      '1',
      '1',
      '1'
    ]);
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-role'))).toEqual([
      'island',
      'hole',
      'exterior'
    ]);
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-rapid'))).toEqual([
      '12.207',
      '5.385',
      '7.071'
    ]);
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-cut'))).toEqual([
      '20.000',
      '60.000',
      '100.000'
    ]);
    expect(cutSequenceRows[0].textContent).toContain('Rapid');

    const firstCutSequenceSelect = cutSequenceRows[0].querySelector(
      '[data-upid-cut-sequence-select]'
    );

    await act(async () => {
      firstCutSequenceSelect?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(cutSequenceRows[0].getAttribute('data-upid-selected')).toBe('true');
    expect(container.querySelector('[data-upid-selected="classification"]')?.textContent).toBe('island');
    expect(container.querySelector('[data-upid-selected="nest"]')?.textContent).toContain('depth 2');

    await act(async () => {
      contourRows[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const selectedGeometry = container.querySelector('[data-upid-selected-geometry]');
    expect(selectedGeometry?.textContent).toContain('hole');
    expect(selectedGeometry?.textContent).toContain('Nest');
    expect(selectedGeometry?.textContent).toContain('depth 1');
    expect(selectedGeometry?.textContent).toContain('Children');
    expect(selectedGeometry?.textContent).toContain('1');
    expect(container.querySelector('[data-upid-selected="source-entities"]')?.textContent).toBe('1 entity');
    expect(container.querySelector('[data-upid-selected="source-layers"]')?.textContent).toBe('-');
    expect(container.querySelector('[data-upid-selected="source-exact"]')?.textContent).toBe('exact');
  });

  it('lets the user manually correct the selected UPID contour role', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'role-correction.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();
    await selectFirstCutSequence(container);

    const roleSelect = container.querySelector(
      'select[aria-label="Contour role"]'
    ) as HTMLSelectElement | null;
    expect(roleSelect).not.toBeNull();

    await act(async () => {
      if (roleSelect) setSelectValue(roleSelect, 'hole');
    });

    expect(roleSelect?.value).toBe('hole');
    expect(container.querySelector('[data-upid-contour-row]')?.getAttribute('data-upid-contour-role')).toBe(
      'hole'
    );
    expect(container.querySelector('[data-upid-selected="classification"]')?.textContent).toBe('hole');
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain('Role');
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain('hole');
  });

  it('saves manual UPID role corrections even when posted G-code is unchanged', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'role-save.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();
    await selectFirstCutSequence(container);

    const roleSelect = container.querySelector(
      'select[aria-label="Contour role"]'
    ) as HTMLSelectElement | null;
    const saveButton = container.querySelector(
      'button[aria-label="Save Path Plan"]'
    ) as HTMLButtonElement | null;
    expect(roleSelect).not.toBeNull();
    expect(saveButton).not.toBeNull();
    expect(saveButton?.disabled).toBe(true);

    await act(async () => {
      if (roleSelect) setSelectValue(roleSelect, 'hole');
    });
    await flushAsync();

    expect(container.textContent).toContain('Unsaved');
    expect(saveButton?.disabled).toBe(false);

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

    expect(savedProject.upid.document.plan.operations[0].classification).toBe('hole');
    expect(savedProject.pathPlanning).toBeUndefined();

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const openLatestButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open in Editor')
    );

    await act(async () => {
      openLatestButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
    await selectFirstCutSequence(container);

    expect(container.querySelector('select[aria-label="Contour role"]')).toHaveProperty('value', 'hole');
    expect(container.querySelector('[data-upid-contour-row]')?.getAttribute('data-upid-contour-role')).toBe(
      'hole'
    );
  });

  it('reorders UPID cut sequence directly from Project Rail rows', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([nestedContourDxf()], 'cut-sequence-reorder.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    let cutSequenceRows = [...container.querySelectorAll('[data-upid-cut-sequence-row]')];
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-role'))).toEqual([
      'island',
      'hole',
      'exterior'
    ]);

    const moveDownButton = cutSequenceRows[0].querySelector(
      'button[aria-label="Move cut sequence operation down"]'
    ) as HTMLButtonElement | null;
    expect(moveDownButton).not.toBeNull();

    await act(async () => {
      moveDownButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    cutSequenceRows = [...container.querySelectorAll('[data-upid-cut-sequence-row]')];
    expect(cutSequenceRows.map((row) => row.getAttribute('data-upid-cut-sequence-role'))).toEqual([
      'hole',
      'island',
      'exterior'
    ]);
    expect(cutSequenceRows[1].getAttribute('data-upid-selected')).toBe('true');
    expect(cutSequenceRows[1].querySelector('[data-upid-manual-decision="order"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain('Order');
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain(
      'Manual position 2'
    );
  });

  it('connects UPID rapid travel links between the canvas and Cut Sequence rows', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([nestedContourDxf()], 'rapid-travel-links.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const hoverToggle = container.querySelector(
      'input[aria-label="Toggle canvas hover assist"]'
    ) as HTMLInputElement | null;
    await act(async () => {
      hoverToggle?.click();
    });

    const cutSequenceRow = container.querySelector(
      '[data-upid-cut-sequence-row]'
    ) as HTMLElement | null;
    const operationId = cutSequenceRow?.getAttribute('data-upid-operation-id');
    expect(operationId).toBeTruthy();

    const rapidControl = cutSequenceRow?.querySelector(
      '[data-upid-cut-sequence-rapid-control]'
    ) as HTMLElement | null;
    expect(rapidControl).not.toBeNull();

    const rapidPath = container.querySelector(
      `svg[aria-label="UPID path preview"] path[data-type="rapid"][data-preview-travel="rapid-in"][data-preview-operation="${operationId}"]`
    );
    expect(rapidPath).not.toBeNull();
    expect(rapidPath?.getAttribute('d')).toBe('M 0 0 L 10 7');

    await act(async () => {
      rapidPath?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(cutSequenceRow?.getAttribute('data-upid-hovered')).toBe('true');
    expect(rapidControl?.getAttribute('data-upid-hovered')).toBe('true');

    await act(async () => {
      rapidPath?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });

    await act(async () => {
      rapidPath?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(cutSequenceRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(rapidControl?.getAttribute('data-upid-selected')).toBe('true');
    expect(rapidPath?.getAttribute('data-preview-selected')).toBe('true');
    expect(rapidPath?.getAttribute('data-highlight')).toBe('selected');
    expect(container.querySelector('[data-upid-selected-travel]')?.textContent).toContain(
      'Selected Travel'
    );
    expect(container.querySelector('[data-upid-selected-travel="start"]')?.textContent).toBe(
      '0.000, 0.000'
    );
    expect(container.querySelector('[data-upid-selected-travel="end"]')?.textContent).toBe(
      '10.000, 7.000'
    );
    expect(container.querySelector('[data-upid-selected-travel="length"]')?.textContent).toBe('12.207');
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
    expect(container.querySelector('[data-upid-selected-segment-source="type"]')?.textContent).toBe(
      'lwpolyline'
    );
    expect(container.querySelector('[data-upid-selected-segment-source="entity"]')?.textContent).toBe(
      '0'
    );
    expect(container.querySelector('[data-upid-selected-segment-source="sub"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-upid-selected-segment-source="exact"]')?.textContent).toBe(
      'exact'
    );
  });

  it('selects UPID segment geometry from a canvas click', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'canvas-select.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();
    await selectFirstCutSequence(container);

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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

    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;
    const segmentId = segmentRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    const previewSegment = container.querySelector(
      `svg[aria-label="UPID path preview"] path[data-preview-segment="${segmentId}"]`
    );
    expect(previewSegment).not.toBeNull();

    await act(async () => {
      previewSegment?.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 5, y: 0 })
        })
      );
    });

    expect(segmentRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(previewSegment?.getAttribute('data-preview-selected')).toBe('true');
    expect(container.querySelector('[data-upid-selected-segment]')?.textContent).toContain('Selected Segment');
    expect(container.querySelectorAll('[data-measurement-point]')).toHaveLength(0);
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
    await selectFirstCutSequence(container);

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
    expect(
      container.querySelector(
        '[data-upid-cut-sequence-row][data-upid-selected="true"] [data-upid-manual-decision="direction"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-upid-contour-row][data-upid-selected="true"] [data-upid-manual-decision="direction"]'
      )
    ).not.toBeNull();

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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
    expect(
      container.querySelector(
        '[data-upid-cut-sequence-row][data-upid-selected="true"] [data-upid-manual-decision="start"]'
      )
    ).not.toBeNull();
    expect(
      container.querySelector(
        '[data-upid-contour-row][data-upid-selected="true"] [data-upid-manual-decision="start"]'
      )
    ).not.toBeNull();
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
    const exportSummary = container.querySelector('[data-upid-export-summary]');
    const exportCode = container.querySelector('[data-upid-export-gcode]');
    expect(exportPreview).not.toBeNull();
    expect(exportPreview?.textContent).toContain('UPID Export Preview');
    expect(exportPreview?.textContent).toContain('Default Wire EDM');
    expect(exportSummary).not.toBeNull();
    expect(container.querySelector('[data-upid-export-stat="operations"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-upid-export-stat="rapid"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-upid-export-stat="cut"]')?.textContent).toBe('4');
    expect(container.querySelector('[data-upid-export-stat="diagnostics"]')?.textContent).toBe('0');
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

  it('carries UPID path diagnostics into the export preview', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([simpleLineDxf()], 'export-diagnostics.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const openPreviewButton = container.querySelector(
      'button[aria-label="Open UPID export preview"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      openPreviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const exportDiagnostics = container.querySelector('[data-upid-export-diagnostics]');
    const diagnosticRows = [...container.querySelectorAll('[data-upid-export-diagnostic-row]')];

    expect(container.querySelector('[data-upid-export-stat="diagnostics"]')?.textContent).toBe('1');
    expect(exportDiagnostics).not.toBeNull();
    expect(diagnosticRows).toHaveLength(1);
    expect(diagnosticRows[0].getAttribute('data-upid-export-diagnostic-code')).toBe('open-chain');
    expect(diagnosticRows[0].getAttribute('data-upid-export-diagnostic-severity')).toBe('warning');
    expect(diagnosticRows[0].textContent).toContain('open chain');
    expect(container.querySelector('[data-upid-export-gcode]')?.textContent).toContain('G1 X10.000 Y0.000');
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
      `svg[aria-label="UPID path preview"] path[data-preview-segment="${segmentId}"]`
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

  it('highlights and selects UPID endpoint points between the canvas and Project Rail', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'endpoint-hover.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const hoverToggle = container.querySelector(
      'input[aria-label="Toggle canvas hover assist"]'
    ) as HTMLInputElement | null;
    await act(async () => {
      hoverToggle?.click();
    });

    const pointRows = [...container.querySelectorAll('[data-upid-point-row]')];
    expect(pointRows).toHaveLength(8);

    const endpointRow = pointRows.find(
      (row) => row.getAttribute('data-upid-point-role') === 'end'
    ) as HTMLElement | undefined;
    const segmentId = endpointRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    const endpointHandle = container.querySelector(
      `svg[aria-label="UPID path preview"] circle[data-preview-path-endpoint][data-preview-point-role="end"][data-preview-segment="${segmentId}"]`
    );
    expect(endpointHandle).not.toBeNull();

    await act(async () => {
      endpointHandle?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(endpointRow?.getAttribute('data-upid-hovered')).toBe('true');

    await act(async () => {
      endpointHandle?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });

    expect(endpointRow?.getAttribute('data-upid-hovered')).not.toBe('true');

    await act(async () => {
      endpointRow?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    const hoveredEndpointHandle = container.querySelector(
      `svg[aria-label="UPID path preview"] circle[data-preview-path-endpoint][data-preview-point-role="end"][data-preview-segment="${segmentId}"]`
    );
    expect(hoveredEndpointHandle?.getAttribute('data-preview-hovered')).toBe('true');

    await act(async () => {
      hoveredEndpointHandle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const selectedEndpointHandle = container.querySelector(
      `svg[aria-label="UPID path preview"] circle[data-preview-path-endpoint][data-preview-point-role="end"][data-preview-segment="${segmentId}"]`
    );

    expect(endpointRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(selectedEndpointHandle?.getAttribute('data-preview-selected')).toBe('true');
    expect(container.querySelector('[data-upid-selected-point]')?.textContent).toContain('Selected Point');
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('end');
  });

  it('sets the UPID contour start directly from a nested endpoint point row', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'endpoint-start.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const targetPointRow = [...container.querySelectorAll('[data-upid-point-row]')].find((row) =>
      row.textContent?.includes('10.000, 0.000')
    ) as HTMLElement | undefined;
    expect(targetPointRow).toBeDefined();

    const setStartButton = targetPointRow?.querySelector(
      'button[aria-label="Set path start to this point"]'
    ) as HTMLButtonElement | null;
    expect(setStartButton).not.toBeNull();

    await act(async () => {
      setStartButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-upid-selected="start"]')?.textContent).toBe('10.000, 0.000');
    expect(container.querySelectorAll('[data-upid-segment-row]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-upid-point-row]')).toHaveLength(8);
    expect(
      container.querySelector(
        '[data-upid-cut-sequence-row][data-upid-selected="true"] [data-upid-manual-decision="start"]'
      )
    ).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain('Start');
    expect(container.querySelector('[data-upid-selected-overrides]')?.textContent).toContain(
      '10.000, 0.000'
    );
  });

  it('highlights canvas geometry from UPID navigator row hover', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'navigator-hover.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;
    const segmentId = segmentRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    const previewSegment = container.querySelector(
      `svg[aria-label="UPID path preview"] path[data-preview-segment="${segmentId}"]`
    );
    expect(previewSegment).not.toBeNull();
    expect(previewSegment?.getAttribute('data-preview-hovered')).not.toBe('true');

    await act(async () => {
      segmentRow?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(previewSegment?.getAttribute('data-preview-hovered')).toBe('true');
    expect(previewSegment?.getAttribute('data-highlight')).toBe('hover');

    await act(async () => {
      segmentRow?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });

    expect(previewSegment?.getAttribute('data-preview-hovered')).not.toBe('true');
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
    await selectFirstCutSequence(container);

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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
    const constructionSegmentId = constructionPreview?.getAttribute('data-upid-construction-segment');
    expect(constructionSegmentId).toBeTruthy();
    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${constructionSegmentId}"]`)
        ?.getAttribute('data-upid-hovered')
    ).toBe('true');
    expect(
      container
        .querySelector(`path[data-preview-segment="${constructionSegmentId}"]`)
        ?.getAttribute('data-preview-hovered')
    ).toBe('true');
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
    await selectFirstCutSequence(container);

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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

  it('previews whether Start will use an existing point or create a split point', async () => {
    window.showDirectoryPicker = undefined;

    await renderApp(context);

    const fileInput = container.querySelector('input[aria-label="DXF file"]') as HTMLInputElement | null;
    Object.defineProperty(fileInput, 'files', {
      value: [new File([rectangleDxf()], 'start-preview.dxf')],
      configurable: true
    });

    await act(async () => {
      fileInput?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();
    await selectFirstCutSequence(container);

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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
        new MouseEvent('mousemove', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 9, y: 0.35 })
        })
      );
    });

    const existingStartPreview = container.querySelector('[data-upid-start-preview]');
    expect(existingStartPreview?.getAttribute('data-upid-start-relation')).toBe('existing-point');
    const existingStartSegmentId = existingStartPreview?.getAttribute('data-upid-start-segment');
    const existingStartPointRole = existingStartPreview?.getAttribute('data-upid-start-point-role');
    expect(existingStartSegmentId).toBeTruthy();
    expect(existingStartPointRole).toBeTruthy();

    const hoverToggle = container.querySelector(
      'input[aria-label="Toggle canvas hover assist"]'
    ) as HTMLInputElement | null;
    const snapToggle = container.querySelector(
      'input[aria-label="Toggle magnetic non-existing point snap"]'
    ) as HTMLInputElement | null;

    await act(async () => {
      hoverToggle?.click();
    });

    expect(
      container
        .querySelector(
          `[data-upid-point-row][data-upid-segment-id="${existingStartSegmentId}"][data-upid-point-role="${existingStartPointRole}"]`
        )
        ?.getAttribute('data-upid-hovered')
    ).toBe('true');
    expect(
      container
        .querySelector(
          `circle[data-preview-path-endpoint][data-preview-segment="${existingStartSegmentId}"][data-preview-point-role="${existingStartPointRole}"]`
        )
        ?.getAttribute('data-preview-hovered')
    ).toBe('true');

    await act(async () => {
      snapToggle?.click();
    });
    await act(async () => {
      preview?.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          ...worldClientPoint(preview!, { x: 9, y: 0.35 })
        })
      );
    });

    const splitStartPreview = container.querySelector('[data-upid-start-preview]');
    expect(splitStartPreview?.getAttribute('data-upid-start-relation')).toBe('new-split-point');
    const splitStartSegmentId = splitStartPreview?.getAttribute('data-upid-start-segment');
    expect(splitStartSegmentId).toBeTruthy();
    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${splitStartSegmentId}"]`)
        ?.getAttribute('data-upid-hovered')
    ).toBe('true');
    expect(
      container
        .querySelector(`path[data-preview-segment="${splitStartSegmentId}"]`)
        ?.getAttribute('data-preview-hovered')
    ).toBe('true');
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
    await selectFirstCutSequence(container);

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

    expect(savedProject.upid.document.plan.operations[0].direction).toBe('reverse');
    expect(savedProject.pathPlanning).toBeUndefined();
    expect('generated' in savedProject).toBe(false);
    expect(savedProject.editor.activeFilePath).toBeNull();
    expect(window.localStorage.getItem(`wire-edm-workbench:file:generated/${savedProject.id}.body.gcode`)).toBeNull();

    const openPreviewButton = container.querySelector(
      'button[aria-label="Open UPID export preview"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      openPreviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-upid-export-gcode]')?.textContent).toContain(
      'G1 X0.000 Y5.000'
    );
    const downloadButton = container.querySelector(
      'button[aria-label="Download UPID export program"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(downloadGeneratedProgram).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^rectangle-\d{4}-\d{2}-\d{2}\.iso$/),
      text: expect.stringContaining('G1 X0.000 Y5.000')
    });

    const closePreviewButton = container.querySelector(
      'button[aria-label="Close UPID export preview"]'
    ) as HTMLButtonElement | null;

    await act(async () => {
      closePreviewButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const dashboardButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Dashboard')
    );

    await act(async () => {
      dashboardButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const dashboardDownloadButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Download Program')
    );
    expect(dashboardDownloadButton).toBeUndefined();
    expect(downloadGeneratedProgram).toHaveBeenCalledTimes(1);

    const openLatestButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Open in Editor')
    );

    await act(async () => {
      openLatestButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
    await selectFirstCutSequence(container);

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

  it('does not let text line-edit commands clear an active DXF path plan', async () => {
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
    await selectFirstCutSequence(container);

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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

    const secondPointRow = container.querySelector('[data-measurement-point-row="2"]') as HTMLElement | null;
    expect(secondPointRow?.textContent).toContain('5.000');
    expect(container.querySelector('[data-measurement-point-mode="2"]')?.textContent).toBe('Perp');
    const targetSegmentId = secondPointRow?.getAttribute('data-measurement-point-segment');
    expect(targetSegmentId).toBeTruthy();

    await act(async () => {
      secondPointRow?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${targetSegmentId}"]`)
        ?.getAttribute('data-upid-hovered')
    ).toBe('true');
    expect(
      container
        .querySelector(`path[data-preview-segment="${targetSegmentId}"]`)
        ?.getAttribute('data-preview-hovered')
    ).toBe('true');

    const targetButton = secondPointRow?.querySelector(
      'button[aria-label="Select measurement point target P2"]'
    ) as HTMLButtonElement | null;
    expect(targetButton).not.toBeNull();

    await act(async () => {
      targetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${targetSegmentId}"]`)
        ?.getAttribute('data-upid-selected')
    ).toBe('true');
    expect(
      container
        .querySelector(`path[data-preview-segment="${targetSegmentId}"]`)
        ?.getAttribute('data-preview-selected')
    ).toBe('true');
    expect(container.querySelector('[data-upid-selected-segment]')?.textContent).toContain(
      'Selected Segment'
    );

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
    await selectFirstCutSequence(container);

    const tangentButton = container.querySelector(
      'button[aria-label="Magnetize latest point tangent"]'
    ) as HTMLButtonElement | null;
    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
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

async function selectFirstCutSequence(container: HTMLElement) {
  const firstCutSequence = container.querySelector(
    '[data-upid-cut-sequence-select]'
  ) as HTMLButtonElement | null;

  await act(async () => {
    firstCutSequence?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
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
