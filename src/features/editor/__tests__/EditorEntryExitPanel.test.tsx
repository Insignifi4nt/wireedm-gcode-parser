import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharmillesRobofil100V2CandidateProfile } from '@/domain/machine/machineProfiles';
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

  it('shows actual entry strategy and authors exact exit and threading intent', async () => {
    let document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    document = setCircleOperationCenterPierceLeadIn(
      document,
      document.plan.operations[1].id
    )!;
    const onSetManualExit = vi.fn();
    const onSetOperationThreading = vi.fn();
    await act(async () => {
      root.render(
        <EditorEntryExitPanel
          disabled={false}
          document={document}
          machine={createCharmillesRobofil100V2CandidateProfile()}
          onSelectOperation={vi.fn()}
          onSetCircleCenterEntry={vi.fn()}
          onSetManualEntry={vi.fn()}
          onSetManualExit={onSetManualExit}
          onSetPlannedRapidDestination={vi.fn()}
          onSetPlannedRapidSource={vi.fn()}
          onSetOperationThreading={onSetOperationThreading}
          onSetProjectThreading={vi.fn()}
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
      setSelect(
        container.querySelector<HTMLSelectElement>('[aria-label="Operation threading mode"]')!,
        'manual'
      );
    });

    expect(onSetManualExit).toHaveBeenCalledWith(
      document.plan.operations[1].id,
      { x: 27.5, y: 1.25 }
    );
    expect(onSetOperationThreading).toHaveBeenCalledWith(
      document.plan.operations[1].id,
      { mode: 'manual', wireSeparation: 'already-separated' }
    );
  });
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
