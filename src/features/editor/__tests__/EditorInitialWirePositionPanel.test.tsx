import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setGeometryLinkedInitialWirePosition, setManualInitialWirePosition, translatePathDocument } from '@/domain/path-editor/pathDocumentOperations';
import { EditorInitialWirePositionPanel } from '../EditorInitialWirePositionPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorInitialWirePositionPanel', () => {
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

  it('sets and previews exact reviewed controller-neutral coordinates', async () => {
    const onSetManual = vi.fn();
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: -17.5, y: 24.9 }, radius: 8 }
    ]);
    await act(async () => {
      root.render(
        <EditorInitialWirePositionPanel
          disabled={false}
          document={document}
          onSetGeometryLinked={vi.fn()}
          onSetManual={onSetManual}
        />
      );
    });

    const x = container.querySelector('[aria-label="Initial wire X"]') as HTMLInputElement;
    const y = container.querySelector('[aria-label="Initial wire Y"]') as HTMLInputElement;
    await act(async () => {
      setInput(x, '-17.5');
      setInput(y, '24.9');
      container.querySelector<HTMLButtonElement>('[aria-label="Review and set manual initial wire position"]')?.click();
    });

    expect(onSetManual).toHaveBeenCalledWith({ x: -17.5, y: 24.9 });
    const reviewed = setManualInitialWirePosition(document, onSetManual.mock.calls[0][0]);
    if (!reviewed) throw new Error('Expected valid reviewed position');
    await act(async () => root.render(
      <EditorInitialWirePositionPanel disabled={false} document={reviewed} onSetGeometryLinked={vi.fn()} onSetManual={onSetManual} />
    ));
    expect(container.querySelector('[data-initial-wire-position-preview]')?.textContent).toBe('X-17.500 Y24.900');

    const translated = translatePathDocument(reviewed, { x: 10, y: 0 });
    if (!translated) throw new Error('Expected translated document');
    await act(async () => root.render(
      <EditorInitialWirePositionPanel disabled={false} document={translated} onSetGeometryLinked={vi.fn()} onSetManual={onSetManual} />
    ));
    expect(container.querySelector('[data-initial-wire-position-preview]')?.textContent).toBe('A reviewed point is required');
  });

  it('offers circle centers as semantic transform-linked points', async () => {
    const onSetGeometryLinked = vi.fn();
    const document = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 10, y: 20 }, radius: 5 }
    ]);
    await act(async () => {
      root.render(
        <EditorInitialWirePositionPanel
          disabled={false}
          document={document}
          onSetGeometryLinked={onSetGeometryLinked}
          onSetManual={vi.fn()}
        />
      );
    });

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-initial-wire-circle-center]')?.click();
    });

    expect(onSetGeometryLinked).toHaveBeenCalledWith(document.segments[0].id);
    const linked = setGeometryLinkedInitialWirePosition(document, document.segments[0].id)!;
    await act(async () => root.render(
      <EditorInitialWirePositionPanel disabled={false} document={linked} onSetGeometryLinked={onSetGeometryLinked} onSetManual={vi.fn()} />
    ));
    const choice = container.querySelector('[data-initial-wire-circle-center]');
    expect(choice?.getAttribute('aria-pressed')).toBe('true');
    expect(choice?.getAttribute('aria-label')).toContain(linked.plan.operations[0].displayName);
    expect(choice?.textContent).toContain('R5.000');
    await act(async () => {
      setInput(container.querySelector<HTMLInputElement>('[aria-label="Initial wire X"]')!, '99');
    });
    expect(container.querySelector('[data-initial-wire-position-pending]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-initial-wire-circle-center]')?.click());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Initial wire X"]')?.value).toBe('10');
    expect(container.querySelector('[data-initial-wire-position-pending]')).toBeNull();
  });

  it('opens stale manual coordinates for review without treating them as an active position', async () => {
    const source = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
    const manual = setManualInitialWirePosition(source, { x: -12.5, y: 7 })!;
    const moved = translatePathDocument(manual, { x: 5, y: 0 })!;
    const onSetManual = vi.fn();
    await act(async () => root.render(
      <EditorInitialWirePositionPanel disabled={false} document={moved} onSetGeometryLinked={vi.fn()} onSetManual={onSetManual} />
    ));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Initial wire X"]')?.value).toBe('-12.5');
    expect(container.querySelector<HTMLInputElement>('[aria-label="Initial wire Y"]')?.value).toBe('7');
    expect(container.querySelector('[data-initial-wire-position-preview]')?.textContent).toBe('A reviewed point is required');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review and set manual initial wire position"]')?.click());
    expect(onSetManual).toHaveBeenCalledWith({ x: -12.5, y: 7 });
  });
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
