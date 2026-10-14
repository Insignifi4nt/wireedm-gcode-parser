import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CAD_PREFERENCES_KEY, getCadPreferences, setCadPreferences, useCadPreferences } from './cadPreferences';

let root: Root, container: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function ReadPreference() { const preferences = useCadPreferences(); return <output>{preferences.navigationMode}/{String(preferences.showOnPartDimensions)}</output>; }

it('publishes one remembered device preference to settings and existing CAD consumers without changing workbench data', async () => {
  localStorage.setItem('saved-workbench', '{"exact":"original"}');
  expect(getCadPreferences()).toEqual({ navigationMode: 'mouse', showOnPartDimensions: true });
  await act(async () => root.render(<><ReadPreference /><ReadPreference /></>));
  let remembered = false;
  await act(async () => { remembered = setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false }); });
  expect(remembered).toBe(true);
  expect([...container.querySelectorAll('output')].map(element => element.textContent)).toEqual(['trackpad/false', 'trackpad/false']);
  expect(JSON.parse(localStorage.getItem(CAD_PREFERENCES_KEY) ?? 'null')).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false });
  expect(localStorage.getItem('saved-workbench')).toBe('{"exact":"original"}');
  await act(async () => root.render(<ReadPreference />));
  expect(container.textContent).toBe('trackpad/false');
});

it('ignores unsupported or malformed preferences without rewriting their original bytes', () => {
  for (const source of ['{broken', '{"navigationMode":"touch","showOnPartDimensions":true}', '{"navigationMode":"mouse","showOnPartDimensions":"false"}']) {
    localStorage.setItem(CAD_PREFERENCES_KEY, source);
    expect(getCadPreferences()).toEqual({ navigationMode: 'mouse', showOnPartDimensions: true });
    expect(localStorage.getItem(CAD_PREFERENCES_KEY)).toBe(source);
  }
});

it('updates mounted consumers when another browser tab changes a remembered preference', async () => {
  await act(async () => root.render(<ReadPreference />));
  await act(async () => {
    localStorage.setItem(CAD_PREFERENCES_KEY, '{"navigationMode":"trackpad","showOnPartDimensions":true}');
    window.dispatchEvent(new StorageEvent('storage', { key: CAD_PREFERENCES_KEY }));
  });
  expect(container.textContent).toBe('trackpad/true');
});

it('retains an explicitly changed session preference when browser preference storage is unavailable', async () => {
  getCadPreferences();
  await act(async () => root.render(<ReadPreference />));
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  let remembered = true;
  await act(async () => { remembered = setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false }); });
  expect(remembered).toBe(false);
  expect(container.textContent).toBe('trackpad/false');
  expect(getCadPreferences()).toEqual({ navigationMode: 'trackpad', showOnPartDimensions: false });
});
