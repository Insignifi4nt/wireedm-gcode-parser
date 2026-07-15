import { act, useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postUpidForMachineSpy = vi.hoisted(() => vi.fn());

vi.mock('@/domain/post/upidMachinePost', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/post/upidMachinePost')>();

  return {
    ...actual,
    postUpidForMachine: (...args: Parameters<typeof actual.postUpidForMachine>) => {
      postUpidForMachineSpy(...args);
      return actual.postUpidForMachine(...args);
    }
  };
});

import { AppRailProvider, type AppRailContent } from '@/app/AppRailContext';
import { dxfEntitiesToUpidDocument } from '@/domain/dxf/dxfToUpid';
import { parseDxf } from '@/domain/dxf/parseDxf';
import {
  initializeProjectCompensationIntents
} from '@/domain/compensation/intent';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import {
  createCharmillesRobofil100V2CandidateProfile,
  createVerifiedCharmillesRobofil100Profile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  setCircleOperationCenterPierceLeadIn,
  setManualInitialWirePosition,
  setClosedOperationStartNearPoint,
  setPathOperationClassification,
  translatePathDocument
} from '@/domain/path-editor/pathDocumentOperations';
import { createWorkbenchProject } from '@/domain/workbench/defaultProject';
import type { PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import { composeProjectUpidGCodeExport, withProjectUpid } from '@/domain/upid/projectUpid';
import type { WorkbenchProject } from '@/domain/workbench/types';
import { EditorPage } from '@/features/editor/EditorPage';
import { EditorUpidExportPreview } from '@/features/editor/EditorUpidExportPreview';
import { EDITOR_WORKSPACE_LAYOUT_STORAGE_KEY } from '@/features/editor/workspace/editorWorkspaceLayout';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

describe('EditorPage UPID draft boundary', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    postUpidForMachineSpy.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
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
    expect(visibleWorkflowPanelIds()).toEqual([]);
    expect(container.textContent).toContain('Path Project');
    expect(
      container.querySelector('button[aria-label="Undo active document change"]')
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Redo active document change"]')
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="Save active document"]')).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Open UPID export preview"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain('Saved');

    await clickElement('button[aria-label="Open UPID export preview"]');
    expect(container.querySelector('[data-upid-export-preview]')).not.toBeNull();
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
      'before opening Entry / Exit & Rethreading'
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

    await clickElement('[data-editor-workflow-command="view.summary"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    expect(visibleWorkflowPanelIds()).toEqual(['path-summary']);

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

    await clickElement('[data-editor-workflow-command="view.summary"]');
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

  it('saves and preserves one real owned mutation from every provisional workflow', async () => {
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
          container.querySelector('[data-initial-wire-g92-preview]')?.textContent
        ).toBe('G92 X3.000 Y4.000')
      },
      {
        commandId: 'machining.entry-exit',
        mutate: async () => changeSelect(
          container.querySelector('select[aria-label="Project threading default"]'),
          'automatic'
        ),
        assertPreserved: () => expect(
          (container.querySelector('select[aria-label="Project threading default"]') as HTMLSelectElement).value
        ).toBe('automatic')
      },
      {
        commandId: 'machining.program-stops',
        mutate: async () => {
          const add = [...container.querySelectorAll<HTMLButtonElement>('[data-program-stops-panel] button')]
            .find((button) => button.textContent?.trim() === 'Add M00 stop');
          expect(add).not.toBeUndefined();
          await act(async () => add?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
          await flushAsync();
        },
        assertPreserved: () => expect(container.querySelector('[data-program-stops-panel]')?.textContent)
          .toContain('M00 with 1.000 mm remaining')
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

    for (const workflow of workflows) {
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
    }

    await clickElement('button[aria-label="Undo active document change"]');
    expect(container.querySelector('[data-measurement-point-row="1"]')).toBeNull();
    await clickElement('button[aria-label="Redo active document change"]');
    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    expect(container.querySelector('[data-measurement-point-row="1"]')).not.toBeNull();
  });

  it('keeps Position read-only and owns preview grid snap in Measurement & Construction', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="view.position"]');
    expect(container.querySelector('button[aria-label="Toggle preview grid snap"]')).toBeNull();
    expect(container.querySelector('[data-editor-position-grid-snap]')?.textContent).toBe('Off');
    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    expect(container.querySelector('button[aria-label="Toggle preview grid snap"]')).not.toBeNull();
    await clickElement('button[aria-label="Toggle preview grid snap"]');
    await clickElement('[data-editor-workflow-command="view.position"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    expect(container.querySelector('button[aria-label="Toggle preview grid snap"]')).toBeNull();
    expect(container.querySelector('[data-editor-position-grid-snap]')?.textContent).toBe('On');
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

  it('keeps Contour Tree hover preference independent from Construction magnetic snap', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    await clickElement('input[aria-label="Toggle construction magnetic snap"]');
    await clickElement('[data-editor-workflow-command="view.contours"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    await clickElement('input[aria-label="Toggle canvas hover assist"]');
    await clickElement('input[aria-label="Toggle canvas hover assist"]');

    await clickElement('[data-editor-workflow-command="construction.measurement"]');
    expect(
      (container.querySelector(
        'input[aria-label="Toggle construction magnetic snap"]'
      ) as HTMLInputElement).checked
    ).toBe(true);
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

  it('does not clear one pending form when another action in the workflow succeeds', async () => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await changeInput('input[aria-label="Planned rapid source X"]', '2');
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
    const secondOperation = project.upid!.document.plan.operations[1];
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
    expect(container.querySelector('[data-editor-command-hint]')?.textContent).toContain(
      'Set Start / Step 2'
    );
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
    expect(container.querySelector('[data-editor-command-hint]')?.textContent).toContain(
      'Set Start / Step 2'
    );
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
      'Set Start / Step 2'
    );
    expect(
      container
        .querySelector(`[data-upid-cut-sequence-row][data-upid-operation-id="${otherOperation.id}"]`)
        ?.getAttribute('data-upid-cut-sequence-manual') ?? ''
    ).not.toContain('start');
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

  it('initializes verified finished-contour intent and derives reversal-safe Robofil review data', async () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const translated = translatePathDocument(pathDocumentFromRectangle(), { x: 5, y: 0 })!;
    const project = projectWithUpid(translated, machine);

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="geometry.setup" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const basis = container.querySelector(
      'select[aria-label="Geometry basis"]'
    ) as HTMLSelectElement | null;
    expect(basis?.value).toBe('wire-centre');
    await changeSelect(basis, 'finished-contour');
    await clickElement('[data-editor-workflow-actions="geometry.setup"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');

    expect(container.querySelector('[data-testid="compensation-kept-material"]')?.textContent).toContain(
      'inside · automatic'
    );
    expect(container.querySelector('[data-testid="compensation-winding"]')?.textContent).toMatch(/ccw/i);
    expect(container.querySelector('[data-testid="compensation-wire-side"]')?.textContent).toMatch(/right/i);
    const codeBefore = container.querySelector('[data-testid="compensation-code"]')?.textContent;
    expect(codeBefore).toContain('G42 D0');

    await clickElement('button[aria-label="Reverse path operation"]');

    const codeAfter = container.querySelector('[data-testid="compensation-code"]')?.textContent;
    expect(codeAfter).toContain('G41 D0');
    expect(codeAfter).not.toBe(codeBefore);
    expect(postUpidForMachineSpy).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="compensation-kept-material"]')?.textContent).toContain('inside');
  });

  it('persists a manual kept side and exposes every structured Robofil export row', async () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const translated = translatePathDocument(pathDocumentFromRectangle(), { x: 5, y: 0 })!;
    const initialized = setManualInitialWirePosition(
      initializeProjectCompensationIntents(translated, machine),
      { x: 0, y: 0 }
    )!;
    const project = projectWithUpid(initialized, machine);

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.contour-setup" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const compensation = container.querySelector(
      'select[aria-label="Compensation kept material"]'
    ) as HTMLSelectElement | null;
    await changeSelect(compensation, 'outside');
    expect(container.querySelector('[data-testid="compensation-kept-material"]')?.textContent).toContain(
      'outside · manual'
    );
    await clickElement('button[aria-label="Reverse path operation"]');
    expect(container.querySelector('[data-testid="compensation-kept-material"]')?.textContent).toContain(
      'outside · manual'
    );

    await clickElement('[data-editor-workflow-command="export.preview"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    const blockKinds = [...container.querySelectorAll('[data-upid-export-block-kind]')].map((row) =>
      row.getAttribute('data-upid-export-block-kind')
    );
    expect(blockKinds).toContain('setup');
    expect(blockKinds).toContain('compensation-activation');
    expect(blockKinds).toContain('lead-in');
    expect(blockKinds).toContain('contour');
    expect(blockKinds).toContain('program-end');
    expect(blockKinds).not.toContain('lead-out');
    expect(container.querySelector('[data-upid-export-block-kind="program-end"]')?.textContent).toContain('M02');
    expect(
      (container.querySelector('button[aria-label="Download UPID export program"]') as HTMLButtonElement)
        .disabled
    ).toBe(false);
  });

  it('allows an ambiguous contour manual choice and blocks Robofil wire-centre download clearly', async () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    const sourceDocument = pathDocumentFromRectangle();
    const document = setPathOperationClassification(
      sourceDocument,
      sourceDocument.plan.operations[0].id,
      'ambiguous',
      machine
    )!;
    const project = projectWithUpid(document, machine);

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="geometry.setup" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const basis = container.querySelector('select[aria-label="Geometry basis"]') as HTMLSelectElement;
    await changeSelect(basis, 'finished-contour');
    await clickElement('[data-editor-workflow-actions="geometry.setup"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    expect(container.querySelector('[data-testid="compensation-blocker"]')?.textContent).toContain(
      'missing-intent'
    );
    await changeSelect(
      container.querySelector('select[aria-label="Compensation kept material"]') as HTMLSelectElement,
      'inside'
    );
    expect(container.querySelector('[data-testid="compensation-code"]')?.textContent).toMatch(/G4[12] D0/);

    await clickElement('[data-editor-workflow-actions="machining.contour-setup"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="geometry.setup"]');
    const reopenedBasis = container.querySelector('select[aria-label="Geometry basis"]') as HTMLSelectElement;
    await changeSelect(reopenedBasis, 'wire-centre');
    await clickElement('[data-editor-workflow-actions="geometry.setup"] button[aria-label^="Save "]');
    await clickElement('[data-editor-workflow-command="machining.contour-setup"]');
    expect(container.querySelector('[data-testid="compensation-blocker"]')?.textContent).toContain(
      'wire-centre'
    );
    await clickElement('[data-editor-workflow-command="export.preview"]');
    expect(container.querySelector('[data-upid-export-blocking-message]')?.textContent).toContain(
      'wire-centre'
    );
    expect(
      (container.querySelector('button[aria-label="Download UPID export program"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('blocks download from an unverified Robofil project snapshot with an operator-readable reason', async () => {
    const verified = createVerifiedCharmillesRobofil100Profile();
    const document = initializeProjectCompensationIntents(pathDocumentFromRectangle(), verified);
    const unverified = structuredClone(verified);
    unverified.controller.verification = { status: 'unverified' };
    const project = projectWithUpid(document, unverified);

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.contour-setup" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    expect(container.querySelector('[data-testid="compensation-machine-status"]')?.textContent).toContain(
      'unverified'
    );
    await clickElement('[data-editor-workflow-command="export.preview"]');
    expect(container.querySelector('[data-upid-export-blocking-message]')?.textContent).toContain(
      'current user-verified project machine snapshot'
    );
    expect(
      (container.querySelector('button[aria-label="Download UPID export program"]') as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('does not offer a radial center-pierce lead-in for active controller compensation', async () => {
    const machine = createVerifiedCharmillesRobofil100Profile();
    let document = initializeProjectCompensationIntents(
      dxfEntitiesToUpidDocument(parseDxf(circleDxf()).entities),
      machine
    );
    document = setManualInitialWirePosition(document, { x: 0, y: 0 })!;
    const project = projectWithUpid(document, machine);

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.entry-exit" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const pierceButton = container.querySelector(
      'button[aria-label="Add center pierce lead-in"]'
    ) as HTMLButtonElement | null;
    expect(pierceButton).not.toBeNull();
    expect(pierceButton?.disabled).toBe(true);
    expect(pierceButton?.title).toContain('controller compensation');
  });

  it('offers center-pierce lead creation for the verified operation-scoped Robofil v2 lifecycle', async () => {
    const machine = markMachineProfileUserVerified(
      createCharmillesRobofil100V2CandidateProfile()
    );
    let document = initializeProjectCompensationIntents(
      dxfEntitiesToUpidDocument(parseDxf(circleDxf()).entities),
      machine
    );
    document = setManualInitialWirePosition(document, { x: 0, y: 0 })!;
    const project = projectWithUpid(document, machine);

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.entry-exit" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    const pierceButton = container.querySelector(
      'button[aria-label="Add center pierce lead-in"]'
    ) as HTMLButtonElement | null;
    expect(pierceButton?.disabled).toBe(false);

    await clickElement('button[aria-label="Add center pierce lead-in"]');
    await clickElement('[data-editor-workflow-command="view.contours"]');
    await clickElement('[data-editor-workflow-transition-action="save"]');
    expect(container.querySelector('[data-upid-lead-in-row]')).not.toBeNull();
    expect(container.querySelector(
      'path[data-preview-travel-source="posted"]'
    )?.getAttribute('pointer-events')).toBe('none');
    expect(container.querySelector(
      'path[data-preview-travel-source="planned"]'
    )?.getAttribute('pointer-events')).not.toBe('none');
  });

  it('edits a selected planned rapid through named controls with undo and redo', async () => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.entry-exit" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    expect(container.querySelector('[data-upid-planned-rapid-editor]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Planned rapid source X"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Planned rapid destination Y"]')).not.toBeNull();

    await changeInput('input[aria-label="Planned rapid source X"]', '2');
    await changeInput('input[aria-label="Planned rapid source Y"]', '3');
    await clickElement('button[aria-label="Apply planned rapid source"]');
    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]');

    const selectedRapidPath = () => container.querySelector(
      'svg[aria-label="UPID path preview"] path[data-preview-travel="rapid-in"][data-preview-travel-source="planned"]'
    );
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/^M 2 3 L /);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/^M 0 0 L /);

    await clickElement('button[aria-label="Redo active document change"]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/^M 2 3 L /);
  });

  it('creates a manual lead from a selected rapid destination, then edits it with undo and redo', async () => {
    const project = projectWithUpid(pathDocumentFromIndependentRectangles());

    await act(async () => {
      root.render(<EditorPageHarness initialWorkflowId="machining.entry-exit" onSaveEditorDraft={vi.fn()} project={project} />);
    });
    await flushAsync();

    await changeInput('input[aria-label="Planned rapid destination X"]', '-3');
    await changeInput('input[aria-label="Planned rapid destination Y"]', '1');
    await clickElement('button[aria-label="Create manual lead from planned rapid destination"]');
    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]');

    const selectedRapidPath = () => container.querySelector(
      'svg[aria-label="UPID path preview"] path[data-preview-travel="rapid-in"][data-preview-travel-source="planned"]'
    );
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -3 1$/);
    expect(container.querySelector('button[aria-label="Create manual lead from planned rapid destination"]')).toBeNull();

    await clickElement('[data-editor-workflow-command="machining.entry-exit"]');
    await changeInput('input[aria-label="Planned rapid destination X"]', '-4');
    await clickElement('button[aria-label="Apply planned rapid destination"]');
    await clickElement('[data-editor-workflow-actions="machining.entry-exit"] button[aria-label^="Save "]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -4 1$/);

    await clickElement('button[aria-label="Undo active document change"]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -3 1$/);
    await clickElement('button[aria-label="Redo active document change"]');
    expect(selectedRapidPath()?.getAttribute('d')).toMatch(/ L -4 1$/);
  });

  it('derives blocked readiness from blocking diagnostics and suppresses inconsistent posted cuts', async () => {
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
          canDownload
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
    expect(
      container.querySelectorAll(
        '[data-upid-export-diagnostic-row][data-upid-export-diagnostic-code="branching-topology"]'
      )
    ).toHaveLength(1);
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
    expect(downloadButton?.disabled).toBe(true);
    expect(downloadButton?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => {
      downloadButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDownload).not.toHaveBeenCalled();
  });

  it('projects blockers omitted from general diagnostics as selectable rows', async () => {
    const project = projectWithUpid(pathDocumentFromRectangle());
    const pathDocument = project.upid!.document;
    const readyExport = composeProjectUpidGCodeExport(project, pathDocument);
    const blockingDiagnostic = {
      id: 'blocking-only-diagnostic',
      severity: 'error',
      code: 'branching-topology',
      message: 'Blocking-only diagnostic remains inspectable.',
      relatedSegmentIds: [pathDocument.segments[0].id]
    } satisfies PathDiagnostic;
    const onHoverPathElement = vi.fn();
    const onSelectPathElement = vi.fn();

    await act(async () => {
      root.render(
        <EditorUpidExportPreview
          blockingDiagnostics={[blockingDiagnostic]}
          canDownload={false}
          diagnostics={[]}
          documentTrace={readyExport.documentTrace}
          fileName={readyExport.fileName}
          machineName={readyExport.machineName}
          onClose={vi.fn()}
          onDownload={vi.fn()}
          onHoverPathElement={onHoverPathElement}
          onSelectPathElement={onSelectPathElement}
          operationCount={readyExport.summary.operationCount}
          pathDocument={pathDocument}
          planning={readyExport.planning}
          postMetrics={readyExport.post.metrics}
          postedOperations={readyExport.programOperations}
          programLines={readyExport.program.lines}
        />
      );
    });

    expect(container.querySelector('[data-upid-export-blocking-message]')?.textContent).toContain(
      'Blocking-only diagnostic remains inspectable.'
    );
    const row = container.querySelector(
      '[data-upid-export-diagnostic-row][data-upid-export-diagnostic-id="blocking-only-diagnostic"]'
    );
    const mainAction = row?.querySelector(
      'button[data-upid-export-diagnostic-main]'
    ) as HTMLButtonElement | null;
    expect(row).not.toBeNull();
    expect(mainAction).not.toBeNull();

    await act(async () => {
      mainAction?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onSelectPathElement).toHaveBeenCalledWith(
      expect.objectContaining({ segmentId: pathDocument.segments[0].id })
    );
  });

  it('keeps export diagnostic main and affected-ref actions as semantic siblings', async () => {
    const project = projectWithUpid(pathDocumentFromArc());
    const pathDocument = project.upid!.document;
    const readyExport = composeProjectUpidGCodeExport(project, pathDocument);
    const openChainDiagnostic = pathDocument.diagnostics.find(
      (diagnostic) => diagnostic.code === 'open-chain'
    );
    if (!openChainDiagnostic) throw new Error('Expected the open arc fixture to expose open-chain diagnostics.');
    const onHoverPathElement = vi.fn();
    const onSelectPathElement = vi.fn();

    await act(async () => {
      root.render(
        <EditorUpidExportPreview
          blockingDiagnostics={[]}
          canDownload
          diagnostics={[openChainDiagnostic]}
          documentTrace={readyExport.documentTrace}
          fileName={readyExport.fileName}
          machineName={readyExport.machineName}
          onClose={vi.fn()}
          onDownload={vi.fn()}
          onHoverPathElement={onHoverPathElement}
          onSelectPathElement={onSelectPathElement}
          operationCount={readyExport.summary.operationCount}
          pathDocument={pathDocument}
          planning={readyExport.planning}
          postMetrics={readyExport.post.metrics}
          postedOperations={readyExport.programOperations}
          programLines={readyExport.program.lines}
        />
      );
    });

    const row = container.querySelector(
      '[data-upid-export-diagnostic-row][data-upid-export-diagnostic-code="open-chain"]'
    );
    const mainAction = row?.querySelector(
      'button[data-upid-export-diagnostic-main]'
    ) as HTMLButtonElement | null;
    const affectedRefs = [
      ...(row?.querySelectorAll('button[data-upid-export-diagnostic-ref]') ?? [])
    ] as HTMLButtonElement[];
    expect(row?.getAttribute('role')).toBeNull();
    expect(row?.getAttribute('tabindex')).toBeNull();
    expect(mainAction).not.toBeNull();
    expect(affectedRefs).toHaveLength(2);
    expect(mainAction?.contains(affectedRefs[0])).toBe(false);
    expect(affectedRefs[1].getAttribute('data-upid-export-diagnostic-ref-point-role')).toBe('end');

    await act(async () => {
      affectedRefs[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    });
    expect(onHoverPathElement.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ pointRole: 'end', segmentId: pathDocument.segments[0].id })
    );

    onSelectPathElement.mockClear();
    await act(async () => {
      mainAction?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    });
    expect(onSelectPathElement).toHaveBeenCalledWith(
      expect.objectContaining({ segmentId: pathDocument.segments[0].id })
    );
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
    ).toBeNull();
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
      'Redo active document change',
      'Open UPID export preview'
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
    await clickElement('button[aria-label^="Expand segment 1 details in "]');
    expect(container.querySelector('[data-upid-segment-group] [data-upid-segment-field="length"]')?.textContent).toContain(
      '10.000'
    );

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
    expect(reversedGroup?.querySelector('[data-upid-segment-field="length"]')?.textContent).toContain('10.000');
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
  });

  it('shows endpoint topology summary in the path navigator header', async () => {
    const pathDocument = pathDocumentFromGappedRectangle();
    const project = projectWithUpid(pathDocument);

    await act(async () => {
      root.render(
        <EditorPageHarness
          initialWorkflowId="view.summary"
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

  it('selects ambiguous endpoint topology rows from the path navigator', async () => {
    const pathDocument = pathDocumentFromAmbiguousEndpoints();
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
    await clickElement('[data-editor-workflow-command="view.statistics"]');
    expect(container.querySelector('[data-upid-selected-segment]')).not.toBeNull();
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
    const element = container.querySelector(selector) as HTMLElement | null;
    expect(element).not.toBeNull();

    await act(async () => {
      element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
  initialWorkflowId,
  onBackToDashboard = noop,
  onImportProgramFile = noop,
  onSaveEditorDraft,
  project,
  saveStatus = 'idle'
}: {
  initialWorkflowId?: string;
  onBackToDashboard?: () => void;
  onImportProgramFile?: (file: File) => void;
  onSaveEditorDraft: (draft: EditorSaveDraft) => void;
  project: WorkbenchProject;
  saveStatus?: 'error' | 'idle' | 'saving';
}) {
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [railContent, setRailContent] = useState<AppRailContent | null>(null);
  const openedInitialWorkflowRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialWorkflowId || !headerContent || openedInitialWorkflowRef.current === initialWorkflowId) {
      return;
    }
    const command = document.querySelector(
      `[data-editor-workflow-command="${initialWorkflowId}"]`
    ) as HTMLButtonElement | null;
    if (!command) return;
    openedInitialWorkflowRef.current = initialWorkflowId;
    command.click();
  }, [headerContent, initialWorkflowId]);
  return (
    <AppRailProvider value={{ setHeaderContent, setRailCollapsed: () => undefined, setRailContent }}>
      <div>{headerContent}</div>
      <aside data-test-editor-project-rail>{railContent?.expanded}</aside>
      <EditorPage
        importErrorMessage={null}
        importStatus="idle"
        onBackToDashboard={onBackToDashboard}
        onDownloadEditorFile={noop}
        onImportProgramFile={onImportProgramFile}
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

function projectWithUpid(
  pathDocument: PathPlanningDocument,
  machine?: WorkbenchProject['machine']
) {
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
  if (machine) project.machine = structuredClone(machine);

  return withProjectUpid(project, pathDocument);
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
