import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { readStoredWorkbenchProject } from '@/domain/workbench-catalog/workbenchCatalogMutations';
import {
  generateControllerArtifact,
  loadSavedWireEdmJobRevision,
  serializeSavedWireEdmJobRevision,
  type SavedWireEdmJobRevision
} from '@/domain/wire-edm-job';

interface ProjectRevisionsDialogProps {
  workbench: ConnectedWorkbenchCatalog;
  projectId: string;
  projectName: string;
  onClose: () => void;
}

export function ProjectRevisionsDialog({ workbench, projectId, projectName, onClose }: ProjectRevisionsDialogProps) {
  const [revisions, setRevisions] = useState<readonly SavedWireEdmJobRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModalFocus({ open: true, overlayRef, dialogRef, initialFocusRef: closeRef,
    onClose, dismissible: busyId === null });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const project = await readStoredWorkbenchProject(workbench, projectId);
        if (!project.ok) throw new Error(project.error.message);
        const loaded = await Promise.all([...project.project.savedRevisionIds].reverse().map(async (revisionId) => {
          const result = await loadSavedWireEdmJobRevision(workbench.adapter, projectId, revisionId);
          if (!result.ok) throw new Error(result.error.message);
          return result.revision;
        }));
        if (!cancelled) setRevisions(loaded);
      } catch (cause) {
        if (!cancelled) setError(messageOf(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [workbench, projectId]);

  async function downloadController(revision: SavedWireEdmJobRevision) {
    setBusyId(revision.revisionId);
    setError(null);
    try {
      const result = await generateControllerArtifact(revision);
      if (!result.ok) throw new Error(result.error.message);
      downloadProgramFile({ fileName: result.artifact.fileName, text: result.artifact.text });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusyId(null);
    }
  }

  function downloadRevision(revision: SavedWireEdmJobRevision) {
    setError(null);
    try {
      downloadProgramFile({
        fileName: `${projectId}.${revision.revisionId}.wireedm-revision.json`,
        mimeType: 'application/json;charset=utf-8',
        text: serializeSavedWireEdmJobRevision(revision)
      });
    } catch (cause) {
      setError(messageOf(cause));
    }
  }

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget && busyId === null) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Revisions for ${projectName}`}
        tabIndex={-1} className="grid max-h-[min(80vh,680px)] w-full max-w-2xl grid-rows-[auto_minmax(0,1fr)] border border-border bg-card shadow-2xl">
        <div className="technical-panel-header justify-between">
          <div>
            <h2 className="text-xs font-semibold">Saved revisions</h2>
            <p className="mt-1 text-[10px] text-muted-foreground">{projectName} · snapshots made when controller files were generated</p>
          </div>
          <Button ref={closeRef} aria-label="Close revisions" disabled={busyId !== null}
            onClick={onClose} size="icon" type="button" variant="ghost"><X /></Button>
        </div>
        <div className="work-region-scrollbar overflow-auto p-3 text-[11px]">
          {loading ? <p role="status">Loading revisions…</p> : revisions.length === 0 && !error
            ? <p>No saved revisions yet. Generate a controller file in the editor to create one.</p>
            : null}
          {error && <p role="alert" className="mb-3 text-destructive">{error}</p>}
          <ol className="grid gap-2">
            {revisions.map((revision) => (
              <li key={revision.revisionId} className="grid gap-2 border border-border p-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <p className="font-medium">{new Date(revision.savedAt).toLocaleString()}</p>
                  <p className="mt-1 truncate text-muted-foreground" title={revision.revisionId}>
                    {revision.machine.name} · {revision.post.installation.ref.packageId} · {revision.revisionId}
                  </p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" type="button" disabled={busyId !== null}
                    onClick={() => void downloadController(revision)}>
                    {busyId === revision.revisionId ? 'Generating…' : 'Controller file'}
                  </Button>
                  <Button size="sm" variant="outline" type="button" disabled={busyId !== null}
                    onClick={() => downloadRevision(revision)}>Snapshot JSON</Button>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : 'Could not load or download the saved revision.';
}
