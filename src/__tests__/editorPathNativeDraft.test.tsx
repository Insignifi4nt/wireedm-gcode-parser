import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRailProvider, type AppRailContent } from '@/app/AppRailContext';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import { setClosedOperationStartNearPoint } from '@/domain/path-editor/pathDocumentOperations';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { withProjectUpid } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { EditorPage } from '@/features/editor/EditorPage';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;
let autoOpenedPanelToolbars = new WeakSet<Element>();

describe('EditorPage UPID draft boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    autoOpenedPanelToolbars = new WeakSet<Element>();
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('identifies a loaded UPID draft as a path project with persistent primary commands', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-context="path-project"]')).not.toBeNull();
    expect(container.textContent).toContain('Path Project');
    expect(container.querySelector('button[aria-label="Save active document"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Open Path Project export preview"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain('Saved');
  });

  it('keeps technical path status visible without opening an inspector panel', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    const status = container.querySelector('[data-editor-status-bar]');
    expect(status?.textContent).toContain('Selection None');
    expect(status?.textContent).toContain('Cursor X — Y —');
    expect(status?.textContent).toContain('Moves 5');
    expect(status?.textContent).toContain('Operations 1');
    expect(status?.textContent).toContain('Contours 1');
    expect(status?.textContent).toContain('Segments 4');
    expect(status?.textContent).toContain('Diagnostics 0');
    expect(status?.textContent).toContain('Machine Default Wire EDM');
    expect(status?.textContent).toContain('Fit Unchecked');
  });

  it('guards Back only after the active path draft is modified', async () => {
    const onBackToDashboard = vi.fn();
    const confirmDiscard = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          onBackToDashboard={onBackToDashboard}
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Back to Dashboard"]');
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(onBackToDashboard).toHaveBeenCalledOnce();
    onBackToDashboard.mockClear();

    await clickElement('[data-upid-cut-sequence-select]');
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('button[aria-label="Back to Dashboard"]');

    expect(confirmDiscard).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(onBackToDashboard).not.toHaveBeenCalled();

    confirmDiscard.mockReturnValue(true);
    await clickElement('button[aria-label="Back to Dashboard"]');
    expect(onBackToDashboard).toHaveBeenCalledOnce();
  });

  it('guards beforeunload only while the active path draft is modified', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    await clickElement('[data-upid-cut-sequence-select]');
    await clickElement('button[aria-label="Reverse path operation"]');
    const modifiedEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(modifiedEvent);
    expect(modifiedEvent.defaultPrevented).toBe(true);

    await clickElement('button[aria-label="Undo active document change"]');
    const restoredEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(restoredEvent);
    expect(restoredEvent.defaultPrevented).toBe(false);
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

  it('shows segment length and reversible reference direction in segment rows', async () => {
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

    const firstSegmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;
    const firstSegmentId = firstSegmentRow?.getAttribute('data-upid-segment-id');

    expect(firstSegmentRow?.getAttribute('data-upid-segment-length')).toBe('10.000');
    expect(firstSegmentRow?.getAttribute('data-upid-segment-reversed')).toBe('false');
    expect(firstSegmentRow?.querySelector('[data-upid-segment-field="length"]')?.textContent).toContain(
      '10.000 / forward ref'
    );

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('button[aria-label="Reverse path operation"]');

    const reversedFirstSegmentRow = container.querySelector(
      `[data-upid-segment-row][data-upid-segment-id="${firstSegmentId}"]`
    ) as HTMLElement | null;

    expect(reversedFirstSegmentRow?.getAttribute('data-upid-segment-length')).toBe('10.000');
    expect(reversedFirstSegmentRow?.getAttribute('data-upid-segment-reversed')).toBe('true');
    expect(reversedFirstSegmentRow?.querySelector('[data-upid-segment-field="length"]')?.textContent).toContain(
      '10.000 / reversed ref'
    );
  });

  it('shows exact arc geometry in the selected segment inspector', async () => {
    const pathDocument = pathDocumentFromArc();
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

    await clickElement('[data-upid-segment-row]');

    expect(
      container
        .querySelector('[data-upid-selected-segment-geometry]')
        ?.getAttribute('data-upid-selected-segment-geometry')
    ).toBe('arc');
    expect(container.querySelector('[data-upid-selected-segment-geometry="center"]')?.textContent).toBe(
      '0.000, 0.000'
    );
    expect(container.querySelector('[data-upid-selected-segment-geometry="radius"]')?.textContent).toBe(
      '10.000'
    );
    expect(container.querySelector('[data-upid-selected-segment-geometry="sweep"]')?.textContent).toBe(
      '90.000 deg'
    );
    expect(container.querySelector('[data-upid-selected-segment-geometry="orientation"]')?.textContent).toBe(
      'ccw'
    );
  });

  it('shows endpoint cluster snap metadata in the selected point inspector', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
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

    const snappedEndpointRow = [...container.querySelectorAll('[data-upid-point-row]')].find(
      (row) => row.getAttribute('data-upid-point-role') === 'end' && row.textContent?.includes('10.000, 0.000')
    ) as HTMLElement | undefined;
    expect(snappedEndpointRow).not.toBeUndefined();
    expect(snappedEndpointRow?.getAttribute('data-upid-point-cluster-method')).toBe('within-tolerance');
    expect(snappedEndpointRow?.getAttribute('data-upid-point-cluster-members')).toBe('2');
    expect(snappedEndpointRow?.getAttribute('data-upid-point-cluster-gap')).toBe('0.004');
    expect(snappedEndpointRow?.textContent).toContain('cluster within-tolerance / gap 0.004 / 2 ends');

    await act(async () => {
      snappedEndpointRow?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-selected-point-cluster]')?.textContent).toMatch(/^ec_/);
    expect(container.querySelector('[data-upid-selected-point-cluster-method]')?.textContent).toBe(
      'within-tolerance'
    );
    expect(container.querySelector('[data-upid-selected-point-cluster-members]')?.textContent).toBe('2');
    expect(container.querySelector('[data-upid-selected-point-cluster-radius]')?.textContent).toBe('0.002');
    expect(container.querySelector('[data-upid-selected-point-cluster-gap]')?.textContent).toBe('0.004');

    const clusterMembers = [
      ...container.querySelectorAll('[data-upid-selected-point-cluster-member]')
    ] as HTMLElement[];
    expect(clusterMembers).toHaveLength(2);
    expect(clusterMembers.map((member) => member.getAttribute('data-upid-cluster-member-side'))).toEqual([
      'end',
      'start'
    ]);

    await act(async () => {
      clusterMembers[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('start');
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '10.004, 0.000'
    );
  });

  it('shows endpoint topology summary in the path navigator header', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
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

    const topologySummary = container.querySelector('[data-upid-topology-summary]') as HTMLElement | null;

    expect(topologySummary).not.toBeNull();
    expect(topologySummary?.getAttribute('data-upid-topology-clusters')).toBe('4');
    expect(topologySummary?.getAttribute('data-upid-topology-snapped')).toBe('1');
    expect(topologySummary?.getAttribute('data-upid-topology-snapped-endpoints')).toBe('2');
    expect(topologySummary?.getAttribute('data-upid-topology-ambiguous')).toBe('0');
    expect(topologySummary?.getAttribute('data-upid-topology-max-gap')).toBe('0.004');
    expect(topologySummary?.textContent).toContain('Topology: 4 clusters / snapped 1 / max gap 0.004');
  });

  it('shows projected diagnostics in the path navigator', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
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

    const diagnosticRow = container.querySelector(
      '[data-upid-diagnostic-row][data-upid-diagnostic-code="endpoint-cluster-snap"]'
    ) as HTMLElement | null;

    expect(diagnosticRow).not.toBeNull();
    expect(diagnosticRow?.getAttribute('data-upid-diagnostic-related-clusters')).toBe('1');
    expect(diagnosticRow?.getAttribute('data-upid-diagnostic-related-segments')).toBe('2');
    expect(diagnosticRow?.querySelector('[data-upid-diagnostic-metric="maxPairDistance"]')?.textContent).toBe(
      'Max Gap 0.004'
    );
    expect(diagnosticRow?.querySelector('[data-upid-diagnostic-metric="tolerance"]')?.textContent).toBe(
      'Tolerance 0.010'
    );

    const affectedRefs = [
      ...(diagnosticRow?.querySelectorAll('[data-upid-diagnostic-ref]') ?? [])
    ] as HTMLElement[];
    expect(affectedRefs).toHaveLength(2);
    expect(affectedRefs[0].getAttribute('data-upid-diagnostic-ref-segment')).toBeTruthy();
    expect(affectedRefs[1].getAttribute('data-upid-diagnostic-ref-segment')).toBeTruthy();

    await act(async () => {
      affectedRefs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('start');
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '10.004, 0.000'
    );
  });

  it('marks path navigator rows with local diagnostic summaries', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
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

    const contourRow = container.querySelector('[data-upid-contour-row]') as HTMLElement | null;
    const segmentRows = [...container.querySelectorAll('[data-upid-segment-row]')] as HTMLElement[];
    const pointRows = [...container.querySelectorAll('[data-upid-point-row]')] as HTMLElement[];

    expect(contourRow?.getAttribute('data-upid-contour-diagnostics')).toBe('2');
    expect(contourRow?.getAttribute('data-upid-contour-diagnostic-codes')).toBe(
      'endpoint-cluster-snap closed-chain-gap'
    );
    expect(contourRow?.getAttribute('data-upid-contour-diagnostic-severity')).toBe('warning');
    expect(contourRow?.textContent).toContain('endpoint-cluster-snap +1');
    expect(segmentRows.map((row) => row.getAttribute('data-upid-segment-diagnostics'))).toEqual([
      '2',
      '2',
      '1',
      '1'
    ]);
    expect(segmentRows[0].getAttribute('data-upid-segment-diagnostic-codes')).toBe(
      'endpoint-cluster-snap closed-chain-gap'
    );
    expect(segmentRows[2].getAttribute('data-upid-segment-diagnostic-codes')).toBe('closed-chain-gap');
    expect(
      pointRows
        .filter((row) => row.getAttribute('data-upid-point-diagnostics') === '1')
        .map((row) => `${row.getAttribute('data-upid-segment-index')}:${row.getAttribute('data-upid-point-role')}`)
    ).toEqual(['0:start', '0:end', '1:start', '3:end']);
    expect(
      pointRows
        .filter((row) => row.getAttribute('data-upid-point-diagnostics') === '1')
        .map((row) => row.getAttribute('data-upid-point-diagnostic-codes'))
    ).toEqual(['closed-chain-gap', 'endpoint-cluster-snap', 'endpoint-cluster-snap', 'closed-chain-gap']);
  });

  it('selects snapped endpoint topology rows from the path navigator', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
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

    const topologyRow = container.querySelector(
      '[data-upid-endpoint-topology-kind="snapped-endpoint-cluster"]'
    ) as HTMLElement | null;

    expect(topologyRow).not.toBeNull();
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-kind')).toBe('snapped-endpoint-cluster');
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-method')).toBe('within-tolerance');
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-members')).toBe('2');
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-gap')).toBe('0.004');
    expect(topologyRow?.textContent).toContain('gap 0.004 / 2 ends');

    await act(async () => {
      topologyRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(topologyRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('end');
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '10.000, 0.000'
    );
    expect(container.querySelector('[data-upid-selected-point-cluster-method]')?.textContent).toBe(
      'within-tolerance'
    );
    expect(container.querySelector('[data-upid-selected-diagnostic-row]')?.textContent).toContain(
      'endpoint-cluster-snap'
    );
    expect(
      container
        .querySelector('[data-upid-selected-diagnostic-row]')
        ?.getAttribute('data-upid-selected-diagnostic-code')
    ).toBe('endpoint-cluster-snap');
    expect(
      container.querySelector('[data-upid-selected-diagnostic-metric="maxPairDistance"]')?.textContent
    ).toBe('Max Gap 0.004');
    expect(
      container.querySelector('[data-upid-selected-diagnostic-metric="tolerance"]')?.textContent
    ).toBe('Tolerance 0.010');

    const snapDiagnosticRow = container.querySelector(
      '[data-upid-selected-diagnostic-row][data-upid-selected-diagnostic-code="endpoint-cluster-snap"]'
    );
    const affectedRefs = [
      ...(snapDiagnosticRow?.querySelectorAll('[data-upid-selected-diagnostic-ref]') ?? [])
    ] as HTMLElement[];
    expect(affectedRefs).toHaveLength(2);
    expect(affectedRefs[0].getAttribute('data-upid-selected-diagnostic-ref-segment')).toBeTruthy();
    expect(affectedRefs[1].getAttribute('data-upid-selected-diagnostic-ref-segment')).toBeTruthy();

    await act(async () => {
      affectedRefs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '10.004, 0.000'
    );
  });

  it('selects ambiguous endpoint topology rows from the path navigator', async () => {
    const pathDocument = pathDocumentFromAmbiguousEndpoints();
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

    const topologyRow = container.querySelector(
      '[data-upid-endpoint-topology-kind="ambiguous-endpoint-cluster"]'
    ) as HTMLElement | null;

    expect(topologyRow).not.toBeNull();
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-kind')).toBe('ambiguous-endpoint-cluster');
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-candidates')).toBe('1');
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-related-segments')).toBe('2');
    expect(topologyRow?.getAttribute('data-upid-endpoint-topology-min-candidate-gap')).toBe('0.009');
    expect(topologyRow?.textContent).toContain('ambiguous / candidates 1 / min gap 0.009');

    await act(async () => {
      topologyRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(topologyRow?.getAttribute('data-upid-selected')).toBe('true');
    expect(container.querySelector('[data-upid-selected-segment]')).not.toBeNull();
  });

  it('shows curve geometry metadata in path navigator segment rows', async () => {
    const pathDocument = pathDocumentFromArc();
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

    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLElement | null;

    expect(segmentRow?.getAttribute('data-upid-segment-geometry')).toBe('arc');
    expect(segmentRow?.getAttribute('data-upid-segment-radius')).toBe('10.000');
    expect(segmentRow?.getAttribute('data-upid-segment-sweep')).toBe('90.000');
    expect(segmentRow?.getAttribute('data-upid-segment-orientation')).toBe('ccw');
    expect(segmentRow?.textContent).toContain('R 10.000 / sweep 90.000 deg / ccw');
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

  it('shows structured split provenance for edited UPID segments in the inspector', async () => {
    const baseDocument = pathDocumentFromRectangle();
    const editedDocument = setClosedOperationStartNearPoint(
      baseDocument,
      baseDocument.plan.operations[0].id,
      { x: 5, y: 0 }
    );
    const createdSegmentId = editedDocument?.plan.operations[0].overrides?.start?.createdSegmentIds?.[0];
    const splitEdit = editedDocument?.segments.find((segment) => segment.id === createdSegmentId)?.source.edit;
    const project = projectWithUpid(editedDocument!);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    expect(createdSegmentId).toBeTruthy();
    expect(splitEdit).toMatchObject({
      kind: 'manual-start-split',
      parentSegmentId: expect.any(String),
      point: { x: 5, y: 0 }
    });

    await clickElement(`[data-upid-segment-row][data-upid-segment-id="${createdSegmentId}"]`);

    expect(container.querySelector('[data-upid-selected-segment-source-edit-kind]')?.textContent).toBe(
      'manual-start-split'
    );
    expect(container.querySelector('[data-upid-selected-segment-source-edit-parent]')?.textContent).toBe(
      splitEdit?.parentSegmentId
    );
    expect(container.querySelector('[data-upid-selected-segment-source-edit-point]')?.textContent).toBe(
      '5.000, 0.000'
    );
    expect(container.querySelector('[data-upid-selected="source-edits"]')?.textContent).toBe(
      '1 edit / 2 segments'
    );
    expect(
      container
        .querySelector('[data-upid-contour-row][data-upid-path-element-id="contour_0001"]')
        ?.getAttribute('data-upid-contour-edited-segments')
    ).toBe('2');
    expect(
      container
        .querySelector('[data-upid-cut-sequence-row][data-upid-path-element-id="contour_0001"]')
        ?.getAttribute('data-upid-cut-sequence-edited-segments')
    ).toBe('2');
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
  onBackToDashboard = noop,
  onSaveEditorDraft,
  project
}: {
  onBackToDashboard?: () => void;
  onSaveEditorDraft: (draft: EditorSaveDraft) => void;
  project: WorkbenchProject;
}) {
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [railContent, setRailContent] = useState<AppRailContent | null>(null);

  return (
    <AppRailProvider value={{ setHeaderContent, setRailCollapsed: () => undefined, setRailContent }}>
      <div>{headerContent}</div>
      <aside data-test-editor-project-rail>{railContent?.expanded}</aside>
      <EditorPage
        importErrorMessage={null}
        importStatus="idle"
        onBackToDashboard={onBackToDashboard}
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

function pathDocumentFromGappedRectangle() {
  return dxfEntitiesToUpidDocument(parseDxf(gappedRectangleDxf()).entities, {
    endpointTolerance: 0.01
  });
}

function pathDocumentFromAmbiguousEndpoints() {
  return dxfEntitiesToUpidDocument(parseDxf(ambiguousEndpointsDxf()).entities, {
    endpointTolerance: 0.01
  });
}

function pathDocumentFromArc() {
  return dxfEntitiesToUpidDocument(parseDxf(arcDxf()).entities);
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

function arcDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'ARC',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    '10',
    '50',
    '0',
    '51',
    '90',
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function gappedRectangleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...lineDxf(0, 0, 10, 0),
    ...lineDxf(10.004, 0, 10, 5),
    ...lineDxf(10, 5, 0, 5),
    ...lineDxf(0, 5, 0, 0),
    '0',
    'ENDSEC',
    '0',
    'EOF'
  ].join('\n');
}

function ambiguousEndpointsDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...lineDxf(0, 0, 10, 0),
    ...lineDxf(10.009, 0, 20, 0),
    ...lineDxf(10.018, 0, 30, 0),
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

function lineDxf(startX: number, startY: number, endX: number, endY: number) {
  return [
    '0',
    'LINE',
    '8',
    'CUT',
    '10',
    String(startX),
    '20',
    String(startY),
    '11',
    String(endX),
    '21',
    String(endY)
  ];
}

async function flushAsync() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    openEditorWorkspacePanelsOnce();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function openEditorWorkspacePanelsOnce() {
  for (const toolbar of document.querySelectorAll('[data-editor-panel-toolbar]')) {
    if (autoOpenedPanelToolbars.has(toolbar)) continue;
    autoOpenedPanelToolbars.add(toolbar);

    for (const button of toolbar.querySelectorAll('button[data-editor-panel-menu-item]')) {
      if (button.getAttribute('aria-label')?.startsWith('Show')) {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }
  }
}
