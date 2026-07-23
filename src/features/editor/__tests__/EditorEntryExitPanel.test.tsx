import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createCharmillesRobofil100V2CandidateProfile,
  markMachineProfileUserVerified
} from '@/domain/machine/machineProfiles';
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
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
