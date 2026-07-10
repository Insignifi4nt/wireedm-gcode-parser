import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { ArrowLeft, CircleHelp, FileOutput, FileUp, Redo2, Save, Undo2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';

export type EditorDocumentContext = 'empty-program' | 'machine-program' | 'path-project';

const DOCUMENT_CONTEXT_LABELS: Record<EditorDocumentContext, string> = {
  'empty-program': 'Empty Program',
  'machine-program': 'Machine Program',
  'path-project': 'Path Project'
};

interface EditorHeaderBarProps {
  documentContext: EditorDocumentContext;
  eyebrow?: string;
  exportAvailable: boolean;
  exportLabel: string | null;
  filePath: string | undefined;
  guideHighlightTarget: EditorGuideTarget | null;
  hasUnsavedChanges: boolean;
  importErrorMessage: string | null;
  isImporting: boolean;
  isSaving: boolean;
  redoAvailable: boolean;
  saveErrorMessage: string | null;
  title?: string;
  titleTooltip?: string;
  undoAvailable: boolean;
  workspaceControls?: ReactNode;
  onBackToDashboard: () => void;
  onExport: (() => void) | null;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenGuide: () => void;
  onRedo: () => void;
  onSave: () => void | Promise<void>;
  onUndo: () => void;
}

export function EditorHeaderBar({
  documentContext,
  eyebrow = 'Editor',
  exportAvailable,
  exportLabel,
  filePath,
  guideHighlightTarget,
  hasUnsavedChanges,
  importErrorMessage,
  isImporting,
  isSaving,
  redoAvailable,
  saveErrorMessage,
  title,
  titleTooltip,
  undoAvailable,
  workspaceControls,
  onBackToDashboard,
  onExport,
  onImportProgramFile,
  onOpenGuide,
  onRedo,
  onSave,
  onUndo
}: EditorHeaderBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const heading = title ?? filePath ?? 'Import or open a G-code program';

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportProgramFile(file);
    input.value = '';
  }

  return (
    <div
      className="mr-3 flex min-w-0 flex-1 items-center gap-2"
      data-editor-context={documentContext}
    >
      <Button
        aria-label="Back to Dashboard"
        className="h-7 shrink-0 px-2 text-[10px]"
        onClick={onBackToDashboard}
        size="sm"
        variant="outline"
      >
        <ArrowLeft />
        Workbench
        <span className="sr-only"> Dashboard</span>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="font-mono text-[9px] uppercase text-muted-foreground">{eyebrow}</p>
          <span className="border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground">
            {DOCUMENT_CONTEXT_LABELS[documentContext]}
          </span>
        </div>
        <h2 className="truncate font-mono text-[12px] font-semibold" title={titleTooltip ?? filePath}>
          {heading}
        </h2>
      </div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
        {workspaceControls}
        <Button
          aria-label="Undo active document change"
          className="h-7 px-2 text-[10px]"
          disabled={!undoAvailable || isSaving}
          onClick={onUndo}
          size="sm"
          variant="outline"
        >
          <Undo2 />
          Undo
        </Button>
        <Button
          aria-label="Redo active document change"
          className="h-7 px-2 text-[10px]"
          disabled={!redoAvailable || isSaving}
          onClick={onRedo}
          size="sm"
          variant="outline"
        >
          <Redo2 />
          Redo
        </Button>
        <Button
          aria-label="Save active document"
          className="h-7 px-2 text-[10px]"
          disabled={!hasUnsavedChanges || isSaving}
          onClick={onSave}
          size="sm"
          variant="outline"
        >
          <Save />
          {isSaving ? 'Saving...' : 'Save'}
        </Button>
        {onExport && exportLabel && (
          <Button
            aria-label={exportLabel}
            className="h-7 px-2 text-[10px]"
            disabled={!exportAvailable || isSaving}
            onClick={onExport}
            size="sm"
            variant="outline"
          >
            <FileOutput />
            {exportLabel}
          </Button>
        )}
        <input
          ref={fileInputRef}
          accept=".gcode,.nc,.iso,.txt,text/plain"
          aria-label="G-code program file"
          className="hidden"
          disabled={isImporting}
          onChange={handleFileInputChange}
          type="file"
        />
        <Button
          {...guideTargetProps('import-program', guideHighlightTarget)}
          className={`h-7 px-2 text-[10px] ${guideHighlightClass(
            'import-program',
            guideHighlightTarget
          )}`}
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          variant="default"
        >
          <FileUp />
          {isImporting ? 'Importing...' : 'Import Program'}
        </Button>
        <Button
          aria-label="Open usage guide"
          className="h-7 px-2 text-[10px]"
          onClick={onOpenGuide}
          size="sm"
          variant="outline"
        >
          <CircleHelp />
          Controls
        </Button>
      </div>
      {(importErrorMessage || saveErrorMessage) && (
        <div className="absolute left-10 right-3 top-10 z-50 space-y-1">
          {importErrorMessage && (
            <p className="border border-destructive bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive">
              {importErrorMessage}
            </p>
          )}
          {saveErrorMessage && (
            <p className="border border-destructive bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive">
              {saveErrorMessage}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
