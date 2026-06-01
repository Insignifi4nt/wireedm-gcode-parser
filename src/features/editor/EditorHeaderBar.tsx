import { useRef, type ChangeEvent, type ReactNode } from 'react';
import { ArrowLeft, CircleHelp, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';

interface EditorHeaderBarProps {
  eyebrow?: string;
  filePath: string | undefined;
  guideHighlightTarget: EditorGuideTarget | null;
  importErrorMessage: string | null;
  isImporting: boolean;
  saveErrorMessage: string | null;
  title?: string;
  titleTooltip?: string;
  workspaceControls?: ReactNode;
  onBackToDashboard: () => void;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenGuide: () => void;
}

export function EditorHeaderBar({
  eyebrow = 'Editor',
  filePath,
  guideHighlightTarget,
  importErrorMessage,
  isImporting,
  saveErrorMessage,
  title,
  titleTooltip,
  workspaceControls,
  onBackToDashboard,
  onImportProgramFile,
  onOpenGuide
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
    <div className="mr-3 flex min-w-0 flex-1 items-center gap-2">
      <Button
        className="h-7 shrink-0 px-2 text-[10px]"
        onClick={onBackToDashboard}
        size="sm"
        variant="outline"
      >
        <ArrowLeft />
        Dashboard
      </Button>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[9px] uppercase text-muted-foreground">{eyebrow}</p>
        <h2 className="truncate font-mono text-[12px] font-semibold" title={titleTooltip ?? filePath}>
          {heading}
        </h2>
      </div>
      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1">
        {workspaceControls}
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
