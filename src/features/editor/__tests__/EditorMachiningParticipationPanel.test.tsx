import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { EditorMachiningParticipationPanel } from '../EditorMachiningParticipationPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorMachiningParticipationPanel', () => {
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

  it('authors inactive ranges, explicit wire side, and restoration through typed callbacks', async () => {
    const document = createUpidFromDxfEntities([
      line(0, 0, 10, 0), line(10, 0, 10, 5), line(10, 5, 0, 5), line(0, 5, 0, 0)
    ]);
    const operation = document.plan.operations[0];
    document.machiningParticipation = {
      spans: [{
        id: 'span_existing',
        sourceSegmentId: operation.segmentRefs[0].segmentId,
        range: { start: 0.2, end: 0.8 },
        participation: 'inactive-reference'
      }]
    };
    const onSetSpan = vi.fn();
    const onSetWireSide = vi.fn();
    const onSetEntryReview = vi.fn();
    await act(async () => root.render(
      <EditorMachiningParticipationPanel
        disabled={false}
        document={document}
        onSetSpan={onSetSpan}
        onSetEntryReview={onSetEntryReview}
        onSetWireSide={onSetWireSide}
        selectedOperationId={operation.id}
      />
    ));

    await act(async () => {
      setInput(container.querySelector('[aria-label="Machining span start"]')!, '0.1');
      setInput(container.querySelector('[aria-label="Machining span end"]')!, '0.3');
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Mark inactive reference'))
        ?.click();
    });
    expect(onSetSpan).toHaveBeenCalledWith(expect.objectContaining({
      range: { start: 0.1, end: 0.3 },
      participation: 'inactive-reference'
    }));

    await act(async () => {
      setSelect(container.querySelector('[aria-label="Partial contour wire side"]')!, 'right');
    });
    expect(onSetWireSide).toHaveBeenCalledWith(operation.id, 'right');

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Review derived partial entry"]')?.click();
    });
    expect(onSetEntryReview).toHaveBeenCalledWith(operation.id, true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Restore span_existing to active cut"]')?.click();
    });
    expect(onSetSpan).toHaveBeenLastCalledWith(expect.objectContaining({
      range: { start: 0.2, end: 0.8 },
      participation: 'active-cut'
    }));
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

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
