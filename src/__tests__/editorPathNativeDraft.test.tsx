import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRailProvider, type AppRailContent } from '@/app/AppRailContext';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import {
  setCircleOperationCenterPierceLeadIn,
  setClosedOperationStartNearPoint
} from '@/domain/path-editor/pathDocumentOperations';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import { composeProjectUpidGCodeExport, withProjectUpid } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { EditorPage } from '@/features/editor/EditorPage';
import { EditorUpidExportPreview } from '@/features/editor/EditorUpidExportPreview';

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
    expect(
      container.querySelector('button[aria-label="Undo active document change"]')
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Redo active document change"]')
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="Save active document"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Open Path Project export preview"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain('Saved');

    await clickElement('button[aria-label="Open Path Project export preview"]');
    expect(container.querySelector('[data-upid-export-preview]')).not.toBeNull();
  });

  it('suppresses inconsistent posted cuts at the blocked preview boundary', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    const pathDocument = project.upid!.document;
    const readyExport = composeProjectUpidGCodeExport(project, pathDocument);
    const blockingDiagnostic = {
      id: 'blocked-preview-contract',
      severity: 'error',
      code: 'branching-topology',
      message: 'Unsafe branch retained only to probe the preview safety boundary.',
      relatedSegmentIds: [pathDocument.segments[0].id]
    } satisfies PathDiagnostic;
    const onDownload = vi.fn();

    expect(readyExport.programOperations.length).toBeGreaterThan(0);
    expect(readyExport.program.lines.some((line) => line.section === 'body')).toBe(true);

    await act(async () => {
      root.render(
        <EditorUpidExportPreview
          blockingDiagnostics={[blockingDiagnostic]}
          canDownload={false}
          diagnostics={[blockingDiagnostic]}
          documentTrace={readyExport.documentTrace}
          fileName={readyExport.fileName}
          machineName={readyExport.machineName}
          onClose={vi.fn()}
          onDownload={onDownload}
          operationCount={readyExport.summary.operationCount}
          pathDocument={pathDocument}
          planning={readyExport.planning}
          postMetrics={readyExport.post.metrics}
          postedOperations={readyExport.programOperations}
          programLines={readyExport.program.lines}
        />
      );
    });

    expect(container.querySelector('[data-upid-export-readiness="blocked"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-export-operation-row]')).toBeNull();
    expect(container.querySelector('[data-upid-export-move-row]')).toBeNull();
    expect(container.querySelector('[data-upid-export-stat="operations"]')?.textContent).toBe('0');
    expect(container.querySelector('[data-upid-export-stat="rapid"]')?.textContent).toBe('0');
    expect(container.querySelector('[data-upid-export-stat="cut"]')?.textContent).toBe('0');
    expect(container.querySelector('[data-upid-export-program-section="body"]')).toBeNull();
    expect(container.querySelector('[data-upid-export-program-section="header"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-export-program-section="footer"]')).not.toBeNull();

    const downloadButton = container.querySelector(
      'button[aria-label="Download UPID export program"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDownload).not.toHaveBeenCalled();
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
    const documentState = status?.querySelector('[data-editor-document-state="saved"]');
    expect(status?.getAttribute('role')).toBeNull();
    expect(status?.getAttribute('aria-live')).toBeNull();
    expect(documentState?.getAttribute('role')).toBe('status');
    expect(documentState?.getAttribute('aria-live')).toBe('polite');
    expect(documentState?.getAttribute('aria-atomic')).toBe('true');
    expect(status?.textContent).toContain('Selection None');
    expect(status?.textContent).toContain('Cursor X — Y —');
    expect(status?.textContent).toContain('Moves 5');
    expect(status?.textContent).toContain('Operations 1');
    expect(status?.textContent).toContain('Contours 1');
    expect(status?.textContent).toContain('Segments 4');
    expect(status?.textContent).toContain('Diagnostics 1');
    expect(
      container.querySelector('[data-upid-diagnostic-code="units-assumed-millimeters"]')
    ).not.toBeNull();
    expect(status?.textContent).toContain('Machine Default Wire EDM');
    expect(status?.textContent).toContain('Fit Unchecked');
  });

  it('keeps persistent header undo and redo snapshots aligned with later path selection', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [firstOperation, secondOperation] = pathDocument.plan.operations;

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement(
      `[data-upid-cut-sequence-row][data-upid-operation-id="${firstOperation.id}"] [data-upid-cut-sequence-select]`
    );
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement(
      `[data-upid-cut-sequence-row][data-upid-operation-id="${secondOperation.id}"] [data-upid-cut-sequence-select]`
    );
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${secondOperation.id}`
    );

    await clickElement('button[aria-label="Undo active document change"]');
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${firstOperation.id}`
    );

    await clickElement('button[aria-label="Redo active document change"]');
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${secondOperation.id}`
    );
  });

  it('preserves path selection and undo history when a same-document save result arrives', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [firstOperation, secondOperation] = pathDocument.plan.operations;
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

    await clickElement(
      `[data-upid-cut-sequence-row][data-upid-operation-id="${firstOperation.id}"] [data-upid-cut-sequence-select]`
    );
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement(
      `[data-upid-cut-sequence-row][data-upid-operation-id="${secondOperation.id}"] [data-upid-cut-sequence-select]`
    );
    await clickElement('button[aria-label="Save active document"]');

    const savedDraft = onSaveEditorDraft.mock.calls[0]?.[0] as EditorSaveDraft | undefined;
    expect(savedDraft?.model).toBe('upid-document');
    if (!savedDraft || savedDraft.model !== 'upid-document') {
      throw new Error('Expected a UPID save draft.');
    }
    const savedProject = withProjectUpid(project, savedDraft.pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={onSaveEditorDraft}
          project={savedProject}
        />
      );
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${secondOperation.id}`
    );
    const undoButton = container.querySelector(
      'button[aria-label="Undo active document change"]'
    ) as HTMLButtonElement | null;
    expect(undoButton?.disabled).toBe(false);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${firstOperation.id}`
    );
    expect(container.textContent).toContain('Unsaved');
  });

  it('uses the latest save callback from the persistent header', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    const firstSave = vi.fn();
    const latestSave = vi.fn();

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={firstSave}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-upid-cut-sequence-select]');
    await clickElement('button[aria-label="Reverse path operation"]');

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={latestSave}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Save active document"]');
    expect(firstSave).not.toHaveBeenCalled();
    expect(latestSave).toHaveBeenCalledOnce();
  });

  it('reports Saving and disables every persistent document command while a path save runs', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
          saveStatus="saving"
        />
      );
    });
    await flushAsync();

    const documentState = container.querySelector('[data-editor-document-state="saving"]');
    expect(documentState?.textContent).toBe('Saving');
    for (const ariaLabel of [
      'Save active document',
      'Undo active document change',
      'Redo active document change',
      'Open Path Project export preview'
    ]) {
      expect(
        (container.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
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

    await clickElement('button[aria-label="Save active document"]');

    expect(onSaveEditorDraft).toHaveBeenCalledTimes(1);
    expect(onSaveEditorDraft.mock.calls[0]?.[0]).not.toHaveProperty('text');
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

    await clickElement('button[aria-label="Undo active document change"]');
    expect(container.textContent).not.toContain('Unsaved');
    const saveButton = container.querySelector(
      'button[aria-label="Save active document"]'
    ) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);

    await clickElement('button[aria-label="Redo active document change"]');
    expect(container.textContent).toContain('Unsaved');

    await clickElement('button[aria-label="Save active document"]');

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

  it('keeps contour and segment disclosures independent without changing selection', async () => {
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

    const segmentGroups = [...container.querySelectorAll('[data-upid-segment-group]')];
    const segmentDetailStates = () =>
      [...container.querySelectorAll('[data-upid-segment-group]')].map((group) =>
        group.getAttribute('data-upid-segment-details-expanded')
      );
    expect(segmentGroups).toHaveLength(4);
    expect(segmentDetailStates()).toEqual([
      'false',
      'false',
      'false',
      'false'
    ]);
    expect(container.querySelector('[data-upid-point-row]')).toBeNull();

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('button[aria-label="Expand segment 1 details in Exterior 1"]');

    expect(container.querySelector('[data-upid-contour-row]')?.getAttribute('data-upid-selected')).toBe('true');
    expect(segmentDetailStates()).toEqual([
      'true',
      'false',
      'false',
      'false'
    ]);
    expect(container.querySelectorAll('[data-upid-point-row]')).toHaveLength(2);
    expect(container.querySelector('[data-upid-segment-row][data-upid-selected="true"]')).toBeNull();

    await clickElement('button[aria-label="Collapse entire contour tree"]');
    await clickElement('button[aria-label="Expand entire contour tree"]');

    expect(segmentDetailStates()).toEqual([
      'true',
      'false',
      'false',
      'false'
    ]);
    expect(container.querySelectorAll('[data-upid-point-row]')).toHaveLength(2);
  });

  it('reveals the owning contour and segment details when a canvas endpoint is selected', async () => {
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

    const targetSegmentRow = container.querySelectorAll('[data-upid-segment-row]').item(1);
    const targetSegmentId = targetSegmentRow.getAttribute('data-upid-segment-id');
    expect(targetSegmentId).toBeTruthy();

    await clickElement('button[aria-label="Collapse Exterior 1"]');
    expect(container.querySelector('[data-upid-segment-stack]')).toBeNull();

    await clickElement(
      `svg[aria-label="UPID path preview"] circle[data-preview-path-endpoint][data-preview-segment="${targetSegmentId}"][data-preview-point-role="start"]`
    );

    expectContourExpanded('contour_0001', true);
    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${targetSegmentId}"]`)
        ?.closest('[data-upid-segment-group]')
        ?.getAttribute('data-upid-segment-details-expanded')
    ).toBe('true');
    expect(
      container.querySelector(
        `[data-upid-point-row][data-upid-segment-id="${targetSegmentId}"][data-upid-point-role="start"]`
      )?.getAttribute('data-upid-selected')
    ).toBe('true');

    await clickElement('button[aria-label="Collapse segment 2 details in Exterior 1"]');

    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${targetSegmentId}"]`)
        ?.closest('[data-upid-segment-group]')
        ?.getAttribute('data-upid-segment-details-expanded')
    ).toBe('false');
    expect(
      container.querySelector(
        `[data-upid-point-row][data-upid-segment-id="${targetSegmentId}"][data-upid-point-role="start"]`
      )
    ).toBeNull();
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('start');
  });

  it('projects pointer and keyboard hover for contour, segment, endpoint, and lead-in rows', async () => {
    const project = projectWithUpid(pathDocumentFromCircleWithLeadIn());

    await act(async () => {
      root.render(
        <EditorPageHarness
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();
    await clickElement('button[aria-label="Expand segment 1 details in Exterior 1"]');

    const contourRow = container.querySelector('[data-upid-contour-row]') as HTMLButtonElement | null;
    const segmentRow = container.querySelector('[data-upid-segment-row]') as HTMLButtonElement | null;
    const endpointRow = container.querySelector(
      '[data-upid-point-row][data-upid-point-role="start"]'
    ) as HTMLElement | null;
    const endpointSelect = endpointRow?.querySelector('[data-upid-point-select]') as HTMLButtonElement | null;
    const leadInRow = container.querySelector('[data-upid-tree-row-kind="lead-in"]') as HTMLButtonElement | null;

    expect(contourRow?.getAttribute('aria-label')).toBe('Select Exterior 1');
    expect(segmentRow?.getAttribute('aria-label')).toBe('Select segment 1 in Exterior 1');
    expect(endpointSelect?.getAttribute('aria-label')).toBe('Select start endpoint of segment 1 in Exterior 1');
    expect(leadInRow?.getAttribute('aria-label')).toBe('Select lead-in for Exterior 1');

    for (const [row, focusTarget] of [
      [contourRow, contourRow],
      [segmentRow, segmentRow],
      [endpointRow, endpointSelect],
      [leadInRow, leadInRow]
    ] as const) {
      expect(row).not.toBeNull();
      expect(focusTarget).not.toBeNull();

      await act(async () => {
        row?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      });
      expect(row?.getAttribute('data-upid-hovered')).toBe('true');

      await act(async () => {
        row?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      });
      expect(row?.getAttribute('data-upid-hovered')).not.toBe('true');

      await act(async () => {
        focusTarget?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      });
      expect(row?.getAttribute('data-upid-hovered')).toBe('true');

      await act(async () => {
        focusTarget?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      });
      expect(row?.getAttribute('data-upid-hovered')).not.toBe('true');
    }
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
    expect(firstSegmentRow?.querySelector('[data-upid-segment-field="length"]')).toBeNull();
    await clickElement('button[aria-label^="Expand segment 1 details in "]');
    expect(container.querySelector('[data-upid-segment-group] [data-upid-segment-field="length"]')?.textContent).toContain(
      '10.000'
    );

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('button[aria-label="Reverse path operation"]');

    const reversedFirstSegmentRow = container.querySelector(
      `[data-upid-segment-row][data-upid-segment-id="${firstSegmentId}"]`
    ) as HTMLElement | null;

    expect(reversedFirstSegmentRow?.getAttribute('data-upid-segment-length')).toBe('10.000');
    expect(reversedFirstSegmentRow?.getAttribute('data-upid-segment-reversed')).toBe('true');
    const reversedGroup = reversedFirstSegmentRow?.closest('[data-upid-segment-group]');
    const reversedDisclosure = reversedGroup?.querySelector<HTMLButtonElement>('button[aria-label^="Expand segment "]');
    if (reversedDisclosure) {
      await act(async () => reversedDisclosure.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await flushAsync();
    }
    expect(reversedGroup?.querySelector('[data-upid-segment-field="length"]')?.textContent).toContain('10.000');
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

    for (const disclosure of container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Expand segment "][aria-label$=" details in Exterior 1"]'
    )) {
      await act(async () => disclosure.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
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

    const selectedSegmentId = affectedRefs[1].getAttribute('data-upid-diagnostic-ref-segment');
    const selectedPointRole = affectedRefs[1].getAttribute('data-upid-diagnostic-ref-point-role');
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('start');
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '10.004, 0.000'
    );
    expect(
      container
        .querySelector(`[data-upid-segment-row][data-upid-segment-id="${selectedSegmentId}"]`)
        ?.closest('[data-upid-segment-group]')
        ?.getAttribute('data-upid-segment-details-expanded')
    ).toBe('true');
    expect(
      container.querySelector(
        `[data-upid-point-row][data-upid-segment-id="${selectedSegmentId}"][data-upid-point-role="${selectedPointRole}"]`
      )?.getAttribute('data-upid-selected')
    ).toBe('true');
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

    for (const disclosure of container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label^="Expand segment "][aria-label$=" details in Exterior 1"]'
    )) {
      await act(async () => disclosure.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    }
    await flushAsync();

    const contourRow = container.querySelector('[data-upid-contour-row]') as HTMLElement | null;
    const segmentRows = [...container.querySelectorAll('[data-upid-segment-row]')] as HTMLElement[];
    const pointRows = [...container.querySelectorAll('[data-upid-point-row]')] as HTMLElement[];

    expect(contourRow?.getAttribute('data-upid-contour-diagnostics')).toBe('2');
    expect(contourRow?.getAttribute('data-upid-contour-diagnostic-codes')).toBe(
      'endpoint-cluster-snap closed-chain-gap'
    );
    expect(contourRow?.getAttribute('data-upid-contour-diagnostic-severity')).toBe('warning');
    expect(contourRow?.textContent).toContain('2 issues');
    expect(contourRow?.textContent).not.toContain('endpoint-cluster-snap');
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
    await clickElement('button[aria-label^="Expand segment 1 details in "]');
    expect(container.querySelector('[data-upid-segment-group]')?.textContent).toContain(
      'R 10.000 / sweep 90.000 deg / ccw'
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
  project,
  saveStatus = 'idle'
}: {
  onBackToDashboard?: () => void;
  onSaveEditorDraft: (draft: EditorSaveDraft) => void;
  project: WorkbenchProject;
  saveStatus?: 'error' | 'idle' | 'saving';
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
        saveStatus={saveStatus}
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

function pathDocumentFromCircleWithLeadIn() {
  const document = dxfEntitiesToUpidDocument(parseDxf(circleDxf()).entities);
  const edited = setCircleOperationCenterPierceLeadIn(document, document.plan.operations[0].id);
  if (!edited) throw new Error('Expected the circle fixture to accept a center pierce lead-in.');
  return edited;
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

function circleDxf() {
  return [
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    '0',
    'CIRCLE',
    '8',
    'CUT',
    '10',
    '0',
    '20',
    '0',
    '40',
    '10',
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
