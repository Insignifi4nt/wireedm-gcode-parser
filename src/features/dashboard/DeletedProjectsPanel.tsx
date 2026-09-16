import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';

export function DeletedProjectsPanel({ entries, interactionLocked, onRestoreProject, onPurgeProject }: {
  readonly entries: NonNullable<WorkbenchCatalogManifest['deletedProjects']>;
  readonly interactionLocked: boolean;
  readonly onRestoreProject: (projectId: string) => Promise<void>;
  readonly onPurgeProject: (projectId: string) => Promise<void>;
}) {
  const pending = useRef(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function restore(projectId: string) {
    if (pending.current || interactionLocked) return;
    pending.current = true;
    setRestoringId(projectId);
    setError(null);
    try { await onRestoreProject(projectId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore project.'); }
    finally { pending.current = false; setRestoringId(null); }
  }
  async function purge(projectId: string) {
    if (pending.current || interactionLocked) return;
    pending.current = true;
    setPurgingId(projectId);
    setError(null);
    try { await onPurgeProject(projectId); setConfirmId(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not permanently delete project.'); }
    finally { pending.current = false; setPurgingId(null); }
  }
  if (entries.length === 0) return null;
  return (
    <details className="border border-border bg-card p-3 font-mono text-[11px]">
      <summary className="cursor-pointer">Archive ({entries.length})</summary>
      <p className="my-2 text-[10px] text-muted-foreground">
        Archived projects retain their files and saved revisions until permanently deleted.
      </p>
      <ul className="grid gap-2">
        {entries.map(({ project, deletedAt }) => (
          <li key={project.id} className="border-t border-border pt-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate" title={project.name}>{project.name}</p>
                <p className="text-[10px] text-muted-foreground">Archived {new Date(deletedAt).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button type="button" variant="outline" disabled={interactionLocked || restoringId !== null || purgingId !== null}
                  aria-label={`Restore ${project.name}`} onClick={() => void restore(project.id)}>
                  {restoringId === project.id ? 'Restoring...' : 'Restore'}
                </Button>
                <Button type="button" variant="outline" disabled={interactionLocked || restoringId !== null || purgingId !== null}
                  aria-label={`Permanently delete ${project.name}`} title={`Permanently delete ${project.name}`}
                  onClick={() => { setConfirmId(project.id); setError(null); }}>
                  Delete
                </Button>
              </div>
            </div>
            {confirmId === project.id && <div className="mt-2 border border-destructive/50 p-2">
              <p>Permanently delete {project.name}, including its source files and saved revisions? This cannot be undone.</p>
              <div className="mt-2 flex justify-end gap-1">
                <Button type="button" variant="outline" disabled={purgingId !== null} onClick={() => setConfirmId(null)}>Cancel</Button>
                <Button type="button" variant="danger" disabled={interactionLocked || purgingId !== null}
                  onClick={() => void purge(project.id)}>{purgingId === project.id ? 'Deleting...' : 'Delete permanently'}</Button>
              </div>
            </div>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
    </details>
  );
}
