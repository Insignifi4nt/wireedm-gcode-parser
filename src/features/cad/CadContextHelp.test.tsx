import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CadContextHelp } from './CadContextHelp';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function trigger() { const button = container.querySelector<HTMLButtonElement>('button'); if (!button) throw new Error('Missing help trigger'); return button; }
describe('Contextual CAD help', () => {
  it('provides keyboard disclosure with Escape focus restoration and no immediate reopening', async () => {
    const inspected = vi.fn();
    await act(async () => root.render(<CadContextHelp label="Module" onOpenChange={inspected}><p>Module controls pitch diameter.</p></CadContextHelp>));
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    await act(async () => trigger().focus());
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Module help');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(inspected).toHaveBeenLastCalledWith(true);
    await act(async () => trigger().click());
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close Module help"]');
    expect(document.activeElement).toBe(close);
    await act(async () => close?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(inspected).toHaveBeenLastCalledWith(false);
  });
  it('keeps hover help reachable across the gap and removes the preview after leaving', async () => {
    vi.useFakeTimers();
    await act(async () => root.render(<CadContextHelp label="Root"><p>A trochoidal root.</p></CadContextHelp>));
    await act(async () => trigger().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    const panel = document.querySelector('[role="dialog"]');
    await act(async () => panel?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(300));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => panel?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(300));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('dismisses pinned help outside and releases selection and portals on unmount', async () => {
    const inspected = vi.fn();
    await act(async () => root.render(<CadContextHelp label="Tolerance" onOpenChange={inspected}><p>Maximum curve deviation.</p></CadContextHelp>));
    await act(async () => trigger().click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(inspected).toHaveBeenLastCalledWith(false);
    await act(async () => trigger().click());
    await act(async () => root.render(null));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(inspected).toHaveBeenLastCalledWith(false);
  });
});
