import { useSyncExternalStore } from 'react';

export type CadNavigationMode = 'mouse' | 'trackpad';
export interface CadPreferences { readonly navigationMode: CadNavigationMode; readonly showOnPartDimensions: boolean; readonly showDepthHandles?: boolean; readonly showRelations?: boolean }
export const CAD_PREFERENCES_KEY = 'wire-edm:cad-preferences:v1';
/** Depth handles are on unless the device explicitly turned them off; stored bytes are never rewritten. */
export const cadDepthHandlesShown = (preferences: CadPreferences) => preferences.showDepthHandles !== false;
/** Relation glyphs on the sketch canvas are on unless the device explicitly turned them off. */
export const cadRelationsShown = (preferences: CadPreferences) => preferences.showRelations !== false;
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
      && (value.navigationMode === 'mouse' || value.navigationMode === 'trackpad') && typeof value.showOnPartDimensions === 'boolean'
      && (!('showDepthHandles' in value) || typeof value.showDepthHandles === 'boolean') && (!('showRelations' in value) || typeof value.showRelations === 'boolean')) {
      return Object.freeze({ navigationMode: value.navigationMode, showOnPartDimensions: value.showOnPartDimensions,
        ...('showDepthHandles' in value ? { showDepthHandles: value.showDepthHandles as boolean } : {}),
        ...('showRelations' in value ? { showRelations: value.showRelations as boolean } : {}) });
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
