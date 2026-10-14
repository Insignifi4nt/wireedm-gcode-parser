import { useId, useLayoutEffect, useRef, useState } from 'react';
import { CloseIcon, ConfirmIcon } from '@/components/icons';
import { Value } from '@sinclair/typebox/value';
import { CadLabelSchema } from '@/domain/cad/cadPrimitives';

/** Naming uses the same label boundary as document edits and never saves on blur. */
export function CadTreeRename({ kind, initialName, onAccept, onCancel }: {
  kind: 'feature' | 'profile'; initialName: string; onAccept(name: string): void; onCancel(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initialName), [error, setError] = useState('');
  const errorId = useId();
  useLayoutEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  return <form className="cad-tree-rename" aria-label={`Rename ${initialName}`} onSubmit={event => {
    event.preventDefault(); event.stopPropagation();
    const name = draft === initialName ? initialName : draft.trim();
    if (!Value.Check(CadLabelSchema, name)) { setError('Enter a name of 1 to 160 characters.'); input.current?.focus(); return; }
    try { onAccept(name); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to rename this item.'); }
  }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
  }}>
    <input ref={input} aria-label={kind === 'feature' ? 'Feature name' : 'Profile name'} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
      maxLength={160} value={draft} spellCheck={false} autoComplete="off" onChange={event => { setDraft(event.target.value); setError(''); }} />
    <button type="submit" aria-label="Apply name" title="Apply name"><ConfirmIcon size={13} /></button>
    <button type="button" aria-label="Cancel rename" title="Cancel rename" onClick={onCancel}><CloseIcon size={13} /></button>
    {error && <span id={errorId} className="cad-tree-rename-error" role="alert">{error}</span>}
  </form>;
}
