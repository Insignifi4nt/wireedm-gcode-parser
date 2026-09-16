import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
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

  it.each([{ side: 'Entry', partial: false }, { side: 'Exit', partial: false }, { side: 'Entry', partial: true }, { side: 'Exit', partial: true }] as const)('blocks a coincident $side (partial $partial) and permits correcting it', async ({ side, partial }) => {
    let document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    if (partial) document = setMachiningSpanParticipation(document, { sourceSegmentId: document.segments[0].id, range: side === 'Entry' ? { start: 0, end: 0.4 } : { start: 0.6, end: 1 }, participation: 'inactive-reference' })!;
    const endpointX = partial ? (side === 'Entry' ? 4 : 6) : (side === 'Entry' ? 0 : 10);
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
    await setCoordinate('X', String(endpointX));
    await setCoordinate('Y', '0');
    const button = container.querySelector<HTMLButtonElement>(`[aria-label="Set straight ${side.toLowerCase()}"]`)!;
    expect(button.disabled).toBe(true);
    await act(async () => button.click());
    expect(onApply).not.toHaveBeenCalled();
    await setCoordinate('Y', '2');
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(onApply).toHaveBeenCalledWith(operation.id, { x: endpointX, y: 2 });
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

  it('sets the first entry by rapid distance from the initial wire', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 11.2, y: 0 }, end: { x: 20, y: 0 }
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    const onSetManualEntry = vi.fn();
    await act(async () => root.render(
      <EditorEntryExitPanel canvasPickMode={null} disabled={false} document={document}
        onCanvasPickModeChange={vi.fn()} onSelectOperation={vi.fn()} onSetCircleCenterEntry={vi.fn()}
        onSetManualEntry={onSetManualEntry} onSetManualExit={vi.fn()} onSetNoEntry={vi.fn()}
        onSetNoExit={vi.fn()} selectedOperationId={document.plan.operations[0].id} />
    ));

    await selectMode('Entry input mode', 'rapid-length');
    await setInput('Entry rapid distance (mm)', '4');
    expect(container.textContent).toContain('Lead-in 7.2 mm · rapid 4 mm');
    await click('Set straight entry');
    expect(onSetManualEntry).toHaveBeenCalledWith(document.plan.operations[0].id, { x: 4, y: 0 });

    await setInput('Entry rapid distance (mm)', '11.2');
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Set straight entry"]')?.disabled).toBe(true);
  });

  it('resizes reviewed entry and exit leads by millimeters along their existing directions', async () => {
    const document = createUpidFromDxfEntities([{
      type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    }]);
    const operation = document.plan.operations[0];
    operation.transitions = {
      entry: { strategy: 'manual-straight', move: 'cut', from: { x: -2, y: 0 }, to: operation.startPoint, review: 'reviewed' },
      exit: { strategy: 'manual-straight', move: 'cut', from: operation.endPoint, to: { x: 12, y: 0 }, review: 'reviewed' }
    };
    const onSetManualEntry = vi.fn();
    const onSetManualExit = vi.fn();
    await act(async () => root.render(
      <EditorEntryExitPanel canvasPickMode={null} disabled={false} document={document}
        onCanvasPickModeChange={vi.fn()} onSelectOperation={vi.fn()} onSetCircleCenterEntry={vi.fn()}
        onSetManualEntry={onSetManualEntry} onSetManualExit={onSetManualExit} onSetNoEntry={vi.fn()}
        onSetNoExit={vi.fn()} selectedOperationId={operation.id} />
    ));

    await selectMode('Entry input mode', 'lead-length');
    await setInput('Entry lead-in length (mm)', '3');
    await click('Set straight entry');
    expect(onSetManualEntry).toHaveBeenCalledWith(operation.id, { x: -3, y: 0 });
    await selectMode('Exit input mode', 'lead-length');
    await setInput('Exit lead-out length (mm)', '4');
    await click('Set straight exit');
    expect(onSetManualExit).toHaveBeenCalledWith(operation.id, { x: 14, y: 0 });
  });

  async function selectMode(label: string, value: string) {
    const select = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function setInput(label: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(label: string) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
  }
});
