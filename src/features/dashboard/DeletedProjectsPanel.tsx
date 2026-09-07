import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';

export function DeletedProjectsPanel({ entries, interactionLocked, onRestoreProject }: {
  readonly entries: NonNullable<WorkbenchCatalogManifest['deletedProjects']>;
  readonly interactionLocked: boolean;
  readonly onRestoreProject: (projectId: string) => Promise<void>;
}) {
  const pending = useRef(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
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
  if (entries.length === 0) return null;
  return (
    <details className="border border-border bg-card p-3 font-mono text-[11px]">
      <summary className="cursor-pointer">Deleted projects ({entries.length})</summary>
      <p className="my-2 text-[10px] text-muted-foreground">
        Deleted projects retain their files and saved revisions. Deletion does not free storage.
      </p>
      <ul className="grid gap-2">
        {entries.map(({ project, deletedAt }) => (
          <li key={project.id} className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <div className="min-w-0">
              <p className="truncate" title={project.name}>{project.name}</p>
              <p className="text-[10px] text-muted-foreground">Deleted {new Date(deletedAt).toLocaleDateString()}</p>
            </div>
            <Button type="button" variant="outline" disabled={interactionLocked || restoringId !== null}
              aria-label={`Restore ${project.name}`} onClick={() => void restore(project.id)}>
              {restoringId === project.id ? 'Restoring...' : 'Restore'}
            </Button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
    </details>
  );
}
