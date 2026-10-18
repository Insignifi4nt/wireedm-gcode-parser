import { useEffect, useReducer, useRef } from 'react';

interface OwnedSlot<T> { readonly key: unknown; readonly value: T; disposed: boolean }

/**
 * Owns one disposable per key and disposes it when the key changes or the owner unmounts.
 * React's development StrictMode runs an extra cleanup/setup pair after mount; an instance
 * disposed by that check is replaced instead of being handed out after disposal.
 */
export function useOwnedDisposable<T extends { dispose(): void }>(create: () => T, key: unknown): T {
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const slot = useRef<OwnedSlot<T> | null>(null);
  if (!slot.current || slot.current.key !== key) slot.current = { key, value: create(), disposed: false };
  const createCurrent = useRef(create); createCurrent.current = create;
  useEffect(() => {
    let owned = slot.current!;
    if (owned.disposed) { owned = slot.current = { key, value: createCurrent.current(), disposed: false }; refresh(); }
    return () => { owned.disposed = true; owned.value.dispose(); };
  }, [key]);
  return slot.current.value;
}
