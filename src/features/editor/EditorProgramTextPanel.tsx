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
    <details
      className="overflow-hidden border border-border bg-card/70"
      data-editor-code-section="text"
    >
      <summary className="flex h-7 cursor-pointer select-none items-center justify-between gap-2 border-b border-border bg-card/80 px-2 font-mono outline-none hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
        <h3 className="shrink-0 text-[11px] font-semibold">Program Text</h3>
        {hasUnsavedChanges && (
          <span className="shrink-0 text-[10px] text-muted-foreground">Unsaved</span>
        )}
      </summary>
      <div className="grid h-[240px] min-h-0 border-t border-border">
        <textarea
          aria-label="Program editor"
          className="min-h-0 resize-none overflow-auto border-0 bg-background/70 p-2 font-mono text-[10px] leading-4 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
          disabled={!program || isSaving}
          onChange={(event) => onDraftTextChange(event.currentTarget.value)}
          placeholder="No program loaded."
          spellCheck={false}
          value={draftText}
        />
      </div>
    </details>
  );
}
