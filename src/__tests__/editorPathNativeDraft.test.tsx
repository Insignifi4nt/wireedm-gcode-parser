import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRailProvider, type AppRailContent } from '@/app/AppRailContext';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { withProjectUpid } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { EditorPage } from '@/features/editor/EditorPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

describe('EditorPage UPID draft boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('saves UPID path edits without materializing posted G-code as editor text', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);
    const onSaveEditorDraft = vi.fn();

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={onSaveEditorDraft}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-upid-cut-sequence-select]');
    await clickElement('button[aria-label="Reverse path operation"]');

    expect(container.textContent).toContain('Unsaved');

    await clickElement('button[aria-label="Save Path Plan"]');

    expect(onSaveEditorDraft).toHaveBeenCalledTimes(1);
    expect(onSaveEditorDraft).toHaveBeenCalledWith({
      model: 'upid-document',
      pathDocument: expect.objectContaining({
        plan: expect.objectContaining({
          operations: [
            expect.objectContaining({
              direction: 'reverse'
            })
          ]
        })
      })
    });
  });

  it('undoes and redoes UPID path edits as modeled path documents', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);
    const onSaveEditorDraft = vi.fn();

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={onSaveEditorDraft}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-upid-cut-sequence-select]');
    await clickElement('button[aria-label="Reverse path operation"]');
    expect(container.textContent).toContain('Unsaved');

    await clickElement('button[aria-label="Undo"]');
    expect(container.textContent).not.toContain('Unsaved');
    const saveButton = container.querySelector(
      'button[aria-label="Save Path Plan"]'
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await clickElement('button[aria-label="Redo"]');
    expect(container.textContent).toContain('Unsaved');

    await clickElement('button[aria-label="Save Path Plan"]');

    expect(onSaveEditorDraft).toHaveBeenCalledTimes(1);
    expect(onSaveEditorDraft).toHaveBeenCalledWith({
      model: 'upid-document',
      pathDocument: expect.objectContaining({
        plan: expect.objectContaining({
          operations: [
            expect.objectContaining({
              direction: 'reverse'
            })
          ]
        })
      })
    });
  });

  it('collapses contour tree groups without changing path selection', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    const contourGroup = container.querySelector('[data-upid-contour-group="contour_0001"]');
    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('true');
    expect(contourGroup?.getAttribute('data-upid-contour-direct-segments')).toBe('4');
    expect(contourGroup?.getAttribute('data-upid-contour-total-segments')).toBe('4');
    expect(contourGroup?.getAttribute('data-upid-contour-descendants')).toBe('0');

    await clickElement('button[aria-label="Select Exterior 1"]');
    expect(contourGroup?.getAttribute('data-upid-selected')).toBe('true');

    await clickElement('button[aria-label="Collapse Exterior 1"]');

    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('false');
    expect(contourGroup?.getAttribute('data-upid-selected')).toBe('true');
    expect(container.querySelector('[data-upid-segment-stack]')).toBeNull();

    await clickElement('button[aria-label="Expand Exterior 1"]');

    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('true');
    expect(container.querySelector('[data-upid-segment-stack]')).not.toBeNull();
  });

  it('collapses and expands the whole contour tree from named controls', async () => {
    const pathDocument = pathDocumentFromNestedRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-path-tree-controls]')).not.toBeNull();
    expectContourExpanded('contour_0001', true);
    expectContourExpanded('contour_0002', true);

    await clickElement('button[aria-label="Collapse entire contour tree"]');

    expectContourExpanded('contour_0001', false);
    expect(container.querySelector('[data-upid-contour-group="contour_0002"]')).toBeNull();
    expect(container.querySelector('[data-upid-segment-stack]')).toBeNull();

    await clickElement('button[aria-label="Expand Exterior 1"]');

    expectContourExpanded('contour_0001', true);
    expectContourExpanded('contour_0002', false);

    await clickElement('button[aria-label="Expand entire contour tree"]');

    expectContourExpanded('contour_0001', true);
    expectContourExpanded('contour_0002', true);
    expect(container.querySelectorAll('[data-upid-segment-stack]')).toHaveLength(2);
  });

  it('shows selected contour subtree metrics in the inspector', async () => {
    const pathDocument = pathDocumentFromNestedRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');

    const exteriorTreeContext = container.querySelector('[data-upid-selected-tree-context]');
    expect(exteriorTreeContext?.getAttribute('data-upid-path-element-id')).toBe('contour_0001');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.textContent).toBe('Exterior 1');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.getAttribute('data-upid-lineage-depth')).toBe(
      '1'
    );
    expect(container.querySelector('[data-upid-selected="tree-direct-segments"]')?.textContent).toBe('4');
    expect(container.querySelector('[data-upid-selected="tree-descendants"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-upid-selected="tree-total-segments"]')?.textContent).toBe('8');

    await clickElement('button[aria-label="Select Hole 1"]');

    const holeTreeContext = container.querySelector('[data-upid-selected-tree-context]');
    expect(holeTreeContext?.getAttribute('data-upid-path-element-id')).toBe('contour_0002');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.textContent).toBe(
      'Exterior 1 / Hole 1'
    );
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.getAttribute('data-upid-lineage-depth')).toBe(
      '2'
    );
    expect(container.querySelector('[data-upid-selected="tree-direct-segments"]')?.textContent).toBe('4');
    expect(container.querySelector('[data-upid-selected="tree-descendants"]')?.textContent).toBe('0');
    expect(container.querySelector('[data-upid-selected="tree-total-segments"]')?.textContent).toBe('4');
  });

  it('selects lineage ancestors from the inspector path tree context', async () => {
    const pathDocument = pathDocumentFromNestedRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Hole 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0002'
    );

    await clickElement('button[aria-label="Select lineage Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0001'
    );
    expect(container.querySelector('[data-upid-selected="label"]')?.textContent).toBe('Exterior 1');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.textContent).toBe('Exterior 1');
  });

  it('selects child contours from the inspector path tree context', async () => {
    const pathDocument = pathDocumentFromNestedRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0001'
    );

    await clickElement('button[aria-label="Select child Hole 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0002'
    );
    expect(container.querySelector('[data-upid-selected="label"]')?.textContent).toBe('Hole 1');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.textContent).toBe(
      'Exterior 1 / Hole 1'
    );
  });

  it('selects sibling contours from the inspector path tree context', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0001'
    );

    await clickElement('button[aria-label="Select sibling Exterior 2"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0002'
    );
    expect(container.querySelector('[data-upid-selected="label"]')?.textContent).toBe('Exterior 2');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.textContent).toBe('Exterior 2');
  });

  it('selects cut-sequence neighbors from the inspector path tree context', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0001'
    );
    expect(container.querySelector('[data-upid-selected="sequence-neighbors"]')?.textContent).toContain(
      'Exterior 1'
    );

    await clickElement('button[aria-label="Select next cut sequence Exterior 2"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0002'
    );
    expect(container.querySelector('[data-upid-selected="label"]')?.textContent).toBe('Exterior 2');

    await clickElement('button[aria-label="Select previous cut sequence Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-tree-context]')?.getAttribute('data-upid-path-element-id')).toBe(
      'contour_0001'
    );
    expect(container.querySelector('[data-upid-selected="label"]')?.textContent).toBe('Exterior 1');
  });

  it('selects neighboring segments from the inspector selected segment context', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    const segmentRows = [...container.querySelectorAll('[data-upid-segment-row]')];
    const firstSegmentId = segmentRows[0].getAttribute('data-upid-segment-id');
    const secondSegmentId = segmentRows[1].getAttribute('data-upid-segment-id');
    const lastSegmentId = segmentRows[3].getAttribute('data-upid-segment-id');

    await clickElement(`[data-upid-segment-row][data-upid-segment-id="${firstSegmentId}"]`);

    expect(container.querySelector('[data-upid-selected-segment]')?.getAttribute('data-upid-selected-segment-id')).toBe(
      firstSegmentId
    );
    expect(container.querySelector('[data-upid-selected-segment="sequence-neighbors"]')?.textContent).toContain(
      '1.'
    );

    await clickElement('button[aria-label="Select next segment 2 in Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-segment]')?.getAttribute('data-upid-selected-segment-id')).toBe(
      secondSegmentId
    );

    await clickElement('button[aria-label="Select previous segment 1 in Exterior 1"]');
    await clickElement('button[aria-label="Select previous segment 4 in Exterior 1"]');

    expect(container.querySelector('[data-upid-selected-segment]')?.getAttribute('data-upid-selected-segment-id')).toBe(
      lastSegmentId
    );
  });

  it('reveals collapsed contour groups when selecting path geometry on canvas', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    const firstSegmentRow = container.querySelector('[data-upid-segment-row]');
    const segmentId = firstSegmentRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    await clickElement('button[aria-label="Collapse Exterior 1"]');
    const contourGroup = container.querySelector('[data-upid-contour-group="contour_0001"]');
    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('false');
    expect(container.querySelector('[data-upid-segment-stack]')).toBeNull();

    await clickElement(
      `svg[aria-label="UPID path preview"] path[data-preview-source="path-document"][data-preview-segment="${segmentId}"]`
    );

    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('true');
    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${segmentId}"]`)
        ?.getAttribute('data-upid-selected')
    ).toBe('true');
  });

  it('temporarily reveals collapsed contour groups while canvas hover assist targets geometry', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    const firstSegmentRow = container.querySelector('[data-upid-segment-row]');
    const segmentId = firstSegmentRow?.getAttribute('data-upid-segment-id');
    expect(segmentId).toBeTruthy();

    await clickElement('input[aria-label="Toggle canvas hover assist"]');
    await clickElement('button[aria-label="Collapse Exterior 1"]');
    const contourGroup = container.querySelector('[data-upid-contour-group="contour_0001"]');
    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('false');
    expect(container.querySelector('[data-upid-segment-stack]')).toBeNull();

    const previewSelector = `svg[aria-label="UPID path preview"] path[data-preview-source="path-document"][data-preview-segment="${segmentId}"]`;
    await dispatchMouseEvent(previewSelector, 'mouseover');

    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('true');
    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${segmentId}"]`)
        ?.getAttribute('data-upid-hovered')
    ).toBe('true');

    await dispatchMouseEvent(previewSelector, 'mouseout');

    expect(contourGroup?.getAttribute('data-upid-expanded')).toBe('false');
    expect(container.querySelector('[data-upid-segment-stack]')).toBeNull();
  });

  async function clickElement(selector: string) {
    const element = container.querySelector(selector) as HTMLElement | null;
    expect(element).not.toBeNull();

    await act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
  }

  async function dispatchMouseEvent(selector: string, type: 'mouseover' | 'mouseout') {
    const element = container.querySelector(selector) as HTMLElement | null;
    expect(element).not.toBeNull();

    await act(async () => {
      element?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    });
    await flushAsync();
  }

  function expectContourExpanded(pathElementId: string, expanded: boolean) {
    expect(
      container
        .querySelector(`[data-upid-contour-group="${pathElementId}"]`)
        ?.getAttribute('data-upid-expanded')
    ).toBe(expanded ? 'true' : 'false');
  }
});

