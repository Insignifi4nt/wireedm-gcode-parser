import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModalFocus } from '@/components/ui/useModalFocus';

export function AgentImportDialog({ onClose, onFile }: { onClose: () => void; onFile: (file: File) => void }) {
  const overlay = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  useModalFocus({ open: true, overlayRef: overlay, dialogRef: dialog, initialFocusRef: input, onClose });
  return <div ref={overlay} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="agent-import-title" aria-describedby="agent-import-description" tabIndex={-1}
      className="grid w-full max-w-md gap-3 rounded-panel border border-border bg-card p-4 text-xs">
      <h2 id="agent-import-title" className="text-sm font-semibold">Attach an agent import file</h2>
      <p id="agent-import-description">Choose a DXF, UPID or complete machine package. The file stays in this tab. The agent receives a temporary token and must use the normal import review and save checks. Attaching does not import or install it.</p>
      <Input ref={input} type="file" accept=".dxf,.json,.wireedm-package" aria-label="Agent import file" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
        if (!file) return;
        try { onFile(file); onClose(); } catch (error) { setError(error instanceof Error ? error.message : 'The file could not be attached.'); }
      }} />
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <Button type="button" variant="outline" onClick={onClose}>Cancel attachment</Button>
    </div>
  </div>;
}
