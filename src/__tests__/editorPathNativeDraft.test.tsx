import { act, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRailProvider, type AppRailContent } from '@/app/AppRailContext';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import {
  setCircleOperationCenterPierceLeadIn,
  setManualInitialWirePosition,
  setClosedOperationStartNearPoint,
  setPathOperationClassification,
  translatePathDocument
} from '@/domain/path-editor/pathDocumentOperations';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import {
  createWorkbenchProjectDocument,
  type WorkbenchProjectDocument
} from '@/domain/workbench-catalog/workbenchProject';
import { EditorPage } from '@/features/editor/EditorPage';
import { EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY } from '@/features/editor/workspace/editorWorkspaceLayout';

type TestUpidProject = Omit<WorkbenchProjectDocument, 'source' | 'content'> & {
  readonly source: Extract<WorkbenchProjectDocument['source'], { readonly kind: 'dxf' }>;
  readonly content: {
    readonly kind: 'upid-document';
    readonly document: PathPlanningDocument;
  };
};

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

describe('EditorPage UPID draft boundary', () => {
  let container: HTMLDivElement;
  let originalScrollIntoView: PropertyDescriptor | undefined;
  let root: Root;
  let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView'
    );
    scrollIntoViewSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewSpy
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
    vi.restoreAllMocks();
  });

  it('holds dirty workflow switches and restores the opening draft when discarded', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    expect(visibleWorkflowPanelIds()).toEqual(['path-transform']);
    const openingGeometry = previewGeometrySignature();

    await changeInput('input[aria-label="Translate X"]', '3');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    expect(previewGeometrySignature()).not.toBe(openingGeometry);

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      'before opening Entry / Exit'
    );
    expect(visibleWorkflowPanelIds()).toEqual(['path-transform']);

    await clickElement('button[aria-label="Dismiss workflow transition"]');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(visibleWorkflowPanelIds()).toEqual(['path-transform']);
    expect(previewGeometrySignature()).not.toBe(openingGeometry);

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(visibleWorkflowPanelIds()).toEqual(['entry-exit']);
    expect(previewGeometrySignature()).toBe(openingGeometry);
    expect(
      (container.querySelector(
        'button[aria-label="Undo active document change"]'
      ) as HTMLButtonElement | null)?.disabled
    ).toBe(true);
  });

  it('leaves the active workflow unchanged when Escape was already consumed', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    const escapeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape'
    });
    escapeEvent.preventDefault();
    await act(async () => {
      window.dispatchEvent(escapeEvent);
    });
    await flushAsync();

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(visibleWorkflowPanelIds()).toEqual(['entry-exit']);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps rail actions locked when interaction state changes without a workflow session', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);
    const [operation] = pathDocument.plan.operations;

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();
    await expandProgramTreeItem(`operation:${operation.id}:cut-path`);

    await act(async () => {
      root.render(
        <EditorPageHarness
          interactionLocked
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickProgramTreeButton(
      `operation:${operation.id}:contour-start`,
      'Edit Contour start'
    );

    expect(visibleWorkflowPanelIds()).toEqual([]);
    expect(container.querySelector('[data-set-start-panel]')).toBeNull();
  });

  it('commits several provisional workflow edits as one Undo entry when switching with Save', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    const openingGeometry = previewGeometrySignature();
    await changeInput('input[aria-label="Translate X"]', '2');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    await changeInput('input[aria-label="Translate X"]', '4');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    const savedGeometry = previewGeometrySignature();
    expect(savedGeometry).not.toBe(openingGeometry);

    await clickElement('[data-editor-workflow-command="view.statistics"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    expect(visibleWorkflowPanelIds()).toEqual(['statistics']);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(previewGeometrySignature()).toBe(openingGeometry);
    expect(
      (container.querySelector(
        'button[aria-label="Undo active document change"]'
      ) as HTMLButtonElement | null)?.disabled
    ).toBe(true);
    expect(previewGeometrySignature()).not.toBe(savedGeometry);
  });

  it('blocks project persistence until provisional workflow changes are committed', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    const onSaveEditorDraft = vi.fn();

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={onSaveEditorDraft} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await changeInput('input[aria-label="Translate X"]', '3');
    await clickElement('button[aria-label="Apply translation to document geometry"]');

    const projectSave = container.querySelector(
      'button[aria-label="Save active document"]'
    ) as HTMLButtonElement | null;
    expect(projectSave?.disabled).toBe(true);
    expect(projectSave?.title).toBe(
      'Save or discard Transform Geometry before saving the project.'
    );
    await act(async () => projectSave?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSaveEditorDraft).not.toHaveBeenCalled();

    await clickElement('[data-editor-workflow-command="view.statistics"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    const resolvedProjectSave = container.querySelector(
      'button[aria-label="Save active document"]'
    ) as HTMLButtonElement | null;
    expect(resolvedProjectSave?.disabled).toBe(false);
    await clickElement('button[aria-label="Save active document"]');
    expect(onSaveEditorDraft).toHaveBeenCalledOnce();
  });

  it('locks global history during a mutating workflow and discards without leaking Undo or Redo', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const originalGeometry = previewGeometrySignature();
    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await changeInput('input[aria-label="Translate X"]', '2');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    const openingGeometry = previewGeometrySignature();
    expect(openingGeometry).not.toBe(originalGeometry);
    await clickElement('[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Save "]');

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await changeInput('input[aria-label="Translate X"]', '5');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    const provisionalGeometry = previewGeometrySignature();
    expect(provisionalGeometry).not.toBe(openingGeometry);

    const undo = container.querySelector(
      'button[aria-label="Undo active document change"]'
    ) as HTMLButtonElement | null;
    const redo = container.querySelector(
      'button[aria-label="Redo active document change"]'
    ) as HTMLButtonElement | null;
    expect(undo?.disabled).toBe(true);
    expect(redo?.disabled).toBe(true);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'z' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'y' }));
    });
    expect(previewGeometrySignature()).toBe(provisionalGeometry);

    await clickElement('button[aria-label="Hide Transform"]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    expect(visibleWorkflowPanelIds()).toEqual([]);
    expect(previewGeometrySignature()).toBe(openingGeometry);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(previewGeometrySignature()).toBe(originalGeometry);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'y' }));
    });
    await flushAsync();
    expect(previewGeometrySignature()).toBe(openingGeometry);
    expect(previewGeometrySignature()).not.toBe(provisionalGeometry);
  });

  it('routes dirty panel X through Save and creates exactly one history entry', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const openingGeometry = previewGeometrySignature();
    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await changeInput('input[aria-label="Translate X"]', '2');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    await changeInput('input[aria-label="Translate X"]', '4');
    await clickElement('button[aria-label="Apply translation to document geometry"]');

    await clickElement('button[aria-label="Hide Transform"]');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('before closing it');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    expect(visibleWorkflowPanelIds()).toEqual([]);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(previewGeometrySignature()).toBe(openingGeometry);
    expect(
      (container.querySelector(
        'button[aria-label="Undo active document change"]'
      ) as HTMLButtonElement | null)?.disabled
    ).toBe(true);
  });

  it.each([
    'geometry.setup', 'geometry.transform', 'machining.contour-setup', 'machining.set-start',
    'machining.sequence', 'machining.initial-wire', 'machining.entry-exit',
    'machining.between-contours', 'machining.program-stops', 'machining.participation',
    'construction.measurement'
  ])('saves and preserves an independent %s workflow mutation', async (commandId) => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    let contourSignatureAfter = '';
    let setStartSignatureAfter = '';
    let transformSignatureAfter = '';
    const workflows: Array<{
      assertPreserved: () => void;
      commandId: string;
      mutate: () => Promise<void>;
    }> = [
      {
        commandId: 'geometry.setup',
        mutate: async () => changeSelect(
          container.querySelector('select[aria-label="Geometry basis"]'),
          'finished-contour'
        ),
        assertPreserved: () => expect(
          (container.querySelector('select[aria-label="Geometry basis"]') as HTMLSelectElement).value
        ).toBe('finished-contour')
      },
      {
        commandId: 'geometry.transform',
        mutate: async () => {
          await changeInput('input[aria-label="Translate X"]', '1');
          await clickElement('button[aria-label="Apply translation to document geometry"]');
          transformSignatureAfter = previewGeometrySignature();
        },
        assertPreserved: () => expect(previewGeometrySignature()).toBe(transformSignatureAfter)
      },
      {
        commandId: 'machining.contour-setup',
        mutate: async () => {
          await clickElement('button[aria-label="Reverse path operation"]');
          contourSignatureAfter = previewGeometrySignature();
        },
        assertPreserved: () => expect(previewGeometrySignature()).toBe(contourSignatureAfter)
      },
      {
        commandId: 'machining.set-start',
        mutate: async () => {
          await clickElement('button[aria-label="Pick explicit contour start"]');
          const endpoints = [...container.querySelectorAll<SVGCircleElement>(
            'circle[data-preview-path-endpoint]'
          )].filter((endpoint) => endpoint.getAttribute('aria-disabled') !== 'true');
          expect(endpoints.length).toBeGreaterThan(1);
          await act(async () => endpoints[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
          await flushAsync();
          setStartSignatureAfter = previewGeometrySignature();
        },
        assertPreserved: () => expect(previewGeometrySignature()).toBe(setStartSignatureAfter)
      },
      {
        commandId: 'machining.sequence',
        mutate: async () => changeSelect(
          container.querySelector('select[aria-label="Planning order strategy"]'),
          'source-order'
        ),
        assertPreserved: () => expect(
          (container.querySelector('select[aria-label="Planning order strategy"]') as HTMLSelectElement).value
        ).toBe('source-order')
      },
      {
        commandId: 'machining.initial-wire',
        mutate: async () => {
          await changeInput('input[aria-label="Initial wire X"]', '3');
          await changeInput('input[aria-label="Initial wire Y"]', '4');
          await clickElement('button[aria-label="Review and set manual initial wire position"]');
        },
        assertPreserved: () => expect(
          container.querySelector('[data-initial-wire-position-preview]')?.textContent
        ).toBe('X3.000 Y4.000')
      },
      {
        commandId: 'machining.entry-exit',
        mutate: async () => {
          await changeInput('input[aria-label="Entry X"]', '-2');
          await changeInput('input[aria-label="Entry Y"]', '0');
          await clickElement('button[aria-label="Set straight entry"]');
        },
        assertPreserved: () => expect(
          container.querySelector('[data-entry-strategy]')?.textContent
        ).toContain('Reviewed straight entry')
      },
      {
        commandId: 'machining.between-contours',
        mutate: async () => {
          const destination = container.querySelector(
            'select[aria-label="Between contours destination operation"]'
          ) as HTMLSelectElement;
          await changeSelect(destination, destination.options[1].value);
          await changeSelect(
            container.querySelector('select[aria-label="Project threading default"]'),
            'automatic'
          );
        },
        assertPreserved: () => expect(
          (container.querySelector('select[aria-label="Project threading default"]') as HTMLSelectElement).value
        ).toBe('automatic')
      },
      {
        commandId: 'machining.program-stops',
        mutate: async () => {
          const add = [...container.querySelectorAll<HTMLButtonElement>('[data-program-stops-panel] button')]
            .find((button) => button.textContent?.trim() === 'Add program stop');
          expect(add).not.toBeUndefined();
          await act(async () => add?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
          await flushAsync();
        },
        assertPreserved: () => expect(container.querySelector('[data-program-stops-panel]')?.textContent)
          .toContain('Stop with 1.000 mm remaining')
      },
      {
        commandId: 'machining.participation',
        mutate: async () => {
          const markInactive = [...container.querySelectorAll<HTMLButtonElement>(
            '[data-machining-participation-panel] button'
          )].find((button) => button.textContent?.trim() === 'Mark inactive reference');
          expect(markInactive).not.toBeUndefined();
          await act(async () => markInactive?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
          await flushAsync();
        },
        assertPreserved: () => expect(
          container.querySelector('[data-machining-participation-panel]')?.textContent
        ).toContain('0..1 · inactive-reference')
      },
      {
        commandId: 'construction.measurement',
        mutate: async () => {
          await changeInput('input[aria-label="Measurement point X"]', '8');
          await changeInput('input[aria-label="Measurement point Y"]', '9');
          const add = [...container.querySelectorAll<HTMLButtonElement>(
            '[data-editor-workspace-panel="measurement"] button'
          )].find((button) => button.textContent?.trim() === 'Add Point');
          expect(add).not.toBeUndefined();
          await act(async () => add?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
          await flushAsync();
        },
        assertPreserved: () => expect(container.querySelector('[data-measurement-point-row="1"]'))
          .not.toBeNull()
      }
    ];

    const workflow = workflows.find((candidate) => candidate.commandId === commandId);
    if (!workflow) throw new Error(`Missing mutation scenario for ${commandId}`);
    await clickElement(`[data-editor-workflow-command="${workflow.commandId}"]`);
    await workflow.mutate();
    const save = container.querySelector(
      `[data-editor-workflow-actions="${workflow.commandId}"] button[aria-label^="Save "]`
    ) as HTMLButtonElement | null;
    expect(save?.disabled, workflow.commandId).toBe(false);
    await clickElement(
      `[data-editor-workflow-actions="${workflow.commandId}"] button[aria-label^="Save "]`
    );
    expect(visibleWorkflowPanelIds(), workflow.commandId).toEqual([]);
    await clickElement(`[data-editor-workflow-command="${workflow.commandId}"]`);
    workflow.assertPreserved();
    await clickElement(
      `[data-editor-workflow-actions="${workflow.commandId}"] button[aria-label^="Cancel "]`
    );
    if (commandId === 'construction.measurement') {
      await clickElement('button[aria-label="Undo active document change"]');
      expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
      await clickElement('button[aria-label="Redo active document change"]');
      await clickElement('[data-editor-workflow-command="construction.measurement"]');
      expect(container.querySelector('[data-measurement-point-row="1"]')).not.toBeNull();
    }
  });

  it('toggles preview grid snapping in Construction points', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();
    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    const snap = () => container.querySelector('button[aria-label="Toggle preview grid snap"]');
    expect(snap()?.getAttribute('aria-pressed')).toBe('false');
    await clickElement('button[aria-label="Toggle preview grid snap"]');
    expect(snap()?.getAttribute('aria-pressed')).toBe('true');
    await clickElement('button[aria-label="Toggle preview grid snap"]');
    expect(snap()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('rerenders Measurement and Construction controls without missing-key warnings', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await act(async () => {
        root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
      });
      await flushAsync();

      await clickElement('[data-editor-workflow-command="construction.measurement"]');
      await changeInput('input[aria-label="Measurement point X"]', '3');
      await changeInput('input[aria-label="Measurement point Y"]', '4');
      const addPoint = [...container.querySelectorAll<HTMLButtonElement>(
        '[data-editor-workspace-panel="measurement"] button'
      )].find((button) => button.textContent?.trim() === 'Add Point');
      expect(addPoint).not.toBeUndefined();
      await act(async () => addPoint?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await flushAsync();

      expect(
        consoleError.mock.calls.some(([message]) =>
          String(message).includes('Each child in a list should have a unique "key" prop.')
        )
      ).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('uses explicit Construction modes without a second magnetic-snap toggle', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    expect(container.querySelector(
      'button[aria-label="Magnetize latest point perpendicular"]'
    )).not.toBeNull();
    expect(container.querySelector(
      'button[aria-label="Magnetize latest point tangent"]'
    )).not.toBeNull();
    expect(container.querySelector(
      'input[aria-label="Toggle construction magnetic snap"]'
    )).toBeNull();
  });

  it('does not quantize Transform canvas drag with the saved Construction grid preference', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await clickElement('button[aria-label="Toggle preview grid snap"]');
    await clickElement('[data-editor-workflow-actions="construction.measurement"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="geometry.transform"]');

    const preview = container.querySelector(
      'svg[aria-label="UPID path preview"]'
    ) as SVGSVGElement;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 140,
        height: 120,
        left: 10,
        right: 130,
        toJSON: () => ({}),
        top: 20,
        width: 120,
        x: 10,
        y: 20
      })
    });
    const path = container.querySelector(
      'path[data-preview-source="path-document"][data-type="cut"]'
    ) as SVGPathElement;
    const start = previewWorldClientPoint(preview, { x: 0, y: 0 }, 5);
    const end = previewWorldClientPoint(preview, { x: 1, y: 0 }, 5);

    await act(async () => {
      path.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...start }));
      preview.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, ...end }));
      preview.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...end }));
    });
    await flushAsync();

    expect(
      (container.querySelector(
        '[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Save "]'
      ) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('keeps hidden workflow document handlers inert outside their owning workflow', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    expect(container.querySelector('button[aria-label="Reverse path operation"]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('routes workflow-local Cancel through X-stays and Discard restoration', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.setup"]');
    const basis = container.querySelector('select[aria-label="Geometry basis"]') as HTMLSelectElement;
    const basisBefore = basis.value;
    await changeSelect(basis, basisBefore === 'wire-centre' ? 'finished-contour' : 'wire-centre');
    expect(basis.value).not.toBe(basisBefore);

    await clickElement('button[aria-label="Cancel Geometry Setup workflow"]');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-editor-workflow-transition-action="stay"]')).toBeNull();

    await clickElement('button[aria-label="Dismiss workflow transition"]');
    expect(visibleWorkflowPanelIds()).toEqual(['geometry-setup']);
    await clickElement('button[aria-label="Cancel Geometry Setup workflow"]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    expect(visibleWorkflowPanelIds()).toEqual([]);
    await clickElement('[data-editor-workflow-command="geometry.setup"]');
    expect(
      (container.querySelector('select[aria-label="Geometry basis"]') as HTMLSelectElement).value
    ).toBe(basisBefore);
  });

  it('discards provisional measurement points and their construction state exactly', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await changeInput('input[aria-label="Measurement point X"]', '2');
    await changeInput('input[aria-label="Measurement point Y"]', '3');
    const addPoint = [...container.querySelectorAll('[data-editor-workspace-panel="measurement"] button')]
      .find((button) => button.textContent?.trim() === 'Add Point');
    expect(addPoint).not.toBeUndefined();
    await act(async () => addPoint?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAsync();
    await clickElement('button[aria-label="Magnetize latest point tangent"]');
    expect(container.querySelector('[data-measurement-point-row="1"]')).not.toBeNull();

    await clickElement('[data-editor-workflow-actions="construction.measurement"] button[aria-label^="Cancel "]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    expect(visibleWorkflowPanelIds()).toEqual([]);
    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="Magnetize latest point tangent"]')
        ?.getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('ends a failed construction pick without leaving an invisible pending mode', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    await act(async () => root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />));
    await flushAsync();
    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await clickElement('button[aria-label="Toggle preview grid snap"]');
    await clickElement('button[aria-label="Magnetize latest point tangent"]');
    const save = () => container.querySelector<HTMLButtonElement>(
      '[data-editor-workflow-actions="construction.measurement"] button[aria-label^="Save "]'
    );
    expect(save()?.disabled).toBe(true);
    const preview = container.querySelector<SVGSVGElement>('svg[aria-label="UPID path preview"]');
    if (!preview) throw new Error('Missing preview');
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 100, height: 100 })
    });
    await act(async () => preview.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 })));
    expect(container.querySelector('button[aria-label="Magnetize latest point tangent"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelectorAll('[data-measurement-point-row]')).toHaveLength(0);
    expect(save()?.disabled).toBe(false);
    await clickElement('[data-editor-workflow-actions="construction.measurement"] button[aria-label^="Save "]');
    expect(visibleWorkflowPanelIds()).toEqual([]);
  });

  it('keeps incomplete measurement input blocking Save across unrelated workflow actions', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await changeInput('input[aria-label="Measurement point X"]', '2');
    const save = () => container.querySelector(
      '[data-editor-workflow-actions="construction.measurement"] button[aria-label^="Save "]'
    ) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'Add a valid point'
    );

    await clickElement('button[aria-label="Toggle preview grid snap"]');
    await clickElement('button[aria-label="Magnetize latest point tangent"]');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    await flushAsync();

    expect(save().disabled).toBe(true);
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'Add a valid point'
    );
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('keeps an incomplete Transform draft blocking Save across another valid transform', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="view.contours"]');
    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    expect(
      (container.querySelector(
        'button[aria-label="Target selection for transform"]'
      ) as HTMLButtonElement).disabled
    ).toBe(false);
    await changeInput('input[aria-label="Translate X"]', '2');
    const save = () => container.querySelector(
      '[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Save "]'
    ) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'pending transform coordinates'
    );
    expect(
      (container.querySelector(
        'button[aria-label="Target selection for transform"]'
      ) as HTMLButtonElement).disabled
    ).toBe(true);

    await clickElement('button[aria-label^="Mirror "][aria-label$=" across X axis"]');
    expect(save().disabled).toBe(true);
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'pending transform coordinates'
    );

    await clickElement('[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Cancel "]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    expect((container.querySelector('input[aria-label="Translate X"]') as HTMLInputElement).value)
      .not.toBe('2');
  });

  it('allows saving after moving the document reference to the origin', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await clickElement('button[aria-label="Use origin as document reference target"]');
    await clickElement('button[aria-label="Move document reference to target"]');

    const save = container.querySelector(
      '[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Save "]'
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    expect(container.querySelector('[data-editor-workflow-save-reason]')).toBeNull();
  });

  it('does not clear one pending form when another action in the workflow succeeds', async () => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await changeInput('input[aria-label="Exit X"]', '2');
    await changeInput('input[aria-label="Entry X"]', '-2');
    await changeInput('input[aria-label="Entry Y"]', '0');
    const setEntry = [...container.querySelectorAll<HTMLButtonElement>('[data-entry-exit-panel] button')]
      .find((button) => button.textContent?.trim() === 'Set straight entry');
    expect(setEntry).not.toBeUndefined();
    await act(async () => setEntry?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAsync();
    expect(
      (container.querySelector(
        '[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]'
      ) as HTMLButtonElement).disabled
    ).toBe(true);

    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Cancel "]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    await clickElement('[data-editor-workflow-command="machining.participation"]');
    const markInactive = [...container.querySelectorAll<HTMLButtonElement>(
      '[data-machining-participation-panel] button'
    )].find((button) => button.textContent?.trim() === 'Mark inactive reference');
    await act(async () => markInactive?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAsync();
    await clickElement('[data-editor-workflow-actions="machining.participation"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="machining.participation"]');
    await changeInput('input[aria-label="Machining span start"]', '0.2');
    const secondOperation = project.content.document.plan.operations[1];
    await clickElement(
      `path[data-preview-source="path-document"][data-preview-operation="${secondOperation.id}"][data-type="cut"]`
    );
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).not.toContain(
      `Selection Operation ${secondOperation.id}`
    );
    const restore = [...container.querySelectorAll<HTMLButtonElement>(
      '[data-machining-participation-panel] button'
    )].find((button) => button.textContent?.trim() === 'Restore');
    await act(async () => restore?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAsync();
    expect(
      (container.querySelector(
        '[data-editor-workflow-actions="machining.participation"] button[aria-label^="Save "]'
      ) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('locks Entry Exit and Program Stops targets while their local forms are pending', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [firstOperation, secondOperation] = pathDocument.plan.operations;

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    const entryTarget = container.querySelector(
      'select[aria-label="Entry and exit operation"]'
    ) as HTMLSelectElement;
    expect(entryTarget.value).toBe(firstOperation.id);
    await changeInput('input[aria-label="Entry X"]', '-2');
    expect(entryTarget.disabled).toBe(true);
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'target contour'
    );

    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Cancel "]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    await clickElement('[data-editor-workflow-command="machining.program-stops"]');
    await changeInput('input[aria-label="Program stop note"]', 'keep this target');
    await clickElement(
      `path[data-preview-source="path-document"][data-preview-operation="${secondOperation.id}"]`
    );

    expect(container.querySelector('[data-editor-status-bar]')?.textContent).not.toContain(
      `Selection Operation ${secondOperation.id}`
    );
    expect(container.querySelector('[data-program-stops-panel]')?.textContent).toContain(
      firstOperation.displayName
    );
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'target contour'
    );
  });

  it('owns canvas entry picking, locks its operation target, and discards the provisional lead', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [firstOperation, secondOperation] = pathDocument.plan.operations;

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    const operationTarget = container.querySelector(
      'select[aria-label="Entry and exit operation"]'
    ) as HTMLSelectElement;
    expect(operationTarget.value).toBe(firstOperation.id);

    await clickElement('button[aria-label="Pick entry point on canvas"]');
    expect(operationTarget.disabled).toBe(true);
    expect(
      container.querySelector('button[aria-label="Pick entry point on canvas"]')?.getAttribute('aria-pressed')
    ).toBe('true');

    const preview = container.querySelector('svg[aria-label="UPID path preview"]') as SVGSVGElement;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 140,
        height: 120,
        left: 10,
        right: 130,
        toJSON: () => ({}),
        top: 20,
        width: 120,
        x: 10,
        y: 20
      })
    });
    const secondOperationPath = container.querySelector(
      `path[data-preview-source="path-document"][data-preview-operation="${secondOperation.id}"][data-type="cut"]`
    ) as SVGPathElement;
    const pickedPoint = previewWorldClientPoint(preview, { x: 22, y: 2 }, 5);

    await act(async () => {
      preview.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...pickedPoint }));
    });
    await flushAsync();
    expect(container.querySelector('[data-upid-construction-relation="perpendicular"]')).not.toBeNull();

    await act(async () => {
      secondOperationPath.dispatchEvent(new MouseEvent('click', { bubbles: true, ...pickedPoint }));
    });
    await flushAsync();

    expect(operationTarget.value).toBe(firstOperation.id);
    expect(operationTarget.disabled).toBe(false);
    expect((container.querySelector('input[aria-label="Entry X"]') as HTMLInputElement).value).toBe('0');
    expect((container.querySelector('input[aria-label="Entry Y"]') as HTMLInputElement).value).toBe('2');
    expect(container.querySelector(
      `path[data-preview-travel="lead-in"][data-preview-operation="${firstOperation.id}"]`
    )).not.toBeNull();
    expect(container.querySelector(
      `path[data-preview-travel="lead-in"][data-preview-operation="${secondOperation.id}"]`
    )).toBeNull();

    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Cancel "]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    expect(container.querySelector('path[data-preview-travel="lead-in"]')).toBeNull();
  });

  it('cancels canvas exit picking with Escape without mutating the workflow draft', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await clickElement('button[aria-label="Pick exit point on canvas"]');
    expect(
      container.querySelector('button[aria-label="Pick exit point on canvas"]')?.getAttribute('aria-pressed')
    ).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    await flushAsync();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(
      container.querySelector('button[aria-label="Pick exit point on canvas"]')?.getAttribute('aria-pressed')
    ).toBe('false');
    expect(container.querySelector('path[data-preview-travel="lead-out"]')).toBeNull();
    expect(
      (container.querySelector(
        '[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]'
      ) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('clears an active Entry Exit canvas picker when the loaded project identity changes', async () => {
    const firstProject = projectWithUpid(pathDocumentFromIndependentRectangles());
    const replacementProject = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          filePath="imports/first-project.dxf"
          onSaveEditorDraft={vi.fn()}
          project={firstProject}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await clickElement('button[aria-label="Pick entry point on canvas"]');
    expect(container.querySelector('[data-editor-command-hint]')?.textContent).toContain(
      'Pick entry'
    );

    await act(async () => {
      root.render(
        <EditorPageHarness
          filePath="imports/replacement-project.dxf"
          onSaveEditorDraft={vi.fn()}
          project={replacementProject}
        />
      );
    });
    await flushAsync();

    expect(visibleWorkflowPanelIds()).toEqual([]);
    expect(container.querySelector('[data-editor-command-hint]')?.textContent ?? '').not.toContain(
      'Pick entry'
    );

    await clickElement('[data-editor-workflow-command="view.contours"]');
    const replacementPath = container.querySelector(
      'path[data-preview-source="path-document"][data-type="cut"]'
    ) as SVGPathElement;
    await act(async () => {
      replacementPath.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
    expect(replacementPath.getAttribute('data-preview-selected')).toBe('true');
  });

  it('clears the Set Start tool session before Escape is handled in a replacement project', async () => {
    const firstProject = projectWithUpid(pathDocumentFromRectangle());
    const replacementProject = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          filePath="imports/set-start-project.dxf"
          onSaveEditorDraft={vi.fn()}
          project={firstProject}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.set-start"]');
    expect(visibleWorkflowPanelIds()).toEqual(['set-start']);

    await act(async () => {
      root.render(
        <EditorPageHarness
          filePath="imports/replacement-construction-project.dxf"
          onSaveEditorDraft={vi.fn()}
          project={replacementProject}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await clickElement('button[aria-label="Place measurement points on canvas"]');
    expect(
      container.querySelector('button[aria-label="Place measurement points on canvas"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    await flushAsync();

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(visibleWorkflowPanelIds()).toEqual(['measurement']);
    expect(
      container.querySelector('button[aria-label="Place measurement points on canvas"]')
        ?.getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('clears project-bound measurement data and coordinate drafts on identity change', async () => {
    const firstProject = projectWithUpid(pathDocumentFromRectangle());
    const replacementProject = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          filePath="imports/project-bound-drafts.dxf"
          onSaveEditorDraft={vi.fn()}
          project={firstProject}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await changeInput('input[aria-label="Translate X"]', '7');
    await changeInput('input[aria-label="Translate Y"]', '8');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    expect((container.querySelector('input[aria-label="Document reference target X"]') as HTMLInputElement).value)
      .toBe('12.000');
    expect((container.querySelector('input[aria-label="Document reference target Y"]') as HTMLInputElement).value)
      .toBe('10.500');
    await clickElement('[data-editor-workflow-actions="geometry.transform"] button[aria-label^="Save "]');

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await changeInput('input[aria-label="Measurement point X"]', '3');
    await changeInput('input[aria-label="Measurement point Y"]', '4');
    const addPoint = [...container.querySelectorAll<HTMLButtonElement>(
      '[data-editor-workspace-panel="measurement"] button'
    )].find((button) => button.textContent?.trim() === 'Add Point');
    expect(addPoint).not.toBeUndefined();
    await act(async () => addPoint?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flushAsync();
    await changeInput('input[aria-label="Measurement point X"]', '9');
    await changeInput('input[aria-label="Measurement point Y"]', '10');

    await act(async () => {
      root.render(
        <EditorPageHarness
          filePath="imports/replacement-clean-drafts.dxf"
          onSaveEditorDraft={vi.fn()}
          project={replacementProject}
        />
      );
    });
    await flushAsync();

    expect(visibleWorkflowPanelIds()).toEqual([]);
    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
    expect((container.querySelector('input[aria-label="Measurement point X"]') as HTMLInputElement).value)
      .toBe('');
    expect((container.querySelector('input[aria-label="Measurement point Y"]') as HTMLInputElement).value)
      .toBe('');
    await clickElement('[data-editor-workflow-actions="construction.measurement"] button[aria-label^="Cancel "]');

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    expect((container.querySelector('input[aria-label="Translate X"]') as HTMLInputElement).value)
      .toBe('0');
    expect((container.querySelector('input[aria-label="Translate Y"]') as HTMLInputElement).value)
      .toBe('0');
    expect((container.querySelector('input[aria-label="Document reference target X"]') as HTMLInputElement).value)
      .not.toBe('12.000');
    expect((container.querySelector('input[aria-label="Document reference target Y"]') as HTMLInputElement).value)
      .not.toBe('10.500');
    expect(container.querySelector('[data-upid-transform-target-center-points]')).toBeNull();
  });

  it('offers only single-workflow diagnostic repair links', async () => {
    const project = projectWithUpid(pathDocumentFromGappedRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.diagnostics"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-diagnostics-repair-workflow]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open Repair Workspace"]')).toBeNull();
    expect(container.querySelector(
      '[data-upid-diagnostic-guidance-action="endpoint-topology"]'
    )).not.toBeNull();
  });

  it('resolves a dirty workflow before Back and lets the warning X cancel the pending action', async () => {
    const onBackToDashboard = vi.fn();
    const confirmDiscard = vi.spyOn(window, 'confirm');
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

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await changeInput('input[aria-label="Translate X"]', '3');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    await clickElement('button[aria-label="Back to Dashboard"]');
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onBackToDashboard).not.toHaveBeenCalled();
    expect(confirmDiscard).not.toHaveBeenCalled();

    await clickElement('button[aria-label="Dismiss workflow transition"]');
    expect(onBackToDashboard).not.toHaveBeenCalled();
    await clickElement('button[aria-label="Back to Dashboard"]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');
    expect(onBackToDashboard).toHaveBeenCalledOnce();
  });

  it('restores a valid opening selection before discarded switch activation', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [firstOperation, secondOperation] = pathDocument.plan.operations;

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.sequence"]');
    await clickElement(
      `[data-upid-cut-sequence-row][data-upid-operation-id="${firstOperation.id}"] [data-upid-cut-sequence-select]`
    );
    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await clickElement(
      `path[data-preview-source="path-document"][data-preview-operation="${secondOperation.id}"]`
    );
    await clickElement('button[aria-label="Target document for transform"]');
    await changeInput('input[aria-label="Translate X"]', '3');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    await clickElement('[data-editor-workflow-command="machining.set-start"]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');

    expect(visibleWorkflowPanelIds()).toEqual(['set-start']);
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${firstOperation.id}`
    );
    expect(container.querySelector('[data-editor-command-hint]')?.textContent ?? '')
      .not.toContain('Contour Start: hover');
  });

  it('activates Set Start with its displayed fallback after discard restores a null selection', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);
    const operation = pathDocument.plan.operations[0];

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    await clickElement('button[aria-label="Target document for transform"]');
    await changeInput('input[aria-label="Translate X"]', '3');
    await clickElement('button[aria-label="Apply translation to document geometry"]');
    await clickElement('[data-editor-workflow-command="machining.set-start"]');
    await clickElement('[data-editor-workflow-transition-action="discard"]');

    expect(visibleWorkflowPanelIds()).toEqual(['set-start']);
    expect(
      (container.querySelector('select[aria-label="Set start operation"]') as HTMLSelectElement | null)
        ?.value
    ).toBe(operation.id);
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${operation.id}`
    );
    expect(container.querySelector('[data-editor-workflow-save-reason]')?.textContent).toContain(
      'automatic start remains active'
    );
    expect(container.querySelector('[data-editor-command-hint]')?.textContent ?? '')
      .not.toContain('Contour Start: hover');
  });

  it('keeps endpoints from non-target contours inert during Set Start', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [targetOperation, otherOperation] = pathDocument.plan.operations;
    const otherSegmentId = otherOperation.segmentRefs[1].segmentId;

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.set-start"]');
    await changeSelect(
      container.querySelector('select[aria-label="Set start operation"]'),
      targetOperation.id
    );
    await clickElement('button[aria-label="Pick explicit contour start"]');

    const otherEndpoint = container.querySelector(
      `circle[data-preview-path-endpoint][data-preview-operation="${otherOperation.id}"][data-preview-segment="${otherSegmentId}"][data-preview-point-role="start"]`
    );
    expect(otherEndpoint).not.toBeNull();

    await act(async () => {
      otherEndpoint?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(otherEndpoint?.getAttribute('aria-disabled')).toBe('true');
    expect(
      (container.querySelector('select[aria-label="Set start operation"]') as HTMLSelectElement | null)
        ?.value
    ).toBe(targetOperation.id);
    expect(container.querySelector('[data-editor-command-hint]')?.textContent).toContain(
      'Contour Start: hover'
    );
    expect(
      container
        .querySelector(`[data-upid-cut-sequence-row][data-upid-operation-id="${otherOperation.id}"]`)
        ?.getAttribute('data-upid-cut-sequence-manual') ?? ''
    ).not.toContain('start');
  });

  it('previews and commits the exact midpoint candidate in Set Start', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const operation = pathDocument.plan.operations[0];
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.set-start"]');
    await changeSelect(
      container.querySelector('select[aria-label="Set start point inference"]'),
      'midpoint'
    );
    await clickElement('button[aria-label="Pick explicit contour start"]');

    const preview = container.querySelector('svg[aria-label="UPID path preview"]') as SVGSVGElement;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 140,
        height: 120,
        left: 10,
        right: 130,
        toJSON: () => ({}),
        top: 20,
        width: 120,
        x: 10,
        y: 20
      })
    });
    const path = container.querySelector(
      `path[data-preview-source="path-document"][data-preview-operation="${operation.id}"][data-type="cut"]`
    ) as SVGPathElement;
    const midpoint = previewWorldClientPoint(preview, { x: 5, y: 4.8 }, 5);

    await act(async () => {
      preview.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...midpoint }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-start-inference="midpoint"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-start-preview-label]')?.textContent).toBe('MIDPOINT');
    const midpointGuide = container.querySelector('[data-upid-start-inference-guide]');
    expect(midpointGuide).not.toBeNull();
    expect(midpointGuide?.getAttribute('stroke-width')).toBe('2.5');

    await act(async () => {
      path.dispatchEvent(new MouseEvent('click', { bubbles: true, ...midpoint }));
    });
    await flushAsync();
    await clickElement(
      '[data-editor-workflow-actions="machining.set-start"] button[aria-label^="Save "]'
    );
    await clickElement('[data-editor-workflow-command="machining.sequence"]');

    expect(
      container
        .querySelector(`[data-upid-cut-sequence-row][data-upid-operation-id="${operation.id}"]`)
        ?.getAttribute('data-upid-cut-sequence-manual')
    ).toContain('start');
  });

  it('previews and commits a perpendicular contour start from the approach source', async () => {
    const pathDocument = setManualInitialWirePosition(
      pathDocumentFromRectangle(),
      { x: 2, y: 2 }
    );
    if (!pathDocument) throw new Error('Expected an initial wire position.');
    const operation = pathDocument.plan.operations[0];
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.set-start"]');
    await changeSelect(
      container.querySelector('select[aria-label="Set start point inference"]'),
      'perpendicular'
    );
    await clickElement('button[aria-label="Pick explicit contour start"]');

    const preview = container.querySelector('svg[aria-label="UPID path preview"]') as SVGSVGElement;
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        bottom: 140,
        height: 120,
        left: 10,
        right: 130,
        toJSON: () => ({}),
        top: 20,
        width: 120,
        x: 10,
        y: 20
      })
    });
    const path = container.querySelector(
      `path[data-preview-source="path-document"][data-preview-operation="${operation.id}"][data-type="cut"]`
    ) as SVGPathElement;
    const nearTopSide = previewWorldClientPoint(preview, { x: 8, y: 4.8 }, 5);

    await act(async () => {
      preview.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...nearTopSide }));
    });
    await flushAsync();

    const startPoint = container.querySelector(
      '[data-upid-start-inference="perpendicular"] [data-upid-start-preview-point]'
    );
    const guide = container.querySelector('[data-upid-start-inference-guide]');
    expect(startPoint?.getAttribute('cx')).toBe('2');
    expect(startPoint?.getAttribute('cy')).toBe('0');
    expect(guide?.getAttribute('x1')).toBe('2');
    expect(guide?.getAttribute('x2')).toBe('2');
    expect(guide?.getAttribute('stroke-width')).toBe('2.5');

    await act(async () => {
      path.dispatchEvent(new MouseEvent('click', { bubbles: true, ...nearTopSide }));
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-set-start-workflow]')?.textContent).toContain(
      'currently starts at X2.000 Y5.000'
    );
  });

  it('opens a workflow without rewriting its remembered hidden placement or geometry', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    const rememberedGeometry = { x: 333, y: 144, width: 377, height: 411 };
    window.localStorage.setItem(EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      placements: { 'path-transform': 'hidden' },
      dockOrders: { left: [], right: [] },
      floatingGeometries: { 'path-transform': rememberedGeometry },
      dockWidths: { left: 360, right: 420 }
    }));

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();
    await clickElement('[data-editor-workflow-command="geometry.transform"]');
    expect(
      container.querySelector('[data-editor-workspace-panel="path-transform"]')
        ?.getAttribute('data-editor-workspace-panel-placement')
    ).toBe('floating');

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 250));
    });
    const stored = JSON.parse(window.localStorage.getItem(EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY) ?? '{}');
    expect(stored.placements['path-transform']).toBe('hidden');
    expect(stored.floatingGeometries['path-transform']).toEqual(rememberedGeometry);
    window.localStorage.removeItem(EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY);
  });

  it('shows selected between-contour travel as derived read-only geometry', async () => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.between-contours" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    expect(container.querySelector('[data-between-contours-panel]')).not.toBeNull();
    expect(container.querySelector('[data-upid-planned-rapid-editor]')).toBeNull();
    expect(container.querySelector('input[aria-label^="Planned rapid"]')).toBeNull();
    expect(container.textContent).toContain('Initial wire position');
  });

  it('creates and edits a manual cut entry with undo and redo', async () => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.entry-exit" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await changeInput('input[aria-label="Entry X"]', '-3');
    await changeInput('input[aria-label="Entry Y"]', '1');
    await clickElement('button[aria-label="Set straight entry"]');
    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]');

    const selectedRapidPath = () => container.querySelector(
      'svg[aria-label="UPID path preview"] path[data-preview-travel="rapid-in"][data-preview-travel-source="planned"]'
    );
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -3 1$/);
    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await changeInput('input[aria-label="Entry X"]', '-4');
    await clickElement('button[aria-label="Set straight entry"]');
    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -4 1$/);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -3 1$/);
    await clickElement('button[aria-label="Redo active document change"]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -4 1$/);
  });

  it('keeps save state and coordinates visible and opens diagnostics from status', async () => {
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
    expect(status?.textContent).toContain('Cursor X — Y — mm');
    expect(status?.textContent).toContain('Diagnostics 2');
    expect(
      container.querySelector('[data-upid-diagnostic-code="units-assumed-millimeters"]')
    ).toBeNull();
    await clickElement('[data-editor-status-diagnostics]');
    expect(container.querySelector('[aria-label="Execution issues"]')?.textContent)
      .toContain('initial wire position');
  });

  it('keeps persistent header undo and redo snapshots aligned with later path selection', async () => {
    const pathDocument = pathDocumentFromIndependentRectangles();
    const project = projectWithUpid(pathDocument);
    const [firstOperation, secondOperation] = pathDocument.plan.operations;

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="machining.contour-setup"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await changeSelect(
      container.querySelector('select[aria-label="Contour setup operation"]'),
      firstOperation.id
    );
    await clickElement('button[aria-label="Reverse path operation"]');
    await changeSelect(
      container.querySelector('select[aria-label="Contour setup operation"]'),
      secondOperation.id
    );
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      `Selection Operation ${secondOperation.id}`
    );

    await clickElement('button[aria-label="Undo active document change"]');
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      'Selection None'
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
          initialWorkflowId="machining.contour-setup"
          onSaveEditorDraft={onSaveEditorDraft}
          project={project}
        />
      );
    });
    await flushAsync();

    await changeSelect(
      container.querySelector('select[aria-label="Contour setup operation"]'),
      firstOperation.id
    );
    await clickElement('button[aria-label="Reverse path operation"]');
    await changeSelect(
      container.querySelector('select[aria-label="Contour setup operation"]'),
      secondOperation.id
    );
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
    await clickElement('button[aria-label="Save active document"]');

    const savedDraft = onSaveEditorDraft.mock.calls[0]?.[0] as EditorSaveDraft | undefined;
    expect(savedDraft?.model).toBe('upid-document');
    if (!savedDraft || savedDraft.model !== 'upid-document') {
      throw new Error('Expected a UPID save draft.');
    }
    const savedProject: TestUpidProject = {
      ...project,
      content: { kind: 'upid-document', document: savedDraft.pathDocument }
    };

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
      'Selection None'
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
          initialWorkflowId="machining.contour-setup"
          onSaveEditorDraft={firstSave}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');

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
      'Redo active document change'
    ]) {
      expect(
        (container.querySelector(`button[aria-label="${ariaLabel}"]`) as HTMLButtonElement).disabled
      ).toBe(true);
    }
    await openWorkflowMenu('export.preview');
    expect(
      (container.querySelector('[data-editor-workflow-command="export.preview"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
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

    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
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

    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
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

    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');

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

    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
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
          initialWorkflowId="view.contours"
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
          initialWorkflowId="view.contours"
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

    await clickElement('button[aria-label="Geometry tree options"]');
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
          initialWorkflowId="view.contours"
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
    await clickElement('button[aria-label="Geometry tree options"]');
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
          initialWorkflowId="view.contours"
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
    await clickElement('[data-editor-workflow-command="view.statistics"]');
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('start');
  });

  it('projects pointer and keyboard hover for contour, segment, endpoint, and lead-in rows', async () => {
    const project = projectWithUpid(pathDocumentFromCircleWithLeadIn());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
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
    expect(endpointSelect?.getAttribute('aria-label')).toBe('Select cut start of segment 1 in Exterior 1');
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
        row?.dispatchEvent(
          new PointerEvent('pointerover', { bubbles: true, pointerType: 'pen' })
        );
      });
      expect(row?.getAttribute('data-upid-hovered')).toBe('true');

      await act(async () => {
        row?.dispatchEvent(
          new PointerEvent('pointerout', { bubbles: true, pointerType: 'pen' })
        );
      });
      expect(row?.getAttribute('data-upid-hovered')).not.toBe('true');

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

  it('associates rich endpoint help with the Contour Tree selection action only', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();
    await clickElement('button[aria-label="Expand segment 1 details in Exterior 1"]');

    const endpointRow = container.querySelector(
      '[data-upid-point-row][data-upid-point-role="start"]'
    );
    const endpointSelect = endpointRow?.querySelector(
      'button[data-upid-point-select]'
    ) as HTMLButtonElement | null;
    const helpId = endpointSelect?.getAttribute('aria-describedby');

    expect(helpId).not.toBeNull();
    expect(helpId ?? '').toMatch(/^upid-endpoint-help-/);
    expect(endpointRow?.querySelectorAll('button')).toHaveLength(1);
    expect(endpointSelect?.getAttribute('title')).toContain('start endpoint of segment 1');

    const help = helpId ? container.querySelector(`#${helpId}`) : null;
    expect(help?.getAttribute('data-upid-point-help')).toBe('start');
    expect(help?.textContent).toContain('Endpoint cluster');
    expect(help?.textContent).toContain('0.000, 0.000');

  });

  it('shows selected contour subtree metrics in the inspector', async () => {
    const pathDocument = pathDocumentFromNestedRectangles();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

    const exteriorTreeContext = container.querySelector('[data-upid-selected-tree-context]');
    expect(exteriorTreeContext?.getAttribute('data-upid-path-element-id')).toBe('contour_0001');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.textContent).toBe('Exterior 1');
    expect(container.querySelector('[data-upid-selected="tree-lineage"]')?.getAttribute('data-upid-lineage-depth')).toBe(
      '1'
    );
    expect(container.querySelector('[data-upid-selected="tree-direct-segments"]')?.textContent).toBe('4');
    expect(container.querySelector('[data-upid-selected="tree-descendants"]')?.textContent).toBe('1');
    expect(container.querySelector('[data-upid-selected="tree-total-segments"]')?.textContent).toBe('8');

    await clickElement('button[aria-label="Select child Hole 1"]');

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
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Hole 1"]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label="Select Exterior 1"]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
          initialWorkflowId="view.contours"
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
    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
          initialWorkflowId="view.contours"
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
    expect(firstSegmentRow?.querySelector('[data-upid-segment-summary="length"]')?.textContent).toContain(
      '10.000'
    );
    await clickElement('button[aria-label^="Expand segment 1 details in "]');
    expect(container.querySelector('[data-upid-segment-group] [data-upid-segment-field="length"]')).toBeNull();

    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    await clickElement('button[aria-label="Reverse path operation"]');
    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="view.contours"]');

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
    expect(reversedGroup?.querySelector('[data-upid-segment-summary="length"]')?.textContent).toContain('10.000');
  });

  it('shows exact arc geometry in the selected segment inspector', async () => {
    const pathDocument = pathDocumentFromArc();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-upid-segment-row]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

    expect(
      container
        .querySelector('[data-upid-selected-segment-geometry]')
        ?.getAttribute('data-upid-selected-segment-geometry')
    ).toBe('arc');
    expect(container.querySelector('[data-upid-selected-segment-section="geometry"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-segment-section="path"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-segment-section="source"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-segment-geometry="center"]')?.textContent).toBe(
      '0.000, 0.000'
    );
    expect(container.querySelector('[data-upid-selected-segment-geometry="radius"]')?.textContent).toBe(
      '10.000'
    );
    expect(
      container.querySelector('[data-upid-selected-segment-geometry="direction-sweep"]')?.textContent
    ).toBe(
      'CCW 90.000°'
    );
    const advanced = container.querySelector(
      'details[data-upid-selected-segment-section="advanced"]'
    ) as HTMLDetailsElement | null;
    expect(advanced).not.toBeNull();
    expect(advanced?.open).toBe(false);
    expect(
      advanced?.querySelector('[data-upid-selected-segment-geometry="start-angle"]')?.textContent
    ).toBe('0.000°');
    expect(
      advanced?.querySelector('[data-upid-selected-segment-geometry="end-angle"]')?.textContent
    ).toBe('90.000°');
  });

  it('shows a selected full circle without endpoint or 360-degree duplication', async () => {
    const project = projectWithUpid(pathDocumentFromCircleWithLeadIn());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('[data-upid-segment-row]');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

    const selectedSegment = container.querySelector('[data-upid-selected-segment]');
    expect(selectedSegment?.getAttribute('data-upid-selected-segment-geometry')).toBe('circle');
    expect(
      selectedSegment?.querySelector('[data-upid-selected-segment-geometry="radius"]')?.textContent
    ).toBe('10.000');
    expect(
      selectedSegment?.querySelector('[data-upid-selected-segment-summary="circumference"]')
        ?.textContent
    ).toBe('62.832');
    expect(
      selectedSegment?.querySelector('[data-upid-selected-segment-geometry="direction"]')?.textContent
    ).toBe('CCW');
    expect(
      selectedSegment?.querySelector('[data-upid-selected-segment-point="center"]')?.textContent
    ).toBe('0.000, 0.000');
    expect(
      selectedSegment?.querySelector('[data-upid-selected-segment-point="cut-start"]')?.textContent
    ).toBe('10.000, 0.000');
    expect(selectedSegment?.querySelector('[data-upid-selected-segment-point="end"]')).toBeNull();
    expect(selectedSegment?.querySelector('[data-upid-selected-segment-geometry="sweep"]')).toBeNull();
    expect(
      selectedSegment?.querySelector('[data-upid-selected-segment-geometry="end-angle"]')
    ).toBeNull();
  });

  it('shows endpoint cluster snap metadata in the selected point inspector', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
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

    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
    const rowSelector = '[data-upid-selected-diagnostic-row][data-upid-selected-diagnostic-code="endpoint-cluster-snap"]';
    const relatedButton = container.querySelector(`${rowSelector} [data-upid-selected-diagnostic-ref-index="1"]`)!;
    await act(async () => {
      relatedButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe('10.004, 0.000');
    const diagnosticRow = container.querySelector(rowSelector)!;
    await act(async () => {
      diagnosticRow.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-upid-selected-segment]')?.getAttribute('data-upid-selected-segment-id')).toBe(pathDocument.segments[0].id);
  });

  it('reports endpoint topology in project inspection', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.statistics"
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
          initialWorkflowId="view.diagnostics"
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
    await clickElement('[data-editor-workflow-command="view.statistics"]');
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('start');
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '10.004, 0.000'
    );
    expect(selectedSegmentId).toBeTruthy();
  });

  it('marks path navigator rows with local diagnostic summaries', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
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
          initialWorkflowId="view.endpoints"
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
    await clickElement('[data-editor-workflow-command="view.statistics"]');
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

  it('shows curve geometry metadata in path navigator segment rows', async () => {
    const pathDocument = pathDocumentFromArc();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
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
    expect(container.querySelector('[data-upid-segment-summary="direction"]')?.textContent).toBe(
      'CCW'
    );
    expect(container.querySelector('[data-upid-segment-detail-metric="radius"]')?.textContent).toContain(
      '10.000'
    );
    expect(container.querySelector('[data-upid-segment-detail-metric="sweep"]')?.textContent).toContain(
      '90.000°'
    );
    expect(
      container.querySelector('[data-upid-segment-summary="arc-length"]')?.textContent
    ).toBe('L 15.708');
    expect(
      container.querySelector('[data-upid-geometry-point-row][data-upid-geometry-point-key="center"]')
        ?.textContent
    ).toContain('Center');
    expect(container.querySelector('[data-upid-segment-field="from"]')).toBeNull();
    expect(container.querySelector('[data-upid-segment-field="to"]')).toBeNull();
  });

  it('shows line-specific geometry without repeating endpoint facts', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label^="Expand segment 1 details in "]');

    expect(container.querySelector('[data-upid-segment-summary="length"]')?.textContent).toBe(
      'L 10.000'
    );
    expect(container.querySelector('[data-upid-segment-derived="delta-x"]')?.textContent).toContain(
      '10.000'
    );
    expect(container.querySelector('[data-upid-segment-derived="delta-y"]')?.textContent).toContain(
      '0.000'
    );
    expect(container.querySelector('[data-upid-segment-derived="heading"]')?.textContent).toContain(
      '0.000°'
    );
    expect(
      [...container.querySelectorAll('[data-upid-point-row]')].map(
        (row) => row.querySelector('[data-upid-point-label]')?.textContent
      )
    ).toEqual(['Start', 'End']);
    expect(container.querySelector('[data-upid-point-field="role"]')).toBeNull();
    expect(container.querySelector('[data-upid-segment-field="from"]')).toBeNull();
    expect(container.querySelector('[data-upid-segment-field="to"]')).toBeNull();
  });

  it('shows a clean full circle as center and one selectable cut start', async () => {
    const project = projectWithUpid(pathDocumentFromCircleWithLeadIn());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label^="Expand segment 1 details in "]');

    expect(container.querySelector('[data-upid-segment-summary="direction"]')?.textContent).toBe(
      'CCW'
    );
    expect(container.querySelector('[data-upid-segment-detail-metric="radius"]')?.textContent).toContain(
      '10.000'
    );
    expect(
      container.querySelector('[data-upid-segment-summary="circumference"]')?.textContent
    ).toBe('Circ 62.832');
    expect(
      container.querySelector('[data-upid-geometry-point-row][data-upid-geometry-point-key="center"]')
        ?.textContent
    ).toContain('Center');

    const pointRows = [...container.querySelectorAll('[data-upid-point-row]')];
    expect(pointRows).toHaveLength(2);
    expect(
      pointRows.map((row) => row.querySelector('[data-upid-point-label]')?.textContent)
    ).toEqual(['Center', 'Cut start']);
    const cutStartRow = pointRows.find((row) => row.getAttribute('data-upid-point-role') === 'start');
    expect(cutStartRow).toBeTruthy();
    expect(cutStartRow?.querySelector('button')?.getAttribute('aria-label')).toContain('cut start');
    expect(container.querySelector('[data-upid-segment-sweep="360.000"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-segment-details]')?.textContent).not.toContain('360');

    await act(async () => {
      cutStartRow?.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(cutStartRow?.getAttribute('data-upid-selected')).toBe('true');
    const segmentId = cutStartRow?.getAttribute('data-upid-segment-id');
    const circleEndpointHandles = [...container.querySelectorAll(
      `circle[data-preview-path-endpoint][data-preview-segment="${segmentId}"]`
    )];
    expect(circleEndpointHandles).toHaveLength(1);
    expect(
      circleEndpointHandles.filter((handle) => handle.getAttribute('data-preview-selected') === 'true')
    ).toHaveLength(1);
    expect(
      container.querySelector('path[data-preview-travel="lead-in"]')?.getAttribute('d')
    ).toBe('M 0 0 L 10 0');
  });

  it('selects a circle center from the geometry tree and projects it on canvas', async () => {
    const project = projectWithUpid(pathDocumentFromCircleWithLeadIn());

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
          onSaveEditorDraft={vi.fn()}
          project={project}
        />
      );
    });
    await flushAsync();

    await clickElement('button[aria-label^="Expand segment 1 details in "]');

    const centerRow = container.querySelector(
      '[data-upid-geometry-point-row][data-upid-geometry-point-key="center"]'
    );
    const centerButton = centerRow?.querySelector('button[data-upid-point-select]');
    expect(centerButton).not.toBeNull();

    await act(async () => {
      centerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    expect(centerRow?.getAttribute('data-upid-point-role')).toBe('center');
    expect(centerRow?.getAttribute('data-upid-selected')).toBe('true');
    const centerHandle = container.querySelector(
      'circle[data-preview-arc-center-handle][data-preview-selected="true"]'
    );
    expect(centerHandle?.getAttribute('data-preview-arc-center')).toBe('0.000,0.000');
    expect(centerHandle?.getAttribute('data-preview-point-role')).toBe('center');

    await clickElement('[data-editor-workflow-command="view.statistics"]');
    expect(container.querySelector('[data-upid-selected-point-role]')?.textContent).toBe('center');
    expect(container.querySelector('[data-upid-selected-point-coordinate]')?.textContent).toBe(
      '0.000, 0.000'
    );
    expect(container.querySelector('[data-upid-selected-point-cluster]')).toBeNull();
  });

  it('reveals collapsed contour groups when selecting path geometry on canvas', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
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
          initialWorkflowId="view.contours"
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
    expect(
      container
        .querySelector('[data-upid-contour-row][data-upid-path-element-id="contour_0001"]')
        ?.getAttribute('data-upid-contour-edited-segments')
    ).toBe('2');
    await clickElement('[data-editor-workflow-command="machining.sequence"]');
    expect(
      container
        .querySelector('[data-upid-cut-sequence-row][data-upid-path-element-id="contour_0001"]')
        ?.getAttribute('data-upid-cut-sequence-edited-segments')
    ).toBe('2');
    await clickElement('[data-editor-workflow-command="view.statistics"]');

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
  });

  it('temporarily reveals collapsed contour groups while canvas hover assist targets geometry', async () => {
    const pathDocument = pathDocumentFromRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.contours"
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
    const workflowCommandId = selector.match(/data-editor-workflow-command="([^"]+)"/)?.[1];
    if (workflowCommandId === 'view.contours') {
      const geometryLens = container.querySelector(
        '[role="tab"][aria-label="Geometry lens"]'
      ) as HTMLElement | null;
      expect(geometryLens).not.toBeNull();
      await act(async () => {
        geometryLens?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flushAsync();
      const cutPathDisclosures = [
        ...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Expand cut path in "]')
      ];
      await act(async () => {
        cutPathDisclosures.forEach((button) => button.click());
      });
      await flushAsync();
      const optionsButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Geometry tree options"][aria-expanded="false"]'
      );
      await act(async () => optionsButton?.click());
      await flushAsync();
      return;
    }
    if (workflowCommandId) await openWorkflowMenu(workflowCommandId);

    const element = container.querySelector(selector) as HTMLElement | null;
    expect(element).not.toBeNull();

    await act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();
  }

  function programTreeItem(treeKey: string) {
    return [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .find((item) => item.dataset.treeKey === treeKey) ?? null;
  }

  async function expandProgramTreeItem(treeKey: string) {
    const item = programTreeItem(treeKey);
    const expandButton = [
      ...(item?.querySelector<HTMLElement>(':scope > [data-editor-program-tree-row]')
        ?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    ].find((button) => button.getAttribute('aria-label')?.startsWith('Expand '));
    expect(expandButton).not.toBeNull();

    await act(async () => expandButton?.click());
    await flushAsync();
  }

  async function ensureProgramTreeItemExpanded(treeKey: string) {
    const item = programTreeItem(treeKey);
    expect(item).not.toBeNull();
    if (item?.getAttribute('aria-expanded') === 'false') {
      await expandProgramTreeItem(treeKey);
    }
  }

  async function clickProgramTreeButton(treeKey: string, ariaLabel: string) {
    const item = programTreeItem(treeKey);
    const button = [
      ...(item?.querySelector<HTMLElement>(':scope > [data-editor-program-tree-row]')
        ?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    ].find((candidate) => candidate.getAttribute('aria-label') === ariaLabel);
    expect(button).not.toBeNull();

    await act(async () => button?.click());
    await flushAsync();
  }

  async function clickProgramTreeRow(treeKey: string) {
    const row = programTreeItem(treeKey)?.querySelector<HTMLElement>(
      ':scope > [data-editor-program-tree-row]'
    );
    expect(row).not.toBeNull();

    await act(async () => row?.click());
    await flushAsync();
  }

  async function pressProgramTreeItem(treeKey: string, key: string) {
    const item = programTreeItem(treeKey);
    expect(item).not.toBeNull();

    await act(async () => {
      item?.focus();
      item?.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key
      }));
    });
    await flushAsync();
  }

  async function doubleClickProgramTreeItem(treeKey: string) {
    const row = programTreeItem(treeKey)?.querySelector<HTMLElement>(
      ':scope > [data-editor-program-tree-row]'
    );
    expect(row).not.toBeNull();

    await act(async () => {
      row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
    await flushAsync();
  }

  async function openWorkflowMenu(commandId: string) {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        `button[aria-label="${workflowMenuTitle(commandId)} menu"]`
      )?.click();
    });
    await flushAsync();
  }

  async function changeInput(selector: string, value: string) {
    const input = container.querySelector(selector) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
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

  function visibleWorkflowPanelIds() {
    return [...container.querySelectorAll('[data-editor-workspace-panel]')].map((panel) =>
      panel.getAttribute('data-editor-workspace-panel')
    );
  }

  function previewGeometrySignature() {
    return [...container.querySelectorAll(
      'svg[aria-label="UPID path preview"] path[data-preview-source="path-document"]'
    )].map((path) => path.getAttribute('d')).join('|');
  }
});

