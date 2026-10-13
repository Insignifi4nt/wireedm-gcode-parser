import { useEffect, useRef, useState } from 'react';
import type { CadLibraryEntry } from '@/domain/cad/cadStorage';

export function CadLibraryDialog({ entries, diagnostic, busy, onClose, onOpen }: {
  entries: readonly CadLibraryEntry[]; diagnostic: string | null; busy: boolean;
  onClose(): void; onOpen(id: string): Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    aria-label="CAD document library" className="m-auto w-[620px] border border-border bg-card p-0 text-foreground backdrop:bg-black/60">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 className="text-sm font-semibold">CAD documents</h2>
      <button type="button" disabled={busy} onClick={onClose} className="border border-border px-2 py-1 text-xs">Close</button>
    </div>
    <div className="max-h-[65vh] overflow-auto p-3 text-xs">
      {error && <p className="mb-3 text-destructive" role="alert">{error}</p>}
      {diagnostic && <p className="mb-3 text-amber-300" role="status">{diagnostic}</p>}
      {!entries.length && <p className="py-8 text-center text-muted-foreground">No saved CAD documents in this workbench. Create a part and save it to build your library.</p>}
      {entries.map(entry => <button key={entry.id} type="button" disabled={busy}
        onClick={() => { void onOpen(entry.id).catch(error => setError(error instanceof Error ? error.message : 'Could not open document.')); }}
        className="flex w-full items-center justify-between border-b border-border px-2 py-3 text-left hover:bg-accent disabled:opacity-50">
        <span><strong className="block font-medium">{entry.name}</strong><span className="text-[10px] text-muted-foreground">{entry.featureCount} features · {new Date(entry.updatedAt).toLocaleString()}</span></span>
        <span className="text-primary">Open</span>
      </button>)}
    </div>
  </dialog>;
}
