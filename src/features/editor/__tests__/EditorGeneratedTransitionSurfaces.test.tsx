import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  initializeProjectCompensationIntents,
  setManualCompensationIntent
} from '@/domain/compensation/intent';
import {
  createBlankMachineProfile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  setCircleOperationCenterPierceLeadIn,
  setPathOperationManualLeadIn
} from '@/domain/path-editor/pathDocumentOperations';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import type { MachineProfile } from '@/domain/workbench/types';

import { EditorInspectorPanel } from '../EditorInspectorPanel';
import {
  EditorPathNavigatorPanel,
  type EditorPathElementRef
} from '../EditorPathNavigatorPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('generated transition ownership surfaces', () => {
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

  it('hides ignored stored lead-in rows from the contour navigator while preserving authored rows', async () => {
    const machine = explicitLinearMachine();
    const generatedDocument = documentWithStoredEntry(machine);
    const operation = generatedDocument.plan.operations[0];
    const pathElement = generatedDocument.pathElements[0];

    await act(async () => {
      root.render(
        navigator(
          generatedDocument,
          machine,
          operation.id,
          pathElement.id
        )
      );
    });

    expect(container.querySelector('[data-upid-lead-in-row]')).toBeNull();

    const authoredDocument = setManualCompensationIntent(
      generatedDocument,
      operation.id,
      'centerline'
    )!;
    await act(async () => {
      root.render(
        navigator(
          authoredDocument,
          machine,
          operation.id,
          pathElement.id
        )
      );
    });

    expect(container.querySelector('[data-upid-lead-in-row]')).not.toBeNull();
  });

  it('hides ignored stored transition decisions and travel from the inspector while preserving authored rows', async () => {
    const machine = explicitLinearMachine();
    const generatedDocument = documentWithStoredEntry(machine);
    const operation = generatedDocument.plan.operations[0];
    const selectedPathElement: EditorPathElementRef = {
      operationId: operation.id,
      pathElementId: generatedDocument.pathElements[0].id,
      segmentId: null,
      travelRole: 'lead-in'
    };

    await act(async () => {
      root.render(
        inspector(
          generatedDocument,
          machine,
          operation.id,
          selectedPathElement
        )
      );
    });

    expect(container.querySelector('[data-upid-manual-override="lead-in"]')).toBeNull();
    expect(container.querySelector('[data-upid-selected-travel]')).toBeNull();

    const authoredDocument = setManualCompensationIntent(
      generatedDocument,
      operation.id,
      'centerline'
    )!;
    await act(async () => {
      root.render(
        inspector(
          authoredDocument,
          machine,
          operation.id,
          selectedPathElement
        )
      );
    });

    expect(container.querySelector('[data-upid-manual-override="lead-in"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-travel]')).not.toBeNull();
  });

  it('preserves isolated authored rows when another operation blocks machining derivation', async () => {
    const machine = explicitLinearMachine();
    const document = partialDocumentWithStoredEntry(machine);
    const operation = document.plan.operations[0];
    const pathElement = document.pathElements[0];
    const selectedPathElement: EditorPathElementRef = {
      operationId: operation.id,
      pathElementId: pathElement.id,
      segmentId: null,
      travelRole: 'lead-in'
    };

    await act(async () => {
      root.render(
        navigator(document, machine, operation.id, pathElement.id)
      );
    });
    expect(container.querySelector('[data-upid-lead-in-row]')).not.toBeNull();

    await act(async () => {
      root.render(
        inspector(document, machine, operation.id, selectedPathElement)
      );
    });
    expect(container.querySelector('[data-upid-manual-override="lead-in"]')).not.toBeNull();
    expect(container.querySelector('[data-upid-selected-travel]')).not.toBeNull();
  });
});

function navigator(
  document: ReturnType<typeof createUpidFromDxfEntities>,
  machineProfile: MachineProfile,
  operationId: string,
  pathElementId: string
) {
  return (
    <EditorPathNavigatorPanel
      expandedPathElementIds={{ [pathElementId]: true }}
      hoveredPathElement={null}
      hoverAssistEnabled={false}
      isSaving={false}
      latestMeasurementPoint={null}
      machineProfile={machineProfile}
      measurementPoints={[]}
      onExpandedPathElementIdsChange={vi.fn()}
      onHoverPathElement={vi.fn()}
      onMirrorPathDocument={vi.fn()}
      onMirrorPathSelection={vi.fn()}
      onMovePathOperation={vi.fn()}
      onMovePathSelectionCenter={vi.fn()}
      onMoveSelectedSegmentCenter={vi.fn()}
      onPathTargetXDraftChange={vi.fn()}
      onPathTargetYDraftChange={vi.fn()}
      onPathTranslateXDraftChange={vi.fn()}
      onPathTranslateYDraftChange={vi.fn()}
      onRotatePathDocument={vi.fn()}
      onRotatePathSelection={vi.fn()}
      onSelectPathElement={vi.fn()}
      onSetPathOperationOrderStrategy={vi.fn()}
      onToggleHoverAssist={vi.fn()}
      onTranslatePathDocument={vi.fn()}
      onTranslatePathSelection={vi.fn()}
      pathDocument={document}
      pathTargetXDraft="0"
      pathTargetYDraft="0"
      pathTranslateXDraft="0"
      pathTranslateYDraft="0"
      selectedPathElement={null}
      selectedPathOperationId={operationId}
    />
  );
}

