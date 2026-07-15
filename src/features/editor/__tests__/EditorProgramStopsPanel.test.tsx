import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharmillesRobofil100V2CandidateProfile } from '@/domain/machine/machineProfiles';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { EditorProgramStopsPanel } from '../EditorProgramStopsPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorProgramStopsPanel', () => {
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

  it('authors a part-retention stop with an exact remaining distance', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const onSetStops = vi.fn();
    await act(async () => root.render(
      <EditorProgramStopsPanel
        disabled={false}
        document={document}
        machine={createCharmillesRobofil100V2CandidateProfile()}
        onSetStops={onSetStops}
        selectedOperationId={document.plan.operations[0].id}
      />
    ));
    await act(async () => {
      setInput(
        container.querySelector<HTMLInputElement>('[aria-label="Program stop remaining cut millimeters"]')!,
        '2.5'
      );
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Add M00 stop'))
        ?.click();
    });

    expect(onSetStops).toHaveBeenCalledWith(document.plan.operations[0].id, [
      expect.objectContaining({
        enabled: true,
        placement: { kind: 'before-operation-end', remainingCutLengthMm: 2.5 },
        reason: 'part-retention'
      })
    ], true);
  });
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
