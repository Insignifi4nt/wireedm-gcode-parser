import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    const onInferenceModeChange = vi.fn();

    await act(async () => {
      root.render(
        <EditorSetStartPanel
          disabled={false}
          document={document}
          inferenceMode="endpoint"
          onInferenceModeChange={onInferenceModeChange}
          onPickStart={onPickStart}
          onSelectOperation={vi.fn()}
          selectedOperationId={null}
        />
      );
    });

    await act(async () => {
      setSelect(
        container.querySelector<HTMLSelectElement>(
          '[aria-label="Set start point inference"]'
        )!,
        'midpoint'
      );
      container.querySelector<HTMLButtonElement>('[aria-label="Pick explicit contour start"]')?.click();
    });

    expect(onInferenceModeChange).toHaveBeenCalledWith('midpoint');
    expect(onPickStart).toHaveBeenCalledWith(fallbackOperation.id);
    expect(container.textContent).toContain('automatic contour start');
    expect(
      Array.from(
        container.querySelectorAll<HTMLOptionElement>(
          'select[aria-label="Set start point inference"] option'
        )
      ).map((option) => [option.value, option.textContent])
    ).toEqual([
      ['endpoint', 'Nearest endpoint'],
      ['nearest', 'Nearest point to cursor'],
      ['midpoint', 'Hovered side midpoint'],
      ['perpendicular', 'Perpendicular from approach']
    ]);
  });

  it('renders Contour Setup in duplicate execution order while preserving selection identity', async () => {
    const document = twoCircleDocument();
    const [first, second] = document.plan.operations;
    first.orderIndex = 9;
    second.orderIndex = 9;
    document.plan.operations = [second, first];

    await act(async () => {
      root.render(
        <EditorContourSetupPanel
          disabled={false}
          document={document}
          onReverse={vi.fn()}
          onSelectOperation={vi.fn()}
          onSetClassification={vi.fn()}
          onSetCompensation={vi.fn()}
          selectedOperationId={second.id}
        />
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Contour setup operation"]'
    )!;
    const options = [...select.options];
    expect(options.map((option) => option.value)).toEqual([first.id, second.id]);
    expect(options.map((option) => option.textContent)).toEqual([
      `01. ${first.displayName}`,
      `02. ${second.displayName}`
    ]);
    expect(select.value).toBe(second.id);
  });

  it('renders Set Start in gapped execution order while preserving selection identity', async () => {
    const document = twoCircleDocument();
    const [first, second] = document.plan.operations;
    first.orderIndex = 5;
    second.orderIndex = 17;
    document.plan.operations = [second, first];

    await act(async () => {
      root.render(
        <EditorSetStartPanel
          disabled={false}
          document={document}
          inferenceMode="endpoint"
          onInferenceModeChange={vi.fn()}
          onPickStart={vi.fn()}
          onSelectOperation={vi.fn()}
          selectedOperationId={second.id}
        />
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      '[aria-label="Set start operation"]'
    )!;
    const options = [...select.options];
    expect(options.map((option) => option.value)).toEqual([first.id, second.id]);
    expect(options.map((option) => option.textContent)).toEqual([
      `01. ${first.displayName}`,
      `02. ${second.displayName}`
    ]);
    expect(select.value).toBe(second.id);
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
