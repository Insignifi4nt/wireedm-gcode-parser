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
  interactionLocked: boolean;
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
  interactionLocked,
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
  const visibleExportLabel =
    exportLabel === 'Open Path Project export preview' ? 'Export Preview' : exportLabel;

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || interactionLocked) return;

    await onImportProgramFile(file);
    input.value = '';
  }

  return (
    <div
      className="mr-2 flex min-w-0 flex-1 items-center gap-1.5"
      data-editor-context={documentContext}
    >
      <Button
        aria-label="Back to Dashboard"
        className="h-7 shrink-0 px-2 text-[10px]"
        disabled={interactionLocked}
        onClick={onBackToDashboard}
        size="sm"
        title="Return to Workbench"
        variant="outline"
      >
        <ArrowLeft />
        <span data-editor-back-label>Workbench</span>
        <span className="sr-only"> Dashboard</span>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">{eyebrow}</p>
          <span className="rounded-[2px] border border-border bg-background/60 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            {DOCUMENT_CONTEXT_LABELS[documentContext]}
          </span>
        </div>
        <h2 className="technical-value truncate text-[12px] font-semibold" title={titleTooltip ?? filePath}>
          {heading}
        </h2>
      </div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
        {workspaceControls}
        <Button
          aria-label="Undo active document change"
          className="h-7 px-2 text-[10px]"
          data-editor-header-command
          disabled={!undoAvailable || interactionLocked}
          onClick={onUndo}
          size="sm"
          title="Undo"
          variant="outline"
        >
          <Undo2 />
          <span data-editor-header-command-label>Undo</span>
        </Button>
        <Button
          aria-label="Redo active document change"
          className="h-7 px-2 text-[10px]"
          data-editor-header-command
          disabled={!redoAvailable || interactionLocked}
          onClick={onRedo}
          size="sm"
          title="Redo"
          variant="outline"
        >
          <Redo2 />
          <span data-editor-header-command-label>Redo</span>
        </Button>
        <Button
          aria-label="Save active document"
          className="h-7 px-2 text-[10px]"
          data-editor-header-command
          disabled={!hasUnsavedChanges || interactionLocked}
          onClick={onSave}
          size="sm"
          title="Save"
          variant="outline"
        >
          <Save />
          <span data-editor-header-command-label>{isSaving ? 'Saving...' : 'Save'}</span>
        </Button>
        {onExport && exportLabel && (
          <Button
            aria-label={exportLabel}
            className="h-7 px-2 text-[10px]"
            data-editor-header-command
            disabled={!exportAvailable || interactionLocked}
            onClick={onExport}
            size="sm"
            title={visibleExportLabel ?? exportLabel}
            variant="outline"
          >
            <FileOutput />
            <span data-editor-header-command-label>{visibleExportLabel}</span>
          </Button>
        )}
        <input
          ref={fileInputRef}
          accept=".gcode,.nc,.iso,.txt,text/plain"
          aria-label="G-code program file"
          className="hidden"
          disabled={interactionLocked}
          onChange={handleFileInputChange}
          type="file"
        />
        <Button
          {...guideTargetProps('import-program', guideHighlightTarget)}
          aria-label={isImporting ? 'Importing program' : 'Import Program'}
          className={`h-7 px-2 text-[10px] ${guideHighlightClass(
            'import-program',
            guideHighlightTarget
          )}`}
          data-editor-header-command
          disabled={interactionLocked}
          onClick={() => fileInputRef.current?.click()}
          size="sm"
          title="Import Program"
          variant="default"
        >
          <FileUp />
          <span data-editor-header-command-label>
            {isImporting ? 'Importing...' : 'Import Program'}
          </span>
        </Button>
        <Button
          aria-label="Open usage guide"
          className="h-7 px-2 text-[10px]"
          data-editor-header-command
          onClick={onOpenGuide}
          size="sm"
          title="Controls"
          variant="outline"
        >
          <CircleHelp />
          <span data-editor-header-command-label>Controls</span>
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
