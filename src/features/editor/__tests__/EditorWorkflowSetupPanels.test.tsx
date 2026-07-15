import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCharmillesRobofil100V2CandidateProfile } from '@/domain/machine/machineProfiles';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import {
  EditorContourSetupPanel,
  EditorSetStartPanel
} from '../EditorWorkflowSetupPanels';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('canonical workflow target fallbacks', () => {
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

  it('passes the displayed fallback operation to every Contour Setup mutation', async () => {
    const document = twoCircleDocument();
    const fallbackOperation = document.plan.operations[0];
    const onReverse = vi.fn();
    const onSetClassification = vi.fn();
    const onSetCompensation = vi.fn();

    await act(async () => {
      root.render(
        <EditorContourSetupPanel
          disabled={false}
          document={document}
          machine={createCharmillesRobofil100V2CandidateProfile()}
          onReverse={onReverse}
          onSelectOperation={vi.fn()}
          onSetClassification={onSetClassification}
          onSetCompensation={onSetCompensation}
          selectedOperationId={null}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Reverse path operation"]')?.click();
      setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Contour role"]')!, 'hole');
      setSelect(
        container.querySelector<HTMLSelectElement>('[aria-label="Compensation kept material"]')!,
        'inside'
      );
    });

    expect(onReverse).toHaveBeenCalledWith(fallbackOperation.id);
    expect(onSetClassification).toHaveBeenCalledWith(fallbackOperation.id, 'hole');
    expect(onSetCompensation).toHaveBeenCalledWith(fallbackOperation.id, 'inside');
  });

  it('passes the displayed fallback contour when Set Start begins picking', async () => {
    const document = twoCircleDocument();
    const fallbackOperation = document.plan.operations[0];
    const onPickStart = vi.fn();

    await act(async () => {
      root.render(
        <EditorSetStartPanel
          disabled={false}
          document={document}
          magneticSnapEnabled={false}
          onPickStart={onPickStart}
          onSelectOperation={vi.fn()}
          onToggleMagneticSnap={vi.fn()}
          selectedOperationId={null}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Pick another start"]')?.click();
    });

    expect(onPickStart).toHaveBeenCalledWith(fallbackOperation.id);
  });
});

function twoCircleDocument() {
  return createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
  ]);
}

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
