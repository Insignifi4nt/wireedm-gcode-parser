import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModalFocus } from '@/components/ui/useModalFocus';
import type { GCodeInspectionOptions } from '@/domain/editor/gcodeInspectionTypes';
import { validateGCodeInspectionSource } from '@/domain/editor/gcodeInspectionSource';
import type { GCodeInspectionProvenance } from './GCodeInspectionPanel';
import { GCodeInspectionInput } from './GCodeInspectionInput';
import { GCodeInspectionWorkspace } from './GCodeInspectionWorkspace';

export interface GCodeInspectionDialogProps {
  text?: string;
  fileName?: string;
  options?: GCodeInspectionOptions;
  provenance?: readonly GCodeInspectionProvenance[];
  onClose: () => void;
  onDownload?: () => void | Promise<void>;
}

export function GCodeInspectionDialog({ text, fileName, options, provenance, onClose, onDownload }: GCodeInspectionDialogProps) {
  const [input, setInput] = useState<{ text: string; fileName: string } | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const source = text === undefined ? input : { text, fileName: fileName ?? 'Controller program' };
  const problem = source ? validateGCodeInspectionSource(source.text) : null;
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: true, overlayRef, dialogRef, initialFocusRef: closeRef, onClose });
  return createPortal(<div ref={overlayRef} className="fixed inset-0 z-[80] bg-black/70 p-1 sm:p-3" data-gcode-inspection-overlay>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="G-code inspection" tabIndex={-1}
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1"><h2 className="truncate text-xs font-semibold">G-code inspection{source ? ` · ${source.fileName}` : ''}</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground">Read-only controller text and nominal XY interpretation</p></div>
        <div className="flex items-center gap-2">
          {text === undefined && source && <Button size="sm" variant="outline" onClick={() => setInput(null)}>Open another</Button>}
          {onDownload && <Button size="sm" variant="outline" onClick={async () => {
            setDownloadError(null);
            try { await onDownload(); }
            catch (cause) { setDownloadError(cause instanceof Error ? cause.message : 'Download could not be requested. Retry this exact file.'); }
          }}><Download />Download exact file</Button>}
          <Button ref={closeRef} aria-label="Close G-code inspection" size="icon" variant="ghost" onClick={onClose}><X /></Button>
        </div>
        {downloadError && <p role="alert" className="w-full text-xs text-destructive">{downloadError} The inspected artifact is retained; retry its download.</p>}
      </div>
      {problem ? <p className="p-4 text-xs text-destructive" role="alert">{problem}</p>
        : source ? <GCodeInspectionWorkspace key={source.fileName} text={source.text} options={options} provenance={provenance} />
        : <GCodeInspectionInput onInspect={setInput} />}
    </div>
  </div>, document.body);
}
