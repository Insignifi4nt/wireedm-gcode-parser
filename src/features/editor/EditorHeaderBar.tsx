import { useRef, type ChangeEvent } from 'react';
import { ArrowLeft, CircleHelp, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';

interface EditorHeaderBarProps {
  filePath: string | undefined;
  guideHighlightTarget: EditorGuideTarget | null;
  importErrorMessage: string | null;
  isImporting: boolean;
  saveErrorMessage: string | null;
  onBackToDashboard: () => void;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenGuide: () => void;
}

export function EditorHeaderBar({
  filePath,
  guideHighlightTarget,
  importErrorMessage,
  isImporting,
  saveErrorMessage,
  onBackToDashboard,
  onImportProgramFile,
  onOpenGuide
}: EditorHeaderBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportProgramFile(file);
    input.value = '';
  }

  return (
    <section className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border bg-background/90 px-2 py-1">
      <div className="min-w-[220px] flex-1">
        <p className="font-mono text-[9px] uppercase text-muted-foreground">Editor</p>
        <h2 className="truncate font-mono text-[12px] font-semibold" title={filePath}>
          {filePath ?? 'Import or open a G-code program'}
        </h2>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
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
        <Button
          className="h-7 px-2 text-[10px]"
          onClick={onBackToDashboard}
          size="sm"
          variant="outline"
        >
          <ArrowLeft />
          Dashboard
        </Button>
      </div>
      {(importErrorMessage || saveErrorMessage) && (
        <div className="basis-full space-y-1">
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
    </section>
  );
}
