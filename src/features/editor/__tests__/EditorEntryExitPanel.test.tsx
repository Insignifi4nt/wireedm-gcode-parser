import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBlankMachineProfile,
  createCharmillesRobofil100V2CandidateProfile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
import {
  initializeProjectCompensationIntents,
  setManualCompensationIntent
} from '@/domain/compensation/intent';
import { setCircleOperationCenterPierceLeadIn } from '@/domain/path-editor/pathDocumentOperations';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { EditorEntryExitPanel } from '../EditorEntryExitPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorEntryExitPanel', () => {
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

  it('shows actual entry strategy and authors exact cut exit intent', async () => {
    let document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    document = setCircleOperationCenterPierceLeadIn(
      document,
      document.plan.operations[1].id
    )!;
    const onSetManualExit = vi.fn();
    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={createCharmillesRobofil100V2CandidateProfile()}
          onCanvasPickModeChange={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={onSetManualExit}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={document.plan.operations[1].id}
        />
      );
    });

    expect(container.textContent).toContain('Circle-center entry');
    await act(async () => {
      setInput(container.querySelector('[aria-label="Exit X"]')!, '27.5');
      setInput(container.querySelector('[aria-label="Exit Y"]')!, '1.25');
      container.querySelector<HTMLButtonElement>('button:nth-of-type(3)');
    });
    await act(async () => {
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Set straight exit'))
        ?.click();
    });

    expect(onSetManualExit).toHaveBeenCalledWith(
      document.plan.operations[1].id,
      { x: 27.5, y: 1.25 }
    );
    expect(container.querySelector('[data-upid-planned-rapid-editor]')).toBeNull();
    expect(container.textContent).not.toContain('Rethreading');
  });

  it('keeps the panel scoped to cutting entry and exit', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={createCharmillesRobofil100V2CandidateProfile()}
          onCanvasPickModeChange={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={null}
        />
      );
    });

    expect(container.textContent).toContain('Entry');
    expect(container.textContent).toContain('Exit');
    expect(container.textContent).not.toContain('Planned rapid');
    expect(container.textContent).not.toContain('Project default');
  });

  it('renders duplicate imported order indices in deterministic execution position order', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    const [first, second] = document.plan.operations;
    first.orderIndex = 9;
    second.orderIndex = 9;
    document.plan.operations = [second, first];

    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={createCharmillesRobofil100V2CandidateProfile()}
          onCanvasPickModeChange={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={second.id}
        />
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Entry and exit operation"]'
    )!;
    const options = [...select.options];
    expect(options.map((option) => option.value)).toEqual([first.id, second.id]);
    expect(options.map((option) => option.textContent)).toEqual([
      `01. ${first.displayName}`,
      `02. ${second.displayName}`
    ]);
    expect(select.value).toBe(second.id);
  });

  it('gates and emits reviewed no-entry and no-exit choices through the Robofil v2 envelope', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const onSetNoEntry = vi.fn();
    const onSetNoExit = vi.fn();
    const operationId = document.plan.operations[0].id;

    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={markMachineProfileUserVerified(
            createCharmillesRobofil100V2CandidateProfile()
          )}
          onCanvasPickModeChange={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={onSetNoEntry}
          onSetNoExit={onSetNoExit}
          selectedOperationId={operationId}
        />
      );
    });

    const noEntry = container.querySelector<HTMLButtonElement>(
      '[aria-label="Use reviewed no entry"]'
    );
    const noExit = container.querySelector<HTMLButtonElement>(
      '[aria-label="Use reviewed no exit"]'
    );
    expect(noEntry?.disabled).toBe(false);
    expect(noExit?.disabled).toBe(false);

    await act(async () => {
      noEntry?.click();
      noExit?.click();
    });

    expect(onSetNoEntry).toHaveBeenCalledWith(operationId);
    expect(onSetNoExit).toHaveBeenCalledWith(operationId);
  });

  it('shows authoritative generated transitions read-only with their causal workflow actions', async () => {
    const machine = explicitLinearMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );
    const document = setCircleOperationCenterPierceLeadIn(
      initialized,
      initialized.plan.operations[0].id
    )!;
    const onOpenProjectMachine = vi.fn();
    const onOpenContourStart = vi.fn();

    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={machine}
          onCanvasPickModeChange={vi.fn()}
          onOpenContourStart={onOpenContourStart}
          onOpenProjectMachine={onOpenProjectMachine}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={document.plan.operations[0].id}
        />
      );
    });

    expect(container.querySelector('[data-entry-exit-generated]')).not.toBeNull();
    expect(container.querySelector('[data-entry-exit-generated-lead-in]')?.textContent)
      .toMatch(/X.+Y.+→ X.+Y/);
    expect(container.querySelector('[data-entry-exit-generated-lead-out]')?.textContent)
      .toMatch(/X.+Y.+→ X.+Y/);
    expect(container.textContent).toContain('Generated from Contour Start and Project Machine');
    expect(container.querySelector('input[aria-label="Entry X"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Exit X"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Pick entry point on canvas"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Use reviewed no entry"]')).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open Contour Start for generated transition"]'
      )?.click();
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open Project Machine for generated transition"]'
      )?.click();
    });
    expect(onOpenContourStart).toHaveBeenCalledWith(document.plan.operations[0].id);
    expect(onOpenProjectMachine).toHaveBeenCalledOnce();
  });

  it('names and routes the actual contour-start owner when another operation blocks posting', async () => {
    const machine = explicitLinearMachine();
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
        { type: 'line', layer: 'REF', start: { x: 5.2, y: -2 }, end: { x: 5.2, y: -0.5 } },
        { type: 'circle', layer: 'CUT', center: { x: 30, y: 0 }, radius: 5 }
      ]),
      machine
    );
    const blockedOperation = document.plan.operations.find(
      (operation) => operation.closed && operation.startPoint.x < 10
    )!;
    const selectedOperation = document.plan.operations.find(
      (operation) => operation.closed && operation.startPoint.x > 10
    )!;
    const onOpenContourStart = vi.fn();

    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={machine}
          onCanvasPickModeChange={vi.fn()}
          onOpenContourStart={onOpenContourStart}
          onOpenProjectMachine={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={selectedOperation.id}
        />
      );
    });

    expect(container.querySelector('[data-entry-exit-generated-blocker]')?.textContent)
      .toContain(`Blocked by ${blockedOperation.displayName}`);
    expect(container.querySelector(
      'button[aria-label="Open Project Machine for generated transition"]'
    )).toBeNull();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Open Contour Start for generated transition"]'
      )?.click();
    });
    expect(onOpenContourStart).toHaveBeenCalledWith(blockedOperation.id);
  });

  it('keeps authored controls for a centerline operation on the same explicit-linear machine', async () => {
    const machine = explicitLinearMachine();
    const initialized = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );
    const operationId = initialized.plan.operations[0].id;
    const document = setManualCompensationIntent(initialized, operationId, 'centerline')!;

    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={machine}
          onCanvasPickModeChange={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={operationId}
        />
      );
    });

    expect(container.querySelector('[data-entry-exit-generated]')).toBeNull();
    expect(container.querySelector('input[aria-label="Entry X"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="Exit X"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Pick entry point on canvas"]')).not.toBeNull();
  });

  it('shows the authoritative post blocker instead of editable stored transitions', async () => {
    const editableMachine = explicitLinearMachine();
    editableMachine.compensation.validationLeadLengthMm = 0.0004;
    const machine = markMachineProfileUserVerified(editableMachine);
    const document = initializeProjectCompensationIntents(
      createUpidFromDxfEntities([
        { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
      ]),
      machine
    );

    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          canvasPickMode={null}
          disabled={false}
          document={document}
          machine={machine}
          onCanvasPickModeChange={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={vi.fn()}
          onSetNoEntry={vi.fn()}
          onSetNoExit={vi.fn()}
          selectedOperationId={document.plan.operations[0].id}
        />
      );
    });

    expect(container.querySelector('[data-entry-exit-generated-blocker]')?.textContent)
      .toContain('precision');
    expect(container.querySelector('input[aria-label="Entry X"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Exit X"]')).toBeNull();
  });
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function explicitLinearMachine() {
  const machine = createBlankMachineProfile('explicit-linear-panel');
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