function inspector(
  document: ReturnType<typeof createUpidFromDxfEntities>,
  machineProfile: MachineProfile,
  operationId: string,
  selectedPathElement: EditorPathElementRef
) {
  return (
    <EditorInspectorPanel
      arcMoveCount={0}
      boundsText="10 × 10 mm"
      canvasMouseMode="select"
      cuttingMoveCount={0}
      draftProgram={null}
      editorFileName="part.dxf"
      gridSnapEnabled={false}
      guideHighlightTarget={null}
      isSaving={false}
      machineFit={null}
      machineProfile={machineProfile}
      measurementPoints={[]}
      onAddMeasurementPoint={vi.fn()}
      onClearMeasurementPoints={vi.fn()}
      onDeleteMeasurementPoint={vi.fn()}
      onExportMeasurementPoints={vi.fn()}
      onInsertMeasurementPoints={vi.fn()}
      onPointXDraftChange={vi.fn()}
      onPointYDraftChange={vi.fn()}
      onSetCanvasMouseMode={vi.fn()}
      onToggleGridSnap={vi.fn()}
      pathCount={0}
      pathDocument={document}
      pointXDraft="0"
      pointYDraft="0"
      previewCursorPoint={null}
      program={null}
      rapidMoveCount={0}
      selectedPathElement={selectedPathElement}
      selectedPathOperationId={operationId}
      structure={null}
    />
  );
}

function documentWithStoredEntry(machine: MachineProfile) {
  const initialized = initializeProjectCompensationIntents(
    createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]),
    machine
  );
  return setCircleOperationCenterPierceLeadIn(
    initialized,
    initialized.plan.operations[0].id
  )!;
}

function partialDocumentWithStoredEntry(machine: MachineProfile) {
  let document = initializeProjectCompensationIntents(
    createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 0, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 0, y: 5 }, end: { x: 10, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 5 }, end: { x: 10, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 10, y: 0 }, end: { x: 0, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 30, y: 0 }, end: { x: 30, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 30, y: 5 }, end: { x: 40, y: 5 } },
      { type: 'line', layer: 'CUT', start: { x: 40, y: 5 }, end: { x: 40, y: 0 } },
      { type: 'line', layer: 'CUT', start: { x: 40, y: 0 }, end: { x: 30, y: 0 } }
    ]),
    machine
  );
  const [operation, invalidOperation] = document.plan.operations;
  document = setPathOperationManualLeadIn(
    document,
    operation.id,
    { x: -2, y: -2 }
  )!;
  for (const segmentId of [
    operation.segmentRefs[0].segmentId,
    invalidOperation.segmentRefs[0].segmentId,
    invalidOperation.segmentRefs[2].segmentId
  ]) {
    document = setMachiningSpanParticipation(document, {
      sourceSegmentId: segmentId,
      range: { start: 0, end: 1 },
      participation: 'inactive-reference'
    })!;
  }
  return document;
}

function explicitLinearMachine() {
  const machine = createBlankMachineProfile('explicit-linear-surfaces');
  machine.controller.family = 'generic-iso';
  machine.controller.postVersion = 1;
  machine.controller.blockFormatting = 'spaced';
  machine.controller.coordinateSystem = 'template-managed';
  machine.controller.unitsCode = 'omit';
  machine.controller.planeCode = 'omit';
  machine.controller.workOffsetCode = 'template-managed';
  machine.controller.programEnd = 'template-managed';
  machine.compensation = {
    supported: true,
    enabledByDefault: true,
    offsetSelection: { address: 'D', index: 0 },
    activation: 'linear-lead',
    cancellation: 'linear-lead-out',
    lifecycleScope: 'operation',
    preActivationCodes: [],
    validationLeadLengthMm: 2,
    expectedMaximumOffsetMm: 0.25
  };
  machine.templates = { header: 'G90 G21 G17', footer: '' };
  return markMachineProfileUserVerified(machine);
}
