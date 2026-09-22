import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentActivity } from '@/features/webmcp/AgentActivity';
import { StatusNotificationMenu, type StatusToast } from './StatusToasts';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const notifications: StatusToast[] = [{ id: 'saved', type: 'success', message: 'Project saved.', createdAt: 0 }];
function render(items = notifications) {
  act(() => root.render(<StatusNotificationMenu notifications={items} agentContent={<>
    <AgentActivity activity={{ registration: 'unsupported', calls: [] }} />
    <a href="blob:preview" download="part.png">Preview PNG</a>
  </>} />));
}
function trigger() { return container.querySelector<HTMLButtonElement>('[aria-label="Open notifications"]')!; }
function panel() { return document.querySelector<HTMLDivElement>('[data-status-notification-menu]'); }
function tab(name: string) { return [...panel()!.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === name)!; }
function click(element: HTMLElement) { act(() => element.click()); }
function key(element: HTMLElement, key: string) { act(() => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); }

describe('notification and agent panels', () => {
  it('opens on Notifications every time and keeps agent status and preview access inside its tab', () => {
    render();
    click(trigger());
    expect(tab('Notifications').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab('Notifications'));
    expect(panel()!.textContent).toContain('Project saved.');
    click(tab('Agent'));
    expect(panel()!.textContent).toContain('This browser does not support WebMCP agent tools.');
    expect(panel()!.querySelector('a[download]')?.getAttribute('href')).toBe('blob:preview');
    expect(panel()!.querySelector('details')).toBeNull();
    render([...notifications, { id: 'other', type: 'info', message: 'Another notification.', createdAt: 1 }]);
    expect(tab('Agent').getAttribute('aria-selected')).toBe('true');
    click(trigger()); click(trigger());
    expect(tab('Notifications').getAttribute('aria-selected')).toBe('true');
    expect(panel()!.textContent).toContain('Another notification.');
  });

  it('supports roving keyboard tabs, matching panel labels and Escape focus restoration', () => {
    render([]); click(trigger());
    expect(panel()!.textContent).toContain('No notifications');
    key(tab('Notifications'), 'ArrowRight');
    expect(document.activeElement).toBe(tab('Agent'));
    expect(tab('Agent').tabIndex).toBe(0); expect(tab('Notifications').tabIndex).toBe(-1);
    const content = panel()!.querySelector('[role="tabpanel"]')!;
    expect(content.id).toBe(tab('Agent').getAttribute('aria-controls'));
    expect(content.getAttribute('aria-labelledby')).toBe(tab('Agent').id);
    key(tab('Agent'), 'Home'); expect(document.activeElement).toBe(tab('Notifications'));
    key(tab('Notifications'), 'End'); expect(document.activeElement).toBe(tab('Agent'));
    key(tab('Agent'), 'ArrowRight'); expect(document.activeElement).toBe(tab('Notifications'));
    key(tab('Notifications'), 'Escape');
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(trigger());
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('dismisses for outside pointer or focus without closing for activity and preview interactions', () => {
    render(); click(trigger()); click(tab('Agent'));
    const link = panel()!.querySelector('a')!;
    act(() => { link.focus(); link.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(panel()).not.toBeNull();
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(panel()).toBeNull();
    click(trigger());
    const outside = document.createElement('button'); container.append(outside);
    act(() => outside.focus());
    expect(panel()).toBeNull(); expect(document.activeElement).toBe(outside);
  });

  it('clamps the portalled panel to a narrow viewport and flips above a low trigger', () => {
    vi.stubGlobal('innerWidth', 320); vi.stubGlobal('innerHeight', 240);
    render();
    const bounds = vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({ left: 10, right: 40, top: 10, bottom: 30, width: 30, height: 20, x: 10, y: 10, toJSON: () => ({}) });
    click(trigger());
    expect(panel()!.parentElement).toBe(document.body);
    expect(panel()!.style.left).toBe('12px'); expect(panel()!.style.width).toBe('296px');
    expect(panel()!.style.top).toBe('36px'); expect(panel()!.style.maxHeight).toBe('168px');
    bounds.mockReturnValue({ left: 270, right: 300, top: 210, bottom: 230, width: 30, height: 20, x: 270, y: 210, toJSON: () => ({}) });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(panel()!.style.top).toBe(''); expect(panel()!.style.bottom).toBe('36px');
    expect(panel()!.style.left).toBe('12px'); expect(panel()!.style.maxHeight).toBe('168px');
  });
});
