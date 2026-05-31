import { Download, X } from 'lucide-react';

interface EditorUpidExportPreviewProps {
  fileName: string;
  machineName: string;
  programText: string;
  onClose: () => void;
  onDownload: () => void;
}

export function EditorUpidExportPreview({
  fileName,
  machineName,
  programText,
  onClose,
  onDownload
}: EditorUpidExportPreviewProps) {
  return (
    <section
      aria-label="UPID Export Preview"
      className="absolute inset-3 z-20 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/98 font-mono text-[10px] shadow-2xl"
      data-upid-export-preview
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border bg-card px-2 py-2">
        <div className="min-w-0">
          <p className="text-[9px] uppercase text-muted-foreground">Export Preview</p>
          <h2 className="truncate text-[12px] font-semibold">UPID Export Preview</h2>
          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
            {machineName} / {fileName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Download UPID export program"
            className="flex h-7 items-center gap-1 border border-border px-2 text-[10px] text-muted-foreground outline-none transition hover:bg-accent"
            onClick={onDownload}
            type="button"
          >
            <Download className="size-3" />
            Download
          </button>
          <button
            aria-label="Close UPID export preview"
            className="flex size-7 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent"
            onClick={onClose}
            title="Close export preview"
            type="button"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
      <pre
        className="min-h-0 overflow-auto whitespace-pre-wrap bg-background/80 p-3 leading-5 text-foreground"
        data-upid-export-gcode
      >
        {programText}
      </pre>
    </section>
  );
}
