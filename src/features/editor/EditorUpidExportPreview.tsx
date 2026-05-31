import { Download, X } from 'lucide-react';

import type { PathDiagnostic } from '@/domain/path-intel/types';

interface EditorUpidExportPreviewProps {
  diagnostics: PathDiagnostic[];
  fileName: string;
  machineName: string;
  operationCount: number;
  postMetrics: {
    cutMoveCount: number;
    rapidCount: number;
  };
  programText: string;
  onClose: () => void;
  onDownload: () => void;
}

export function EditorUpidExportPreview({
  diagnostics,
  fileName,
  machineName,
  operationCount,
  postMetrics,
  programText,
  onClose,
  onDownload
}: EditorUpidExportPreviewProps) {
  return (
    <section
      aria-label="UPID Export Preview"
      className="absolute inset-3 z-20 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/98 font-mono text-[10px] shadow-2xl"
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
      <section
        className="grid gap-2 border-b border-border bg-background/55 px-2 py-2"
        data-upid-export-summary
      >
        <dl className="grid grid-cols-4 gap-1">
          <div className="border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Operations</dt>
            <dd data-upid-export-stat="operations">{operationCount}</dd>
          </div>
          <div className="border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Rapid</dt>
            <dd data-upid-export-stat="rapid">{postMetrics.rapidCount}</dd>
          </div>
          <div className="border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Cut</dt>
            <dd data-upid-export-stat="cut">{postMetrics.cutMoveCount}</dd>
          </div>
          <div className="border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Diagnostics</dt>
            <dd data-upid-export-stat="diagnostics">{diagnostics.length}</dd>
          </div>
        </dl>
        {diagnostics.length > 0 && (
          <div className="max-h-20 overflow-auto border border-border bg-card/60" data-upid-export-diagnostics>
            {diagnostics.map((diagnostic) => (
              <div className="border-b border-border px-2 py-1 last:border-b-0" key={diagnostic.id}>
                <span className="mr-2 uppercase text-amber-200">{diagnostic.severity}</span>
                <span>{diagnostic.message}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <pre
        className="min-h-0 overflow-auto whitespace-pre-wrap bg-background/80 p-3 leading-5 text-foreground"
        data-upid-export-gcode
      >
        {programText}
      </pre>
    </section>
  );
}
