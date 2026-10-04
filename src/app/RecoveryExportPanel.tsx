import { Button } from '@/components/ui/button';
import type { recoverySourceSummary, RecoveryExportReceipt } from '@/domain/storage/workbenchRecovery';

export interface RecoveryExportControls {
  readonly source: ReturnType<typeof recoverySourceSummary>;
  readonly receipt: RecoveryExportReceipt | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly message: string | null;
  readonly onExport: () => Promise<unknown>;
  readonly onDownload: () => Promise<unknown>;
}

export function RecoveryExportPanel({ recovery, disabled = false }: { recovery: RecoveryExportControls | null; disabled?: boolean }) {
  if (!recovery) return null;
  const { source, receipt } = recovery;
  const locked = disabled || recovery.busy;
  return <section className="grid gap-2 border-t border-border pt-3 text-xs" aria-label="Recovery export">
    <h2 className="text-sm font-semibold">Export readable recovery files</h2>
    <p className="break-words">{source.kind === 'directory' ? 'Folder' : 'Persistent browser cache'}: {source.name}{source.nameTruncated ? '…' : ''}</p>
    <p className="break-words text-muted-foreground">{source.diagnostic.message}{source.diagnostic.messageTruncated ? '… (diagnostic shortened)' : ''}</p>
    <p className="text-muted-foreground">Download the readable files and recovery diagnostics from this location. This does not repair storage or create a verified restore backup. Unreadable or oversized files are listed as omissions. Storage remains unchanged.</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={locked} variant="outline" onClick={() => { void recovery.onExport().catch(() => undefined); }}>Capture and download recovery export</Button>
      {receipt && <Button disabled={locked} variant="outline" onClick={() => { void recovery.onDownload().catch(() => undefined); }}>Download captured recovery export again</Button>}
    </div>
    {recovery.busy && <p role="status">Reading recovery files…</p>}
    {recovery.error && <p className="break-words text-destructive" role="alert">{recovery.error}</p>}
    {recovery.message && <p role="status">{recovery.message}</p>}
    {receipt && <div className="grid gap-1 border border-border p-2">
      <p>{receipt.capturedFiles} files captured · {receipt.omittedFiles} discovered files omitted · {receipt.archiveBytes.toLocaleString()} archive bytes</p>
      <p>{receipt.inventoryComplete ? 'Complete bounded inventory.' : 'Partial or changed inventory; other files may exist.'} {receipt.contentComplete ? 'All inventoried logical text captured.' : 'Partial content export.'}</p>
      <p className="text-muted-foreground">{receipt.coordination === 'uncoordinated' ? 'This browser could not coordinate reads with other tabs. ' : ''}Files were read individually; external edits may occur during capture. Empty directories, browser preferences, unsaved drafts and physical compressed cache records are excluded.</p>
      <p className="break-all text-muted-foreground">Archive SHA-256: {receipt.archiveSha256}</p>
    </div>}
  </section>;
}
