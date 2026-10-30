import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CadSettingsPanel } from './CadSettingsPanel';
import { CAD_PREFERENCES_KEY, getCadPreferences, setCadPreferences } from '@/features/cad/cadPreferences';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(<CadSettingsPanel />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const display = () => act(() => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === 'Display')!.click());
function depthCheckbox() {
  const label = [...container.querySelectorAll('label')].find(element => element.textContent?.includes('Extrusion depth handles'));
  expect(label, 'Display exposes the actual optional depth interaction').toBeDefined();
  return label!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

it('shows depth dragging by default and saves only the explicit device choice', () => {
  const original = localStorage.getItem(CAD_PREFERENCES_KEY);
  display(); const input = depthCheckbox();
  expect(input.checked).toBe(true); expect(localStorage.getItem(CAD_PREFERENCES_KEY)).toBe(original);
  act(() => input.click());
  expect(getCadPreferences()).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: false });
  expect(JSON.parse(localStorage.getItem(CAD_PREFERENCES_KEY)!)).toEqual(getCadPreferences());
  act(() => input.click());
  expect(getCadPreferences()).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: true });
});

it('applies depth handles for the session and explains when device storage fails', () => {
  display(); const input = depthCheckbox();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  act(() => input.click());
  expect(input.checked).toBe(false); expect(getCadPreferences().showDepthHandles).toBe(false);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Applied for this session');
});

it('shows relations by default, saves an explicit choice, and reads a stored choice back', () => {
  display();
  const input = [...container.querySelectorAll('label')].find(element => element.textContent?.includes('Show relations'))!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(input.checked).toBe(true); expect(getCadPreferences().showRelations).toBeUndefined();
  act(() => input.click());
  expect(getCadPreferences()).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false, showRelations: false });
  localStorage.setItem(CAD_PREFERENCES_KEY, JSON.stringify({ navigationMode: 'mouse', showOnPartDimensions: true, showRelations: true }));
  expect(getCadPreferences()).toEqual({ navigationMode: 'mouse', showOnPartDimensions: true, showRelations: true });
  // A stored choice of another type is not this device's preference, so the defaults apply and the stored bytes stay.
  localStorage.setItem(CAD_PREFERENCES_KEY, JSON.stringify({ navigationMode: 'mouse', showOnPartDimensions: true, showRelations: 'no' }));
  expect(getCadPreferences()).toEqual({ navigationMode: 'mouse', showOnPartDimensions: true });
});
