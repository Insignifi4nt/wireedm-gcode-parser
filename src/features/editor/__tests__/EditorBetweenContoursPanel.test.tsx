import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setManualInitialWirePosition,
  setPathOperationTransitions
} from '@/domain/path-editor/pathDocumentOperations';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { EditorBetweenContoursPanel } from '../EditorBetweenContoursPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorBetweenContoursPanel', () => {
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

  it('shows later derived travel as read-only and owns rethreading controls', async () => {
    let document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    document = setManualInitialWirePosition(document, { x: -10, y: 0 })!;
    const [first, second] = document.plan.operations;
    document = setPathOperationTransitions(document, first.id, {
      exit: {
        strategy: 'manual-straight',
        move: 'cut',
        from: first.endPoint,
        to: { x: 7, y: 0 },
        review: 'reviewed'
      }
    })!;
    document = setPathOperationTransitions(document, second.id, {
      entry: {
        strategy: 'manual-straight',
        move: 'cut',
        from: { x: 13, y: 0 },
        to: second.startPoint,
        review: 'reviewed'
      }
    })!;
    const onSetOperationThreading = vi.fn();
    const onSetProjectThreading = vi.fn();

    await act(async () => {
      root.render(
        <EditorBetweenContoursPanel
          disabled={false}
          document={document}
          onSelectOperation={vi.fn()}
          onSetOperationThreading={onSetOperationThreading}
          onSetProjectThreading={onSetProjectThreading}
          selectedOperationId={second.id}
        />
      );
    });

    expect(container.textContent).toContain('After Exterior 1');
    expect(container.textContent).toContain('X7.000 Y0.000');
    expect(container.textContent).toContain('X13.000 Y0.000');
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Rethreading');
    const defaultSelect = container.querySelector<HTMLSelectElement>('[aria-label="Project threading default"]')!;
    expect(defaultSelect.value).toBe('');
    await act(async () => setSelect(defaultSelect, 'manual'));
    expect(onSetProjectThreading).toHaveBeenCalledWith({ mode: 'manual', wireSeparation: 'already-separated' });

    await act(async () => {
      setSelect(
        container.querySelector<HTMLSelectElement>('[aria-label="Operation threading mode"]')!,
        'manual'
      );
    });
    expect(onSetOperationThreading).toHaveBeenCalledWith(
      second.id,
      { mode: 'manual', wireSeparation: 'already-separated' }
    );
    document.setup = { ...document.setup,
      threadingDefault: { mode: 'manual', wireSeparation: 'already-separated' }
    };
    await act(async () => root.render(
      <EditorBetweenContoursPanel disabled={false} document={document}
        onSelectOperation={vi.fn()} onSetOperationThreading={onSetOperationThreading}
        onSetProjectThreading={onSetProjectThreading} selectedOperationId={second.id} />
    ));
    await act(async () => setSelect(
      container.querySelector<HTMLSelectElement>('[aria-label="Project manual wire separation"]')!,
      'manual-before-positioning'
    ));
    expect(onSetProjectThreading).toHaveBeenLastCalledWith({ mode: 'manual', wireSeparation: 'manual-before-positioning' });
    expect(onSetOperationThreading).toHaveBeenCalledTimes(1);
  });

  it('directs the first connection to Initial wire position', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);

    await act(async () => {
      root.render(
        <EditorBetweenContoursPanel
          disabled={false}
          document={document}
          onSelectOperation={vi.fn()}
          onSetOperationThreading={vi.fn()}
          onSetProjectThreading={vi.fn()}
          selectedOperationId={document.plan.operations[0].id}
        />
      );
    });

    expect(container.textContent).toContain('Initial wire position');
    expect(container.textContent).not.toContain('Operation threading mode');
  });

  it('recommends separating rapid for the hole-to-exterior move across finished material', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70.5 }
    ]);
    document.geometryBasis = 'finished-contour';
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' } };
    const second = document.plan.operations[1];
    const onSetOperationThreading = vi.fn();
    await act(async () => root.render(
      <EditorBetweenContoursPanel disabled={false} document={document} onSelectOperation={vi.fn()}
        onSetOperationThreading={onSetOperationThreading} onSetProjectThreading={vi.fn()}
        selectedOperationId={second.id} />
    ));
    expect(container.querySelector('[data-positioning-material]')?.textContent)
      .toContain('inside the finished solid');
    await act(async () => setSelect(
      container.querySelector<HTMLSelectElement>('[aria-label="Operation threading mode"]')!, 'manual'
    ));
    expect(onSetOperationThreading).toHaveBeenCalledWith(second.id,
      { mode: 'manual', wireSeparation: 'automatic-during-positioning' });
  });

  it('shows source contact review for continuous travel without claiming physical clearance', async () => {
    let document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ], { allowReverseClosedContours: false });
    document = setManualInitialWirePosition(document, { x: -10, y: 0 })!;
    document.setup = { ...document.setup, threadingDefault: { mode: 'continuous', wireSeparation: 'already-separated' } };
    await act(async () => root.render(
      <EditorBetweenContoursPanel disabled={false} document={document} onSelectOperation={vi.fn()}
        onSetOperationThreading={vi.fn()} onSetProjectThreading={vi.fn()} selectedOperationId={document.plan.operations[1].id} />
    ));
    expect(container.querySelector('[data-continuous-source-check]')?.textContent).toContain('touches or overlaps 1 source segment');
    expect(container.textContent).toContain('Continuous mode requires an already clear route');
    expect(container.textContent).toContain('do not establish stock, fixture or wire-offset clearance');
  });

  it('renders gapped imported indices by deterministic execution position', async () => {
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 20, y: 0 }, radius: 5 }
    ]);
    const [first, second] = document.plan.operations;
    first.orderIndex = 5;
    second.orderIndex = 17;
    document.plan.operations = [second, first];

    await act(async () => {
      root.render(
        <EditorBetweenContoursPanel
          disabled={false}
          document={document}
          onSelectOperation={vi.fn()}
          onSetOperationThreading={vi.fn()}
          onSetProjectThreading={vi.fn()}
          selectedOperationId={second.id}
        />
      );
    });

    const options = [
      ...container.querySelectorAll<HTMLOptionElement>(
        '[aria-label="Between contours destination operation"] option'
      )
    ];
    expect(options.map((option) => option.value)).toEqual([first.id, second.id]);
    expect(options.map((option) => option.textContent)).toEqual([
      `01. ${first.displayName}`,
      `02. ${second.displayName}`
    ]);
    expect(container.textContent).toContain(`After ${first.displayName}`);
  });
});

function setSelect(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
