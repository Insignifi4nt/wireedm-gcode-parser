import { useSyncExternalStore } from 'react';

export type CadNavigationMode = 'mouse' | 'trackpad';
export interface CadPreferences { readonly navigationMode: CadNavigationMode; readonly showOnPartDimensions: boolean }
export const CAD_PREFERENCES_KEY = 'wire-edm:cad-preferences:v1';
const defaults: CadPreferences = Object.freeze({ navigationMode: 'mouse', showOnPartDimensions: true });
let current = defaults;
let lastRaw: string | null | undefined;
const listeners = new Set<() => void>();

function stored(): string | null | undefined {
  try { return localStorage.getItem(CAD_PREFERENCES_KEY); } catch { return undefined; }
}
function parse(raw: string | null): CadPreferences {
  if (!raw) return defaults;
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'navigationMode' in value && 'showOnPartDimensions' in value
      && (value.navigationMode === 'mouse' || value.navigationMode === 'trackpad') && typeof value.showOnPartDimensions === 'boolean') {
      return Object.freeze({ navigationMode: value.navigationMode, showOnPartDimensions: value.showOnPartDimensions });
    }
  } catch { /* Invalid device preferences never rewrite stored originals. */ }
  return defaults;
}

/** Device interaction preferences are independent of CAD documents and workbench storage. */
export function getCadPreferences(): CadPreferences {
  const raw = stored();
  if (raw !== undefined && raw !== lastRaw) { lastRaw = raw; current = parse(raw); }
  return current;
}
export function setCadPreferences(preferences: CadPreferences): boolean {
  current = Object.freeze({ ...preferences });
  let remembered = false;
  try {
    const raw = JSON.stringify(current);
    localStorage.setItem(CAD_PREFERENCES_KEY, raw); lastRaw = raw; remembered = true;
  } catch { /* Keep the explicit change for this session when preference storage is blocked. */ }
  listeners.forEach(listener => listener());
  return remembered;
}
const changed = (event: StorageEvent) => { if (event.key === null || event.key === CAD_PREFERENCES_KEY) listeners.forEach(listener => listener()); };
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener('storage', changed);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', changed); };
}
export function useCadPreferences(): CadPreferences { return useSyncExternalStore(subscribe, getCadPreferences, () => defaults); }
