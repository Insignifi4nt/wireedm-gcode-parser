import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
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

  it('sets exact reviewed coordinates and previews the resulting G92', async () => {
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
    expect(container.textContent).toContain('G92 X-17.500 Y24.900');
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
  });
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
