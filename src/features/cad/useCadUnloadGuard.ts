import { useEffect } from 'react';
import { hasUnsavedCadDraft, type CadSession } from './cadSession';

/** Warn before leaving accepted unsaved content or a pending CAD workflow behind. */
export function useCadUnloadGuard(session: CadSession): void {
  useEffect(() => {
    const needsGuard = () => {
      const current = session.getSnapshot();
      return current.workflowOpen || hasUnsavedCadDraft(current);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!needsGuard()) return;
      event.returnValue = 'true';
      event.preventDefault();
    };
    const sync = () => {
      if (needsGuard()) window.addEventListener('beforeunload', beforeUnload);
      else window.removeEventListener('beforeunload', beforeUnload);
    };
    sync();
    const unsubscribe = session.subscribe(sync);
    return () => { unsubscribe(); window.removeEventListener('beforeunload', beforeUnload); };
  }, [session]);
}
