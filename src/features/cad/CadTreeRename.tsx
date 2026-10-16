import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CloseIcon, ConfirmIcon } from '@wire-edm/icons-react';
import { Value } from '@sinclair/typebox/value';
import { CadLabelSchema } from '@/domain/cad/cadPrimitives';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';

/** Naming uses the same label boundary as document edits and never saves on blur. */
export function CadTreeRename({ kind, initialName, onAccept, onCancel }: {
  kind: 'feature' | 'profile'; initialName: string; onAccept(name: string, signal?: AbortSignal): CadEditCompletion; onCancel(): void;
}) {
  const submission = useCadEditSubmission();
  const cancel = () => { submission.cancel(); onCancel(); };
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initialName), [error, setError] = useState('');
  const errorId = useId();
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <form className="cad-tree-rename" aria-label={`Rename ${initialName}`} onSubmit={event => {
    event.preventDefault(); event.stopPropagation();
    const name = draft === initialName ? initialName : draft.trim();
    if (!Value.Check(CadLabelSchema, name)) { setError('Enter a name of 1 to 160 characters.'); input.current?.focus(); return; }
    submission.submit(signal => onAccept(name, signal), () => undefined, failure => setError(failure instanceof Error ? failure.message : 'Unable to rename this item.'));
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
  }}>
    <Input ref={input} aria-label={kind === 'feature' ? 'Feature name' : 'Profile name'} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
      maxLength={160} value={draft} disabled={submission.applying} spellCheck={false} autoComplete="off" onChange={event => { setDraft(event.target.value); setError(''); }} />
    <Button variant="primary" type="submit" disabled={submission.applying} aria-label="Apply name" title="Apply name"><ConfirmIcon size={13} /></Button>
    <Button type="button" aria-label="Cancel rename" title="Cancel rename" onClick={cancel}><CloseIcon size={13} /></Button>
    {error && <span id={errorId} className="cad-tree-rename-error" role="alert">{error}</span>}
  </form>;
}
