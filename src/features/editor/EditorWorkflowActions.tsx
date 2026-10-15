import { Button } from '@/components/ui/button';
import type { EditorMutatingWorkflowSession } from './workflows/editorWorkflowSession';

interface EditorWorkflowActionsProps {
  workflow: Pick<EditorMutatingWorkflowSession, 'commandId' | 'label' | 'dirty' | 'saveAvailability'>;
  readOnly?: boolean;
  onApply: () => void;
  onClose: () => void;
}

/** Applying commits an undo step to the editor draft; only the header Save persists it. */
export function EditorWorkflowActions({ workflow, readOnly, onApply, onClose }: EditorWorkflowActionsProps) {
  const availability = workflow.saveAvailability;
  return (
    <div className="mt-3 border-t border-border pt-2" data-editor-workflow-actions={workflow.commandId}>
      {readOnly && !workflow.dirty ? (
        <Button variant="outline" size="md"
          aria-label={`Close ${workflow.label} workflow`}
          className="w-full"
          onClick={onClose}
          type="button"
        >
          Close
        </Button>
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
            <Button variant="outline" size="md" aria-label={`Cancel ${workflow.label} workflow`} onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" size="md"
              aria-label={`Apply ${workflow.label} workflow`}
              className="px-2"
              disabled={!availability.enabled}
              onClick={onApply}
              title={availability.enabled ? `Apply ${workflow.label} to the editor draft` : availability.reason}
              type="button"
            >
              Apply
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
