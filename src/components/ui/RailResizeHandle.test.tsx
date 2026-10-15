import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RailResizeHandle } from './RailResizeHandle';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
function pointer(type: string, clientX: number, buttons = type === 'pointerdown' || type === 'pointermove' ? 1 : 0, pointerId = 17) {
  const event = new MouseEvent(type, { clientX, button: 0, buttons, bubbles: true, cancelable: true });
  Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
  return event;
}
async function fixture(side: 'left' | 'right' = 'left') {
  const changed = vi.fn();
  let props: ComponentProps<typeof RailResizeHandle> = { label: 'Resize rail', side, width: 220, minWidth: 100, maxWidth: 500, onWidthChange: changed };
  async function render(next: Partial<typeof props> = {}) { props = { ...props, ...next }; await act(async () => root.render(<RailResizeHandle {...props} />)); }
  await render();
  const separator = container.querySelector<HTMLDivElement>('[role="separator"]');
  if (!separator) throw new Error('Missing resize separator');
  const element: HTMLDivElement = separator;
  async function down(x = 100) { await act(async () => element.dispatchEvent(pointer('pointerdown', x))); }
  async function move(x: number, buttons = 1, pointerId = 17) { await act(async () => window.dispatchEvent(pointer('pointermove', x, buttons, pointerId))); }
  return { element, changed, render, down, move };
}

describe('shared rail resize lifecycle', () => {
  it('stops when the pressed button was released outside the browser', async () => {
    const h = await fixture(); await h.down(); await h.move(200);
    expect(h.changed).toHaveBeenLastCalledWith(320);
    await h.move(400, 0); await h.move(450);
    expect(h.changed).toHaveBeenCalledTimes(1);
    await h.down(); await h.move(130); expect(h.changed).toHaveBeenLastCalledWith(250);
  });
  it('captures the pointer and stops/relinquishes capture on window blur', async () => {
    const h = await fixture(); let captured = false;
    const release = vi.fn(() => { captured = false; });
    const capture = vi.fn(() => { captured = true; });
    Object.assign(h.element, { setPointerCapture: capture, hasPointerCapture: () => captured, releasePointerCapture: release });
    await h.down(); expect(capture).toHaveBeenCalledWith(17); await h.move(130);
    await act(async () => window.dispatchEvent(new Event('blur')));
    expect(release).toHaveBeenCalledWith(17); await h.move(250);
    expect(h.changed).toHaveBeenCalledTimes(1);
  });
  it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('stops on %s and ignores a different pointer', async ending => {
    const h = await fixture(); await h.down(); await h.move(160, 1, 19);
    expect(h.changed).not.toHaveBeenCalled();
    const target = ending === 'lostpointercapture' ? h.element : window;
    await act(async () => target.dispatchEvent(pointer(ending, 160, 0, 19)));
    await h.move(160); expect(h.changed).toHaveBeenLastCalledWith(280);
    await act(async () => target.dispatchEvent(pointer(ending, 160)));
    await h.move(200); expect(h.changed).toHaveBeenCalledTimes(1);
  });
  it('uses committed bounds and callbacks if workspace constraints change during a drag', async () => {
    const h = await fixture(); await h.down(); await h.move(130);
    const latest = vi.fn();
    await h.render({ width: 250, minWidth: 240, maxWidth: 260, onWidthChange: latest });
    await h.move(400); expect(latest).toHaveBeenLastCalledWith(260);
    await h.move(-200); expect(latest).toHaveBeenLastCalledWith(240);
    expect(h.changed).toHaveBeenCalledTimes(1);
    expect(h.element.getAttribute('aria-valuenow')).toBe('250');
    expect(h.element.getAttribute('aria-valuemin')).toBe('240'); expect(h.element.getAttribute('aria-valuemax')).toBe('260');
  });
  it('cleans up an active drag when the rail disappears', async () => {
    const h = await fixture(); await h.down(); await h.move(150);
    await act(async () => root.render(null)); await h.move(250);
    expect(h.changed).toHaveBeenCalledTimes(1);
  });
  it('retains left/right keyboard directions, fine steps and accessible width limits', async () => {
    const h = await fixture('right');
    async function key(key: string, shiftKey = false) { await act(async () => h.element.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }))); }
    await key('ArrowLeft'); expect(h.changed).toHaveBeenLastCalledWith(230);
    await key('ArrowRight', true); expect(h.changed).toHaveBeenLastCalledWith(219);
    await key('Home'); expect(h.changed).toHaveBeenLastCalledWith(100);
    await key('End'); expect(h.changed).toHaveBeenLastCalledWith(500);
    expect(h.element.tabIndex).toBe(0); expect(h.element.getAttribute('aria-orientation')).toBe('vertical');
  });
});
