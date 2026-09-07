import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useModalFocus } from '@/components/ui/useModalFocus';
import { MAX_PROJECT_NAME_LENGTH, projectNameError } from '@/domain/workbench-catalog/projectName';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';

type WorkbenchProjectIndexEntry = WorkbenchCatalogManifest['projects'][number];

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
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const busy = isSaving || interactionLocked;
  function dismiss() {
    if (!savingRef.current && !interactionLocked) onClose();
  }
  useModalFocus({ open: Boolean(action), overlayRef, dialogRef,
    initialFocusRef: action?.kind === 'rename' ? nameRef : cancelRef,
    onClose: dismiss, dismissible: !busy });

  useEffect(() => {
    if (!action) return;
    setName(action.project.name);
    setIsSaving(false);
    setErrorMessage(null);
  }, [action]);

  if (!action) return null;

  const { kind, project } = action;
  const isRename = kind === 'rename';
  const nameError = isRename ? projectNameError(name) : null;
  const projectTypeLabel = isPathProjectSourceKind(project.sourceKind)
    ? 'Path Project'
    : 'Machine Program';
  const title = isRename ? 'Rename project' : 'Delete project';
  const submitLabel = isRename ? 'Rename' : 'Delete';
  const savingLabel = isRename ? 'Saving...' : 'Deleting...';
  const fallbackError = isRename
    ? 'Could not rename workbench project.'
    : 'Could not delete workbench project.';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current || interactionLocked) return;

    const nextName = name.trim();
    if (nameError) return;

    savingRef.current = true;
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
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <form
        ref={dialogRef}
        tabIndex={-1}
        aria-busy={busy}
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
                ? `Choose a clear project name, up to ${MAX_PROJECT_NAME_LENGTH} characters.`
                : 'This permanently removes the manifest entry and owned project files.'}
            </p>
          </div>
          <button
            aria-label={`Close ${kind} dialog`}
            className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
            onClick={dismiss}
            disabled={busy}
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
                ref={nameRef}
                aria-label="Project name"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? 'project-name-error' : undefined}
                className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                disabled={isSaving || interactionLocked}
                onChange={(event) => setName(event.currentTarget.value)}
                value={name}
              />
              {nameError && <span id="project-name-error" role="alert" className="text-destructive">{nameError}</span>}
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
          <p role="alert" className="border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button ref={cancelRef} disabled={busy} onClick={dismiss} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={interactionLocked || isSaving || Boolean(nameError)}
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

function isPathProjectSourceKind(
  sourceKind: WorkbenchProjectIndexEntry['sourceKind']
): sourceKind is 'dxf' | 'upid' {
  return sourceKind === 'dxf' || sourceKind === 'upid';
}
