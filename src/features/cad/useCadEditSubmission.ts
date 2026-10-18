import { useCallback, useEffect, useRef, useState } from 'react';
import type { CadSessionSnapshot } from './cadSession';

export type CadEditCompletion = void | CadSessionSnapshot | Promise<void | CadSessionSnapshot>;

/** An editor owns its pending application until success, cancellation or unmount. */
export function useCadEditSubmission() {
  const active = useRef<AbortController | null>(null);
  const [applying, setApplying] = useState(false);
  const cancel = useCallback(() => {
    active.current?.abort(); active.current = null; setApplying(false);
  }, []);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const submit = (apply: (signal: AbortSignal) => CadEditCompletion, accepted: () => void, rejected: (error: unknown) => void) => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller; setApplying(true);
    const finish = (outcome: { kind: 'accepted' } | { kind: 'rejected'; error: unknown }) => {
      if (active.current !== controller || controller.signal.aborted) return;
      active.current = null; setApplying(false);
      if (outcome.kind === 'accepted') accepted(); else rejected(outcome.error);
    };
    try {
      void Promise.resolve(apply(controller.signal)).then(() => finish({ kind: 'accepted' }), error => finish({ kind: 'rejected', error }));
    } catch (error) { finish({ kind: 'rejected', error }); }
  };
  return { applying, submit, cancel };
}