function EditorPageHarness({
  filePath = 'imports/rectangle.dxf',
  initialWorkflowId,
  interactionLocked = false,
  onBackToDashboard = noop,
  onImportProgramFile = noop,
  onSaveEditorDraft,
  project,
  saveStatus = 'idle'
}: {
  filePath?: string;
  initialWorkflowId?: string;
  interactionLocked?: boolean;
  onBackToDashboard?: () => void;
  onImportProgramFile?: (file: File) => void;
  onSaveEditorDraft: (draft: EditorSaveDraft) => void;
  project: TestUpidProject;
  saveStatus?: 'error' | 'idle' | 'saving';
}) {
  if (project.content.kind !== 'upid-document') {
    throw new Error('EditorPageHarness requires a UPID project.');
  }
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [railContent, setRailContent] = useState<AppRailContent | null>(null);
  const [compactDrawer, setCompactDrawer] = useState<'upid' | 'workflow' | null>(null);
  const closeCompactDrawerWithRailFocus = useCallback(() => setCompactDrawer(null), []);
  const openedInitialWorkflowRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      !initialWorkflowId ||
      openedInitialWorkflowRef.current === initialWorkflowId ||
      (initialWorkflowId === 'view.contours' ? !railContent : !headerContent)
    ) {
      return;
    }
    openedInitialWorkflowRef.current = initialWorkflowId;
    if (initialWorkflowId === 'view.contours') {
      document.querySelector<HTMLButtonElement>(
        '[role="tab"][aria-label="Geometry lens"]'
      )?.click();
      queueMicrotask(() => {
        document
          .querySelectorAll<HTMLButtonElement>('button[aria-label^="Expand cut path in "]')
          .forEach((button) => button.click());
        document
          .querySelector<HTMLButtonElement>('button[aria-label="Geometry tree options"][aria-expanded="false"]')
          ?.click();
      });
      return;
    }
    document.querySelector<HTMLButtonElement>(
      `button[aria-label="${workflowMenuTitle(initialWorkflowId)} menu"]`
    )?.click();
    queueMicrotask(() => {
      document.querySelector<HTMLButtonElement>(
        `[data-editor-workflow-command="${initialWorkflowId}"]`
      )?.click();
    });
  }, [headerContent, initialWorkflowId, railContent]);
  return (
    <AppRailProvider
      value={{
        closeCompactDrawerWithRailFocus,
        compactDrawer,
        compactModalHost: null,
        compactTransitionOverlay: false,
        isCompactViewport: false,
        isMiddleViewport: false,
        setCompactDrawer,
        setCompactTransitionOverlay: () => undefined,
        setHeaderContent,
        setRailCollapsed: () => undefined,
        setRailContent
      }}
    >
      <div>{headerContent}</div>
      <aside data-test-editor-project-rail>{railContent?.expanded}</aside>
      <EditorPage
        importErrorMessage={null}
        importStatus="idle"
        interactionLocked={interactionLocked}
        machines={[]}
        posts={{ schemaVersion: 1, installations: [] }}
        onBackToDashboard={onBackToDashboard}
        onDownloadEditorFile={noop}
        onGenerateControllerArtifact={async () => ({
          ok: false,
          error: {
            code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED',
            message: 'Artifact generation is outside this neutral-editor harness.'
          }
        })}
        onImportProgramFile={onImportProgramFile}
        onSaveEditorDraft={onSaveEditorDraft}
        planningMachine={null}
        program={{
          filePath,
          model: 'upid-document',
          parseResult: null,
          pathDocument: project.content.document,
          project,
          text: ''
        }}
        saveErrorMessage={null}
        saveStatus={saveStatus}
      />
    </AppRailProvider>
  );
}

