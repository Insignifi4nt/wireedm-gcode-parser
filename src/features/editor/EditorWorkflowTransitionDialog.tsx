import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { EditorWorkflowSaveAvailability } from './workflows/editorWorkflowSession';

export interface EditorWorkflowTransitionDialogProps {
  nextWorkflowLabel: string | null;
  onDiscard: () => void;
  onDismiss: () => void;
  onSave: () => void;
  open: boolean;
  saveAvailability: EditorWorkflowSaveAvailability;
  workflowLabel: string;
}

export function EditorWorkflowTransitionDialog({
  nextWorkflowLabel,
  onDiscard,
  onDismiss,
  onSave,
  open,
  saveAvailability,
  workflowLabel
}: EditorWorkflowTransitionDialogProps) {
  if (!open) return null;

  const description = nextWorkflowLabel
    ? `Save or discard changes in ${workflowLabel} before opening ${nextWorkflowLabel}.`
    : `Save or discard changes in ${workflowLabel} before closing it.`;
  const saveReasonId = 'editor-workflow-transition-save-reason';

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
      <div
        aria-describedby="editor-workflow-transition-description"
        aria-labelledby="editor-workflow-transition-title"
        aria-modal="true"
        className="w-full max-w-md border border-border bg-card shadow-2xl"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4">
          <div>
            <h2 className="font-mono text-sm font-semibold" id="editor-workflow-transition-title">
              Unsaved workflow changes
            </h2>
            <p
              className="mt-2 font-mono text-[11px] leading-5 text-muted-foreground"
              id="editor-workflow-transition-description"
            >
              {description}
            </p>
          </div>
          <Button
            aria-label="Dismiss workflow transition"
            onClick={onDismiss}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X />
          </Button>
        </div>

        {!saveAvailability.enabled && (
          <p
            className="border-b border-border px-4 py-3 font-mono text-[10px] leading-4 text-destructive"
            id={saveReasonId}
          >
            {saveAvailability.reason}
          </p>
        )}

        <div className="flex justify-end gap-2 p-4">
          <Button
            data-editor-workflow-transition-action="discard"
            onClick={onDiscard}
            type="button"
            variant="outline"
          >
            Discard
          </Button>
          <Button
            aria-describedby={saveAvailability.enabled ? undefined : saveReasonId}
            data-editor-workflow-transition-action="save"
            disabled={!saveAvailability.enabled}
            onClick={onSave}
            type="button"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
