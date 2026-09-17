import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import { createWorkbenchBackup, prepareWorkbenchBackup, restoreWorkbenchBackup, removeUnreferencedWorkbenchFiles, MAX_WORKBENCH_BACKUP_BYTES, type PreparedWorkbenchBackup } from '@/domain/storage/workbenchBackup';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

export function WorkbenchBackupPanel({ workbench, disabled }: { workbench: ConnectedWorkbenchCatalog; disabled: boolean }) {
  const [backup, setBackup] = useState<PreparedWorkbenchBackup | null>(null);
  const [incoming, setIncoming] = useState<PreparedWorkbenchBackup | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [acknowledged, setAcknowledged] = useState(false);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setBackup(null); setIncoming(null); setSelected(new Set()); setAcknowledged(false); setOffset(0);
    setBusy(false); setMessage(null); setError(null);
    return () => { generation.current++; };
  }, [workbench]);
  async function run(operation: (isCurrent: () => boolean) => Promise<void>) {
    if (busy || disabled) return;
    const current = ++generation.current;
    setBusy(true); setError(null); setMessage(null);
    try { await operation(() => current === generation.current); }
    catch (failure) { if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Storage operation failed.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  function download(value: PreparedWorkbenchBackup) {
    downloadProgramFile({ fileName: `wire-edm-${new Date().toISOString().slice(0, 10)}.wireedm-backup.json`, text: value.text, mimeType: 'application/json' });
  }
  const locked = disabled || busy;
  return <section className="grid gap-3 border-t border-border pt-4">
    <h3 className="text-xs font-semibold">Backup & restore</h3>
    <p className="text-muted-foreground">Back up this storage location's saved projects, source files, trash, installed machines and posts, revisions, and retained files. Unsaved edits and browser preferences are not included. Keep the downloaded backup outside browser storage.</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={locked} variant="outline" onClick={() => run(async (isCurrent) => {
        const result = await createWorkbenchBackup(workbench);
        if (!isCurrent()) return;
        download(result); setBackup(result); setSelected(new Set()); setAcknowledged(false); setOffset(0);
        setMessage('Verified backup download requested. Check that the file was saved.');
      })}>Create and download backup</Button>
      <Button disabled={locked} variant="outline" onClick={() => upload.current?.click()}>Choose backup to restore</Button>
      <input ref={upload} aria-label="Workbench backup file" type="file" accept=".json,.wireedm-backup" hidden disabled={locked} onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        setIncoming(null);
        void run(async (isCurrent) => {
          if (file.size > MAX_WORKBENCH_BACKUP_BYTES) throw new Error('Backup exceeds the 128 MiB limit.');
          const result = await prepareWorkbenchBackup(await file.text());
          if (isCurrent()) setIncoming(result);
        });
      }} />
    </div>
    {busy && <p role="status">Checking storage…</p>}
    {error && <p className="break-words text-destructive" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {incoming && <div className="grid gap-2 border border-border p-3">
      <h4 className="font-semibold">Restore preview: {incoming.summary.name}</h4>
      <p>{incoming.summary.projects} projects · {incoming.summary.trashedProjects} trashed · {incoming.summary.machines} machines · {incoming.summary.posts} posts · {incoming.summary.revisions} revisions · {incoming.summary.files} files</p>
      <p className="text-muted-foreground">Restore only into an empty workbench. Choose an empty folder or open the app in a fresh browser if this location contains data. Successful restoration reloads the app.</p>
      <Button disabled={locked} variant="outline" onClick={() => run(async () => {
        await restoreWorkbenchBackup(workbench.adapter, incoming);
        window.location.reload();
      })}>Restore into this empty workbench</Button>
    </div>}
    {backup && <div className="grid gap-2 border border-border p-3">
      <h4 className="font-semibold">Unreferenced file cleanup</h4>
      <p className="text-muted-foreground">{backup.unreferencedPaths.length} files available for review. Unreferenced does not mean unwanted. Migration backups, machine/post storage and saved revision files are protected.</p>
      {backup.unreferencedPaths.slice(offset, offset + 50).map((path) => <label className="flex items-start gap-2 break-all" key={path}>
        <input type="checkbox" disabled={locked} checked={selected.has(path)} onChange={(event) => {
          const next = new Set(selected); if (event.target.checked) next.add(path); else next.delete(path);
          setSelected(next); setAcknowledged(false);
        }} />{path}
      </label>)}
      {backup.unreferencedPaths.length > 50 && <div className="flex gap-2">
        <Button variant="outline" disabled={locked || offset === 0} onClick={() => setOffset(offset - 50)}>Previous files</Button>
        <Button variant="outline" disabled={locked || offset + 50 >= backup.unreferencedPaths.length} onClick={() => setOffset(offset + 50)}>Next files</Button>
      </div>}
      {selected.size > 0 && <>
        <label className="flex items-start gap-2"><input type="checkbox" disabled={locked} checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I saved the downloaded backup and want to remove the {selected.size} selected files from this workbench.</label>
        <Button variant="outline" disabled={locked || !acknowledged} onClick={() => run(async (isCurrent) => {
          await removeUnreferencedWorkbenchFiles(workbench, backup, [...selected]);
          if (isCurrent()) { setBackup(null); setSelected(new Set()); setAcknowledged(false); setMessage('Selected files removed. Their exact contents remain in your downloaded backup.'); }
        })}>Remove selected files</Button>
      </>}
    </div>}
  </section>;
}
