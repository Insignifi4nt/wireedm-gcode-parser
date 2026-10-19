import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { EditorFloatingPanel } from '../EditorWorkspacePanels';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const initialGeometry = { x: 300, y: 120, width: 340, height: 430 };

function pointer(type: string, pointerId = 1, clientX = 320, clientY = 130) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}
function harness() {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container), changed = vi.fn(), ended = vi.fn();
  function Harness({ compactOpen = true }: { compactOpen?: boolean }) {
    const [geometry, setGeometry] = useState(initialGeometry), [visible, setVisible] = useState(true);
    return visible && <EditorFloatingPanel id="transform" title="Transform" geometry={geometry}
      onDock={vi.fn()} onFloat={vi.fn()} onDragEnd={ended} onGeometryChange={next => { changed(next); setGeometry(next); }}
      onHide={() => setVisible(false)} isCompactWorkflow compactDrawerOpen={compactOpen}
      onCloseCompactDrawer={() => setVisible(false)}>Tools</EditorFloatingPanel>;
  }
  const render = (compactOpen = true) => act(() => root.render(<Harness compactOpen={compactOpen} />));
  const button = (action: string) => {
    const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${action} Transform"]`);
    if (!element) throw new Error(`Missing ${action} handle`);
    return element;
  };
  render();
  return { container, changed, ended, render, button, unmount: () => act(() => root.render(null)),
    dispose: () => { act(() => root.unmount()); container.remove(); } };
}

describe('floating panel pointer lifetime', () => {
  it.each(['Move', 'Resize'] as const)('applies ordinary %s events and stops on the matching release', action => {
    const h = harness();
    try {
      act(() => h.button(action).dispatchEvent(pointer('pointerdown')));
      act(() => window.dispatchEvent(pointer('pointermove', 1, 400, 200)));
      expect(h.changed).toHaveBeenCalledWith(action === 'Move'
        ? { ...initialGeometry, x: 380, y: 190 } : { ...initialGeometry, width: 420, height: 500 });
      act(() => window.dispatchEvent(pointer('pointerup', 1, 400, 200)));
      expect(h.ended).toHaveBeenCalledTimes(action === 'Move' ? 1 : 0);
      if (action === 'Move') expect(h.ended).toHaveBeenCalledWith({ x: 400, y: 200 });
      h.changed.mockClear();
      act(() => window.dispatchEvent(pointer('pointermove', 1, 500, 300)));
      expect(h.changed).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });

  it.each(['unmount', 'compact close', 'pointercancel', 'blur'] as const)(
    'retains applied geometry and removes all callbacks after %s', change => {
      const h = harness();
      try {
        act(() => h.button('Move').dispatchEvent(pointer('pointerdown')));
        act(() => window.dispatchEvent(pointer('pointermove', 1, 400, 200)));
        expect(h.changed).toHaveBeenCalledOnce();
        expect(h.container.querySelector<HTMLElement>('[data-editor-floating-panel]')?.style.left).toBe('380px');
        h.changed.mockClear();
        if (change === 'unmount') h.unmount();
        if (change === 'compact close') h.render(false);
        if (change === 'pointercancel') act(() => window.dispatchEvent(pointer('pointercancel')));
        if (change === 'blur') act(() => window.dispatchEvent(new Event('blur')));
        act(() => {
          window.dispatchEvent(pointer('pointermove', 1, 500, 300));
          window.dispatchEvent(pointer('pointerup', 1, 500, 300));
        });
        expect(h.changed).not.toHaveBeenCalled(); expect(h.ended).not.toHaveBeenCalled();
        if (change === 'pointercancel' || change === 'blur') {
          expect(h.container.querySelector<HTMLElement>('[data-editor-floating-panel]')?.style.left).toBe('380px');
        }
      } finally { h.dispose(); }
    }
  );

  it.each(['Move', 'Resize'] as const)('ignores foreign pointer events during %s without ending the active interaction', action => {
    const h = harness();
    try {
      act(() => h.button(action).dispatchEvent(pointer('pointerdown')));
      act(() => {
        window.dispatchEvent(pointer('pointermove', 2, 900, 600));
        window.dispatchEvent(pointer('pointerup', 2, 900, 600));
        window.dispatchEvent(pointer('pointercancel', 2));
      });
      expect(h.changed).not.toHaveBeenCalled(); expect(h.ended).not.toHaveBeenCalled();
      act(() => {
        window.dispatchEvent(pointer('pointermove', 1, 400, 200));
        window.dispatchEvent(pointer('pointerup', 1, 400, 200));
      });
      expect(h.changed).toHaveBeenCalledOnce();
      expect(h.ended).toHaveBeenCalledTimes(action === 'Move' ? 1 : 0);
    } finally { h.dispose(); }
  });

  it('removes resize listeners on cancellation', () => {
    const h = harness();
    try {
      act(() => h.button('Resize').dispatchEvent(pointer('pointerdown')));
      act(() => window.dispatchEvent(pointer('pointercancel')));
      act(() => {
        window.dispatchEvent(pointer('pointermove', 1, 400, 200));
        window.dispatchEvent(pointer('pointerup', 1, 400, 200));
      });
      expect(h.changed).not.toHaveBeenCalled(); expect(h.ended).not.toHaveBeenCalled();
    } finally { h.dispose(); }
  });
});