function EditorPageHarness({
  onSaveEditorDraft,
  project
}: {
  onSaveEditorDraft: (draft: EditorSaveDraft) => void;
  project: WorkbenchProject;
}) {
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [railContent, setRailContent] = useState<AppRailContent | null>(null);

  return (
    <AppRailProvider value={{ setHeaderContent, setRailContent }}>
      <div>{headerContent}</div>
      <aside data-test-editor-project-rail>{railContent?.expanded}</aside>
      <EditorPage
        importErrorMessage={null}
        importStatus="idle"
        onBackToDashboard={noop}
        onDownloadEditorFile={noop}
        onImportProgramFile={noop}
        onSaveEditorDraft={onSaveEditorDraft}
        program={{
          filePath: 'imports/rectangle.dxf',
          model: 'upid-document',
          parseResult: null,
          pathDocument: project.upid!.document,
          project,
          text: ''
        }}
        saveErrorMessage={null}
        saveStatus="idle"
      />
    </AppRailProvider>
  );
}

function projectWithUpid(pathDocument: PathPlanningDocument) {
  const project = createWorkbenchProject({
    id: 'rectangle-2026-05-31',
    name: 'rectangle',
    now: new Date('2026-05-31T12:00:00.000Z'),
    sourceKind: 'dxf'
  });

  project.source.files = [
    {
      createdAt: project.createdAt,
      kind: 'dxf',
      name: 'rectangle.dxf',
      path: 'imports/rectangle.dxf'
    }
  ];

  return withProjectUpid(project, pathDocument);
}

function pathDocumentFromRectangle() {
  return dxfEntitiesToUpidDocument(parseDxf(rectangleDxf()).entities);
}

function pathDocumentFromNestedRectangles() {
  return dxfEntitiesToUpidDocument(parseDxf(nestedRectangleDxf()).entities);
}

function pathDocumentFromIndependentRectangles() {
  return dxfEntitiesToUpidDocument(parseDxf(independentRectangleDxf()).entities);
}

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

function nestedRectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...closedLwPolylineDxf(0, 0, 20, 20),
    ...closedLwPolylineDxf(5, 5, 10, 10),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function independentRectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...closedLwPolylineDxf(0, 0, 5, 5),
    ...closedLwPolylineDxf(20, 0, 25, 5),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function closedLwPolylineDxf(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    '0',
    'LWPOLYLINE',
    '90',
    '4',
    '70',
    '1',
    '10',
    String(minX),
    '20',
    String(minY),
    '10',
    String(maxX),
    '20',
    String(minY),
    '10',
    String(maxX),
    '20',
    String(maxY),
    '10',
    String(minX),
    '20',
    String(maxY)
  ];
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
