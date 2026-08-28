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

  async function click(label: string) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
  }
});
