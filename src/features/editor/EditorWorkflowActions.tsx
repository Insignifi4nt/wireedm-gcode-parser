import type { EditorMutatingWorkflowSession } from './workflows/editorWorkflowSession';

interface EditorWorkflowActionsProps {
  workflow: Pick<EditorMutatingWorkflowSession, 'commandId' | 'label' | 'dirty' | 'saveAvailability'>;
  readOnly?: boolean;
  onApply: () => void;
  onClose: () => void;
}

const secondaryButton = 'h-7 border border-border px-2 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring';

/** Applying commits an undo step to the editor draft; only the header Save persists it. */
export function EditorWorkflowActions({ workflow, readOnly, onApply, onClose }: EditorWorkflowActionsProps) {
  const availability = workflow.saveAvailability;
  return (
    <div className="mt-3 border-t border-border pt-2" data-editor-workflow-actions={workflow.commandId}>
      {readOnly && !workflow.dirty ? (
        <button
          aria-label={`Close ${workflow.label} workflow`}
          className={`${secondaryButton} w-full`}
          onClick={onClose}
          type="button"
        >
          Close
        </button>
      ) : (
        <>
          {!availability.enabled && (
            <p className="mb-1 text-[10px] leading-4 text-amber-300" data-editor-workflow-save-reason>
              {availability.reason}
            </p>
          )}
          <p className="mb-2 text-[10px] leading-4 text-muted-foreground">
            Apply updates the draft. Save the project to keep it.
          </p>
          <div className="grid grid-cols-2 gap-1">
            <button aria-label={`Cancel ${workflow.label} workflow`} className={secondaryButton} onClick={onClose} type="button">
              Cancel
            </button>
            <button
              aria-label={`Apply ${workflow.label} workflow`}
              className="h-7 border border-primary bg-primary px-2 text-[10px] text-primary-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
              disabled={!availability.enabled}
              onClick={onApply}
              title={availability.enabled ? `Apply ${workflow.label} to the editor draft` : availability.reason}
              type="button"
            >
              Apply
            </button>
          </div>
        </>
      )}
    </div>
  );
}
