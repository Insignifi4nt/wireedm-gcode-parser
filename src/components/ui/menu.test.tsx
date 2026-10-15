import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MenuCheckboxItem, MenuItem, MenuSurface } from './menu';

let host: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function buttons() { return [...host.querySelectorAll('button')]; }
async function key(value: string) { await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); }

it('navigates enabled commands with wrapping, Home/End and typeahead', async () => {
  await act(async () => root.render(<MenuSurface aria-label="Commands"><MenuItem>Sketch</MenuItem><MenuItem disabled>Shell</MenuItem><MenuItem>Revolve</MenuItem><MenuItem>Pattern</MenuItem></MenuSurface>));
  buttons()[0].focus(); await key('ArrowDown'); expect(document.activeElement).toBe(buttons()[2]);
  await key('End'); expect(document.activeElement).toBe(buttons()[3]);
  await key('ArrowDown'); expect(document.activeElement).toBe(buttons()[0]);
  await key('p'); expect(document.activeElement).toBe(buttons()[3]);
  await key('Home'); expect(document.activeElement).toBe(buttons()[0]);
});

it('lets the feature owner handle keys first and dismisses once otherwise', async () => {
  const dismiss = vi.fn();
  await act(async () => root.render(<MenuSurface onDismiss={dismiss} onKeyDown={event => { if (event.key === 'ArrowDown') event.preventDefault(); }}><MenuItem>First</MenuItem><MenuItem>Next</MenuItem></MenuSurface>));
  buttons()[0].focus(); await key('ArrowDown'); expect(document.activeElement).toBe(buttons()[0]);
  await key('Escape'); expect(dismiss).toHaveBeenCalledOnce();
});

it('retains native command events and truthful disabled controls', async () => {
  const choose = vi.fn();
  await act(async () => root.render(<MenuSurface><MenuItem onClick={choose}>Export</MenuItem><MenuItem disabled onClick={choose}>Unavailable</MenuItem></MenuSurface>));
  await act(async () => { buttons()[0].click(); buttons()[1].click(); });
  expect(choose).toHaveBeenCalledOnce(); expect(buttons()[1].disabled).toBe(true);
});

it('reports checkbox state and toggles once without submitting an enclosing form', async () => {
  const submit = vi.fn(event => event.preventDefault());
  function Choices() { const [checked, setChecked] = useState(false); return <form onSubmit={submit}><MenuSurface><MenuCheckboxItem checked={checked} onCheckedChange={setChecked}>Hover assist</MenuCheckboxItem></MenuSurface></form>; }
  await act(async () => root.render(<Choices />));
  expect(buttons()[0].getAttribute('aria-checked')).toBe('false');
  await act(async () => buttons()[0].click());
  expect(buttons()[0].getAttribute('aria-checked')).toBe('true'); expect(submit).not.toHaveBeenCalled();
});
