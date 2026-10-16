import { useEffect, useMemo, useState } from 'react';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { needsCadSketchPreparation } from './cadEditPreparation';

export type CadPrepareEdits = (edits: readonly CadEdit[], signal: AbortSignal) => Promise<CadDocument>;
type Preview = { readonly kind: 'idle' | 'waiting' } | { readonly kind: 'ready'; readonly document: CadDocument }
  | { readonly kind: 'error'; readonly message: string };

/** Keep solved sketch candidates disposable and discard late results from a different input. */
export function useCadPreparedPreview(source: CadDocument, edits: readonly CadEdit[] | null, prepare: CadPrepareEdits | undefined, enabled: boolean, debounceMs = 100): Preview {
  const asynchronous = Boolean(edits?.length && prepare && needsCadSketchPreparation(source, edits));
  const immediate = useMemo<Preview>(() => {
    if (!enabled || !edits?.length) return { kind: 'idle' };
    if (asynchronous) return { kind: 'waiting' };
    try { return { kind: 'ready', document: applyCadEdits(source, edits) }; }
    catch (error) { return { kind: 'error', message: error instanceof Error ? error.message : 'This sketch edit is not valid.' }; }
  }, [source, edits, enabled, asynchronous]);
  const [resolved, setResolved] = useState<{ source: CadDocument; edits: readonly CadEdit[]; prepare: CadPrepareEdits; preview: Preview } | null>(null);
  useEffect(() => {
    if (!enabled || !asynchronous || !edits || !prepare) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => { controller.signal.throwIfAborted(); return prepare(edits, controller.signal); }).then(document => {
        if (!controller.signal.aborted) setResolved({ source, edits, prepare, preview: { kind: 'ready', document } });
      }, error => {
        if (!controller.signal.aborted) setResolved({ source, edits, prepare, preview: { kind: 'error', message: error instanceof Error ? error.message : 'This sketch edit could not be solved.' } });
      });
    }, debounceMs);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [source, edits, prepare, enabled, asynchronous, debounceMs]);
  return enabled && asynchronous && resolved?.source === source && resolved.edits === edits && resolved.prepare === prepare ? resolved.preview : immediate;
}
