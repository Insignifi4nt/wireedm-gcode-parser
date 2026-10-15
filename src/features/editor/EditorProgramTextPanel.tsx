import { Textarea } from '@/components/ui/textarea';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';

interface EditorProgramTextPanelProps {
  draftText: string;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  program: LoadedEditorProgram | null;
  onDraftTextChange: (text: string) => void;
}

export function EditorProgramTextPanel({
  draftText,
  hasUnsavedChanges,
  isSaving,
  program,
  onDraftTextChange
}: EditorProgramTextPanelProps) {
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-card/70"
      data-editor-code-section="text"
    >
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-3 font-mono">
        <h3 className="shrink-0 text-[11px] font-semibold">Program Text</h3>
        {hasUnsavedChanges && (
          <span className="shrink-0 text-[10px] text-muted-foreground">Unsaved</span>
        )}
      </div>
      <div className="grid min-h-0 flex-1">
        <Textarea
          aria-label="Program editor"
          className="gcode-text-input work-region-scrollbar min-h-0 resize-none overflow-auto border-0 p-3 placeholder:text-muted-foreground"
          disabled={!program || isSaving}
          onChange={(event) => onDraftTextChange(event.currentTarget.value)}
          placeholder="No program loaded."
          spellCheck={false}
          wrap="off"
          value={draftText}
        />
      </div>
    </section>
  );
}
