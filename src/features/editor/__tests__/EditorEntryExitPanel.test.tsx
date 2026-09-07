import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  it.each(['Entry', 'Exit'] as const)('preserves pending %s coordinates when the opposite transition is applied', async (side) => {
    const source = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const operationId = source.plan.operations[0].id;
    const onApply = vi.fn();
    const render = (document: typeof source) => root.render(
      <EditorEntryExitPanel canvasPickMode={null} disabled={false} document={document}
        onCanvasPickModeChange={vi.fn()} onSelectOperation={vi.fn()} onSetCircleCenterEntry={vi.fn()}
        onSetManualEntry={onApply} onSetManualExit={onApply} onSetNoEntry={vi.fn()}
        onSetNoExit={vi.fn()} selectedOperationId={operationId} />
    );
    await act(async () => render(source));
    for (const [axis, value] of [['X', '3'], ['Y', '4']]) {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${side} ${axis}"]`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const changed = structuredClone(source);
    changed.plan.operations[0].transitions = side === 'Entry'
      ? { exit: { strategy: 'manual-straight', move: 'cut', from: { x: 10, y: 0 }, to: { x: 12, y: 0 }, review: 'reviewed' } }
      : { entry: { strategy: 'manual-straight', move: 'cut', from: { x: -2, y: 0 }, to: { x: 0, y: 0 }, review: 'reviewed' } };
    await act(async () => render(changed));
    await click(`Set straight ${side.toLowerCase()}`);
    expect(onApply).toHaveBeenCalledWith(operationId, { x: 3, y: 4 });
  });

  it('authors reviewed no-entry and no-exit intent without a machine policy', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const operationId = document.plan.operations[0].id;
    const onSetNoEntry = vi.fn();
    const onSetNoExit = vi.fn();
    await act(async () => root.render(
      <EditorEntryExitPanel canvasPickMode={null} disabled={false} document={document}
        onCanvasPickModeChange={vi.fn()} onSelectOperation={vi.fn()} onSetCircleCenterEntry={vi.fn()}
        onSetManualEntry={vi.fn()} onSetManualExit={vi.fn()} onSetNoEntry={onSetNoEntry}
        onSetNoExit={onSetNoExit} selectedOperationId={operationId} />
    ));

    expect(container.textContent).toContain('Direct contour entry · no lead geometry');
    expect(container.textContent).toContain('Direct contour exit · no lead geometry');

    await click('Use reviewed no entry');
    await click('Use reviewed no exit');
    expect(onSetNoEntry).toHaveBeenCalledWith(operationId);
    expect(onSetNoExit).toHaveBeenCalledWith(operationId);
  });

  it.each(['Entry', 'Exit'] as const)('blocks a coincident %s and permits correcting its coordinates', async (side) => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const operation = document.plan.operations[0];
    const onApply = vi.fn();
    await act(async () => root.render(
      <EditorEntryExitPanel canvasPickMode={null} disabled={false} document={document}
        onCanvasPickModeChange={vi.fn()} onSelectOperation={vi.fn()} onSetCircleCenterEntry={vi.fn()}
        onSetManualEntry={onApply} onSetManualExit={onApply} onSetNoEntry={vi.fn()}
        onSetNoExit={vi.fn()} selectedOperationId={operation.id} />
    ));
    const setCoordinate = async (axis: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`[aria-label="${side} ${axis}"]`)!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    await setCoordinate('X', side === 'Entry' ? '0' : '10');
    await setCoordinate('Y', '0');
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="Set straight ${side.toLowerCase()}"]`)!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onApply).not.toHaveBeenCalled();
    await setCoordinate('Y', '2');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(onApply).toHaveBeenCalledWith(operation.id, { x: side === 'Entry' ? 0 : 10, y: 2 });
    await setCoordinate('Y', '0');
    await setCoordinate('X', '5');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('touches or overlaps 1 source segment');
    expect(button.disabled).toBe(false);
    await setCoordinate('Y', '2');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('shows required transition review and submits the displayed coordinates for confirmation', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const operation = document.plan.operations[0];
    operation.transitions = {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: -2, y: 0 }, to: operation.startPoint, review: 'required' },
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: 12, y: 0 }, review: 'required' }
    };
    const entry = vi.fn();
    const exit = vi.fn();
    await act(async () => root.render(
      <EditorEntryExitPanel canvasPickMode={null} disabled={false} document={document}
        onCanvasPickModeChange={vi.fn()} onSelectOperation={vi.fn()} onSetCircleCenterEntry={vi.fn()}
        onSetManualEntry={entry} onSetManualExit={exit} onSetNoEntry={vi.fn()}
        onSetNoExit={vi.fn()} selectedOperationId={operation.id} />
    ));
    expect(container.querySelector('[data-entry-strategy]')?.textContent).toContain('Review required');
    expect(container.querySelector('[data-exit-strategy]')?.textContent).toContain('Review required');
    await click('Set straight entry');
    await click('Set straight exit');
    expect(entry).toHaveBeenCalledWith(operation.id, { x: -2, y: 0 });
    expect(exit).toHaveBeenCalledWith(operation.id, { x: 12, y: 0 });
  });

  async function click(label: string) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
  }
});
