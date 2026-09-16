import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import { readSavedRevisionSummaryPage, type SavedRevisionSummary } from '@/domain/wire-edm-job/revisionSummaries';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { readStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import {
  generateControllerArtifact,
  loadSavedWireEdmJobRevision,
  serializeSavedWireEdmJobRevision,
} from '@/domain/wire-edm-job';

interface ProjectRevisionsDialogProps {
  workbench: ConnectedWorkbenchCatalog;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onDeleteRevisions: (projectId: string, revisionIds: readonly string[]) => Promise<void>;
}

export function ProjectRevisionsDialog({ workbench, projectId, projectName, onClose, onDeleteRevisions }: ProjectRevisionsDialogProps) {
  const [revisions, setRevisions] = useState<readonly SavedRevisionSummary[]>([]);
  const [revisionCount, setRevisionCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const busy = busyId !== null || deleting;
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: true, overlayRef, dialogRef, initialFocusRef: closeRef,
    onClose, dismissible: !busy && !confirmDelete });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const project = await readStoredWorkbenchProject(workbench, projectId);
        if (!project.ok) throw new Error(project.error.message);
        const loaded = await readSavedRevisionSummaryPage(
          workbench.adapter, projectId, project.project.savedRevisionIds, page
        );
        if (!cancelled) {
          setRevisionCount(project.project.savedRevisionIds.length);
          setRevisions(loaded);
        }
      } catch (cause) {
        if (!cancelled) setError(messageOf(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workbench, projectId, page]);

  async function downloadController(revisionId: string) {
    setBusyId(revisionId);
    setError(null);
    try {
      const loaded = await loadSavedWireEdmJobRevision(workbench.adapter, projectId, revisionId);
      if (!loaded.ok) throw new Error(loaded.error.message);
      const result = await generateControllerArtifact(loaded.revision);
      if (!result.ok) throw new Error(result.error.message);
      downloadProgramFile({ fileName: result.artifact.fileName, text: result.artifact.text });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function downloadRevision(revisionId: string) {
    setBusyId(revisionId);
    setError(null);
    try {
      const loaded = await loadSavedWireEdmJobRevision(workbench.adapter, projectId, revisionId);
      if (!loaded.ok) throw new Error(loaded.error.message);
      downloadProgramFile({
        fileName: `${projectId}.${revisionId}.wireedm-revision.json`,
        mimeType: 'application/json;charset=utf-8',
        text: serializeSavedWireEdmJobRevision(loaded.revision)
      });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }

  function toggleRevision(revisionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(revisionId)) next.delete(revisionId);
      else next.add(revisionId);
      return next;
    });
    setConfirmDelete(false);
  }

  function cancelSelection() {
    setSelecting(false);
    setSelectedIds(new Set());
    setConfirmDelete(false);
  }

  async function deleteSelection() {
    const revisionIds = [...selectedIds];
    if (!revisionIds.length) return;
    setDeleting(true);
    setError(null);
    try {
      await onDeleteRevisions(projectId, revisionIds);
      setRevisions((current) => current.filter(({ revisionId }) => !selectedIds.has(revisionId)));
      setRevisionCount((current) => current - revisionIds.length);
      cancelSelection();
    } catch (cause) {
      setError(messageOf(cause));
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !confirmDelete) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Revisions for ${projectName}`}
        tabIndex={-1} className="grid max-h-[min(80vh,680px)] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] border border-border bg-card shadow-2xl">
        <div className="technical-panel-header justify-between">
          <div>
            <h2 className="text-xs font-semibold">Saved revisions</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">{projectName} · snapshots made when controller files were generated</p>
          </div>
          <Button ref={closeRef} aria-label="Close revisions" disabled={busy}
            onClick={onClose} size="icon" type="button" variant="ghost"><X /></Button>
        </div>
        <div className="work-region-scrollbar overflow-auto p-3 text-[11px]">
          {!loading && revisions.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {!selecting ? (
                <Button size="sm" variant="outline" type="button" disabled={busy}
                  onClick={() => setSelecting(true)}><Trash2 />Delete…</Button>
              ) : (
                <>
                  <label className="flex items-center gap-1.5">
                    <input aria-label="Select all revisions" type="checkbox" disabled={busy}
                      checked={revisions.length > 0 && revisions.every(({ revisionId }) => selectedIds.has(revisionId))}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setSelectedIds((current) => {
                          const next = new Set(current);
                          for (const { revisionId } of revisions) {
                            if (checked) next.add(revisionId);
                            else next.delete(revisionId);
                          }
                          return next;
                        });
                        setConfirmDelete(false);
                      }} />
                    Select all
                  </label>
                  <span className="text-muted-foreground">{selectedIds.size} selected</span>
                  <Button size="sm" variant="danger" type="button" disabled={busy || selectedIds.size === 0}
                    onClick={() => setConfirmDelete(true)}>Delete selected</Button>
                  <Button size="sm" variant="ghost" type="button" disabled={busy}
                    onClick={cancelSelection}>Cancel</Button>
                </>
              )}
            </div>
          )}
          {confirmDelete && (
            <div className="mb-3 grid gap-2 border border-destructive p-2" role="group" aria-label="Confirm revision deletion">
              <p>Delete {selectedIds.size} saved {selectedIds.size === 1 ? 'revision' : 'revisions'} permanently? This cannot be undone.</p>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" type="button" disabled={busy}
                  onClick={() => void deleteSelection()}>{deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}</Button>
                <Button size="sm" variant="outline" type="button" disabled={busy}
                  onClick={() => setConfirmDelete(false)}>Keep revisions</Button>
              </div>
            </div>
          )}
          {loading ? <p role="status">Loading revisions…</p> : revisions.length === 0 && !error
            ? <p>No saved revisions yet. Generate a controller file in the editor to create one.</p>
            : null}
          {error && <p role="alert" className="mb-3 text-destructive">{error}</p>}
          <ol className="grid gap-2">
            {revisions.map((revision) => (
              <li key={revision.revisionId} className="grid gap-2 border border-border p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="flex min-w-0 items-center gap-2">
                  {selecting && <input aria-label={`Select revision ${revision.revisionId}`} type="checkbox"
                    disabled={busy} checked={selectedIds.has(revision.revisionId)}
                    onChange={() => toggleRevision(revision.revisionId)} />}
                  <div className="min-w-0">
                    <p className="font-medium">{revision.savedAt
                      ? new Date(revision.savedAt).toLocaleString()
                      : 'Unavailable revision'}</p>
                    <p className="mt-1 truncate text-muted-foreground" title={revision.revisionId}>
                      {revision.savedAt
                        ? `${revision.machineName} · ${revision.packageId} · ${revision.revisionId}`
                        : `${revision.revisionId} · ${revision.loadError}`}
                    </p>
                  </div>
                </div>
                {!selecting && <div className="flex gap-1">
                  <Button size="sm" variant="outline" type="button" disabled={busyId !== null || !revision.savedAt}
                    onClick={() => void downloadController(revision.revisionId)}>
                    {busyId === revision.revisionId ? 'Generating…' : 'Controller file'}
                  </Button>
                  <Button size="sm" variant="outline" type="button" disabled={busyId !== null || !revision.savedAt}
                    onClick={() => void downloadRevision(revision.revisionId)}>Snapshot JSON</Button>
                </div>}
              </li>
            ))}
          </ol>
          {revisionCount > 20 && <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" type="button" disabled={busy || page === 0}
              onClick={() => setPage((current) => current - 1)}>Newer</Button>
            <span className="text-muted-foreground">Page {page + 1} of {Math.ceil(revisionCount / 20)}</span>
            <Button size="sm" variant="outline" type="button" disabled={busy || (page + 1) * 20 >= revisionCount}
              onClick={() => setPage((current) => current + 1)}>Older</Button>
          </div>}
        </div>
      </div>
    </div>
  );
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Could not load or download the saved revision.';
}
