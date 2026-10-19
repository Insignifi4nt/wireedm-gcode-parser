import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CAD_PREFERENCES_KEY, cadDepthHandlesShown, getCadPreferences, setCadPreferences, useCadPreferences } from './cadPreferences';

afterEach(() => vi.restoreAllMocks());
it('keeps existing exact device preference bytes and shows depth handles unless turned off', () => {
  const source = '{ "navigationMode" : "trackpad", "showOnPartDimensions" : false }';
  localStorage.setItem(CAD_PREFERENCES_KEY, source);
  expect(getCadPreferences()).toMatchObject({ navigationMode: 'trackpad', showOnPartDimensions: false });
  expect(getCadPreferences().showDepthHandles).toBeUndefined(); expect(cadDepthHandlesShown(getCadPreferences())).toBe(true);
  expect(localStorage.getItem(CAD_PREFERENCES_KEY)).toBe(source);
  expect(cadDepthHandlesShown({ navigationMode: 'mouse', showOnPartDimensions: true, showDepthHandles: false })).toBe(false);
});

it('remembers an explicit depth interaction preference independently and propagates a cross-tab change', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear();
  const container = document.createElement('div'), root = createRoot(container); document.body.append(container);
  function Read() { return <output>{String(cadDepthHandlesShown(useCadPreferences()))}</output>; }
  try {
    await act(async () => root.render(<Read />)); expect(container.textContent).toBe('true');
    await act(async () => setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true, showDepthHandles: false }));
    expect(container.textContent).toBe('false');
    await act(async () => setCadPreferences({ navigationMode: 'mouse', showOnPartDimensions: true, showDepthHandles: true }));
    expect(container.textContent).toBe('true'); expect(JSON.parse(localStorage.getItem(CAD_PREFERENCES_KEY) ?? 'null').showDepthHandles).toBe(true);
    await act(async () => { localStorage.setItem(CAD_PREFERENCES_KEY, '{"navigationMode":"mouse","showOnPartDimensions":true,"showDepthHandles":false}'); window.dispatchEvent(new StorageEvent('storage', { key: CAD_PREFERENCES_KEY })); });
    expect(container.textContent).toBe('false');
    await act(async () => { localStorage.setItem(CAD_PREFERENCES_KEY, '{"navigationMode":"mouse","showOnPartDimensions":true,"showDepthHandles":true}'); window.dispatchEvent(new StorageEvent('storage', { key: CAD_PREFERENCES_KEY })); });
    expect(container.textContent).toBe('true');
  } finally { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});

it('rejects malformed new preference data without rewriting it and retains an explicit session choice when storage is blocked', () => {
  const source = '{"navigationMode":"trackpad","showOnPartDimensions":false,"showDepthHandles":"true"}'; localStorage.setItem(CAD_PREFERENCES_KEY, source);
  expect(getCadPreferences()).toEqual({ navigationMode: 'mouse', showOnPartDimensions: true });
  expect(getCadPreferences().showDepthHandles).toBeUndefined(); expect(localStorage.getItem(CAD_PREFERENCES_KEY)).toBe(source);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
  expect(setCadPreferences({ navigationMode: 'trackpad', showOnPartDimensions: false, showDepthHandles: true })).toBe(false);
  expect(getCadPreferences().showDepthHandles).toBe(true);
});
