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

it('keeps depth dragging opt-in and saves only the explicit device choice', () => {
  const original = localStorage.getItem(CAD_PREFERENCES_KEY);
  display(); const input = depthCheckbox();
  expect(input.checked).toBe(false); expect(localStorage.getItem(CAD_PREFERENCES_KEY)).toBe(original);
  act(() => input.click());
  expect(getCadPreferences()).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: true });
  expect(JSON.parse(localStorage.getItem(CAD_PREFERENCES_KEY)!)).toEqual(getCadPreferences());
  act(() => input.click());
  expect(getCadPreferences()).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: false });
});

it('applies depth handles for the session and explains when device storage fails', () => {
  display(); const input = depthCheckbox();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  act(() => input.click());
  expect(input.checked).toBe(true); expect(getCadPreferences().showDepthHandles).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toContain('Applied for this session');
});
