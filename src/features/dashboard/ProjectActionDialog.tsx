import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkbenchProjectIndexEntry } from '@/domain/storage/workbenchStorage';

export type ProjectAction =
  | { kind: 'rename'; project: WorkbenchProjectIndexEntry }
  | { kind: 'delete'; project: WorkbenchProjectIndexEntry };

interface ProjectActionDialogProps {
  action: ProjectAction | null;
  interactionLocked: boolean;
  onClose: () => void;
  onDeleteProject: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
}

export function ProjectActionDialog({
  action,
  interactionLocked,
  onClose,
  onDeleteProject,
  onRenameProject
}: ProjectActionDialogProps) {
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!action) return;
    setName(action.project.name);
    setIsSaving(false);
    setErrorMessage(null);
  }, [action]);

  useEffect(() => {
    if (!action) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [action, onClose]);

  if (!action) return null;

  const { kind, project } = action;
  const isRename = kind === 'rename';
  const projectTypeLabel = project.sourceKind === 'dxf' ? 'Path Project' : 'Machine Program';
  const title = isRename ? 'Rename project' : 'Delete project';
  const submitLabel = isRename ? 'Rename' : 'Delete';
  const savingLabel = isRename ? 'Saving...' : 'Deleting...';
  const fallbackError = isRename
    ? 'Could not rename workbench project.'
    : 'Could not delete workbench project.';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextName = name.trim();
    if (isRename && !nextName) return;

    setIsSaving(true);
    setErrorMessage(null);
    try {
      if (isRename) {
        await onRenameProject(project.id, nextName);
      } else {
        await onDeleteProject(project.id);
      }
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : fallbackError);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        aria-label={title}
        aria-modal="true"
        className="grid w-full max-w-lg gap-4 border border-border bg-card p-4 shadow-2xl"
        data-project-action-dialog={kind}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={handleSubmit}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-base font-semibold">{title}</h2>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {isRename
                ? 'Update the display name only. IDs, file paths, and provenance stay the same.'
                : 'This permanently removes the manifest entry and owned project files.'}
            </p>
          </div>
          <button
            aria-label={`Close ${kind} dialog`}
            className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid gap-2">
          {isRename ? (
            <label className="grid gap-1 font-mono text-[11px] text-muted-foreground">
              Project name
              <input
                aria-label="Project name"
                className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                disabled={isSaving || interactionLocked}
                onChange={(event) => setName(event.currentTarget.value)}
                value={name}
              />
            </label>
          ) : (
            <p className="font-mono text-[11px] text-foreground">{project.name}</p>
          )}
          <p className="flex flex-wrap items-center gap-x-2 font-mono text-[10px] text-muted-foreground">
            <span>{projectTypeLabel}</span>
            <span aria-hidden="true">/</span>
            <span>{project.path}</span>
          </p>
        </div>

        {errorMessage && (
          <p className="border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button disabled={isSaving} onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={interactionLocked || isSaving || (isRename && name.trim() === '')}
            type="submit"
            variant={isRename ? 'default' : 'danger'}
          >
            {isSaving ? savingLabel : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