function workflowMenuTitle(commandId: string) {
  const category = commandId.split('.')[0];
  const titles: Record<string, string> = {
    construction: 'Construction',
    export: 'Export',
    geometry: 'Geometry',
    machine: 'Machine',
    machining: 'Machining',
    view: 'View'
  };
  const title = titles[category];
  if (!title) throw new Error(`No workflow menu owns ${commandId}.`);
  return title;
}

function projectWithUpid(
  pathDocument: PathPlanningDocument
): TestUpidProject {
  const created = createWorkbenchProjectDocument({
    id: 'rectangle-2026-05-31',
    name: 'rectangle',
    now: new Date('2026-05-31T12:00:00.000Z'),
    source: {
      kind: 'dxf',
      files: [{
        createdAt: '2026-05-31T12:00:00.000Z',
        kind: 'dxf',
        name: 'rectangle.dxf',
        path: 'imports/rectangle.dxf'
      }]
    },
    content: { kind: 'upid-document', document: pathDocument }
  });
  if (!created.ok) throw new Error(created.error.message);
  if (
    created.project.content.kind !== 'upid-document' ||
    created.project.source.kind !== 'dxf'
  ) {
    throw new Error('Expected a UPID project fixture.');
  }
  return {
    ...created.project,
    source: created.project.source,
    content: { kind: 'upid-document' as const, document: pathDocument }
  };
}

async function changeSelect(select: HTMLSelectElement | null, value: string) {
  expect(select).not.toBeNull();
  await act(async () => {
    if (!select) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flushAsync();
}

function previewWorldClientPoint(
  preview: SVGSVGElement,
  point: { x: number; y: number },
  flipY: number
) {
  const [minX, minY, width, height] = (preview.getAttribute('viewBox') ?? '0 0 1 1')
    .split(/\s+/)
    .map(Number);
  const rect = preview.getBoundingClientRect();
  const scale = Math.min(rect.width / width, rect.height / height);
  const offsetX = (rect.width - width * scale) / 2;
  const offsetY = (rect.height - height * scale) / 2;
  return {
    clientX: rect.left + offsetX + (point.x - minX) * scale,
    clientY: rect.top + offsetY + (flipY - point.y - minY) * scale
  };
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
  });
}
