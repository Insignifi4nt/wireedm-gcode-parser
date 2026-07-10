import { useRef, type ChangeEvent } from 'react';
import { FileCode, FilePlus2, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface StartWorkPanelProps {
  connected: boolean;
  dxfErrorMessage: string | null;
  dxfImporting: boolean;
  programErrorMessage: string | null;
  programImporting: boolean;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenEditor: () => void;
}

export function StartWorkPanel({
  connected,
  dxfErrorMessage,
  dxfImporting,
  programErrorMessage,
  programImporting,
  onImportDxfFile,
  onImportProgramFile,
  onOpenEditor
}: StartWorkPanelProps) {
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const programInputRef = useRef<HTMLInputElement>(null);
  const isImporting = dxfImporting || programImporting;

  async function handleDxfInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportDxfFile(file);
    input.value = '';
  }

  async function handleProgramInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportProgramFile(file);
    input.value = '';
  }

  return (
    <section className="technical-panel" aria-label="Start work">
      <div className="technical-panel-header">
        <h3 className="text-xs font-semibold">Start Work</h3>
      </div>
      <div className="grid gap-3 p-3 text-[11px]">
        <input
          ref={dxfInputRef}
          accept=".dxf,application/dxf"
          aria-label="DXF file"
          className="hidden"
          disabled={!connected || isImporting}
          onChange={handleDxfInputChange}
          type="file"
        />
        <input
          ref={programInputRef}
          accept=".gcode,.nc,.iso,.txt,text/plain"
          aria-label="Machine program file"
          className="hidden"
          disabled={!connected || isImporting}
          onChange={handleProgramInputChange}
          type="file"
        />

        <div className="grid gap-1">
          <span className="technical-label">DXF geometry</span>
          <Button
            disabled={!connected || isImporting}
            onClick={() => dxfInputRef.current?.click()}
            type="button"
          >
            <FileUp />
            {dxfImporting ? 'Importing Path Project...' : 'Import DXF as Path Project'}
          </Button>
        </div>

        <div className="grid gap-1">
          <span className="technical-label">Posted file: .gcode, .nc, .iso, .txt</span>
          <Button
            disabled={!connected || isImporting}
            onClick={() => programInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <FileCode />
            {programImporting ? 'Opening Machine Program...' : 'Open Machine Program'}
          </Button>
        </div>

        <div className="grid gap-1">
          <span className="technical-label">Program workspace</span>
          <Button
            disabled={!connected || isImporting}
            onClick={onOpenEditor}
            type="button"
            variant="outline"
          >
            <FilePlus2 />
            Open Editor
          </Button>
        </div>

        {dxfErrorMessage && (
          <p className="border border-destructive bg-destructive/10 p-2 text-destructive">
            {dxfErrorMessage}
          </p>
        )}
        {programErrorMessage && (
          <p className="border border-destructive bg-destructive/10 p-2 text-destructive">
            {programErrorMessage}
          </p>
        )}
      </div>
    </section>
  );
}
