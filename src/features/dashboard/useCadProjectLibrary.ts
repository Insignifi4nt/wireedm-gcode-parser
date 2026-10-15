import { useEffect, useState } from 'react';
import { listCadProjectLibrary } from '@/domain/cad/cadStorage';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';

type Library = Awaited<ReturnType<typeof listCadProjectLibrary>>;
type Snapshot =
  | { adapter: WorkbenchStorageAdapter | null; kind: 'loading' | 'unavailable' }
  | { adapter: WorkbenchStorageAdapter; kind: 'ready'; library: Library; refreshing: boolean }
  | { adapter: WorkbenchStorageAdapter; kind: 'error'; message: string };

/** A read model over canonical CAD files, never a second persisted index. */
export function useCadProjectLibrary(adapter: WorkbenchStorageAdapter | null, version?: string | number) {
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>({ adapter: null, kind: 'unavailable' });
  useEffect(() => {
    if (!adapter) { setSnapshot({ adapter, kind: 'unavailable' }); return; }
    const controller = new AbortController();
    setSnapshot(current => current.adapter === adapter && current.kind === 'ready'
      ? { ...current, refreshing: true } : { adapter, kind: 'loading' });
    void listCadProjectLibrary(adapter, controller.signal).then(library => {
      if (!controller.signal.aborted) setSnapshot({ adapter, kind: 'ready', library, refreshing: false });
    }, error => {
      if (!controller.signal.aborted) setSnapshot({ adapter, kind: 'error', message: error instanceof Error ? error.message : 'Could not load CAD projects.' });
    });
    return () => controller.abort();
  }, [adapter, version, refreshVersion]);
  const current: Snapshot = snapshot.adapter === adapter ? snapshot : { adapter, kind: adapter ? 'loading' : 'unavailable' };
  return { snapshot: current, refresh: () => setRefreshVersion(value => value + 1) };
}
