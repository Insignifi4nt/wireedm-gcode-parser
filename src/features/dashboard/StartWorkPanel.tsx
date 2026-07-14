import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, FileCode, FileJson2, FilePlus2, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';

export interface StartWorkPanelProps {
  connected: boolean;
  dxfErrorMessage: string | null;
  dxfImporting: boolean;
  interactionLocked: boolean;
  programErrorMessage: string | null;
  programImporting: boolean;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportUpidFile: (file: File) => void | Promise<void>;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenEditor: () => void;
}

export function StartWorkPanel({
  connected,
  dxfErrorMessage,
  dxfImporting,
  interactionLocked,
  programErrorMessage,
  programImporting,
  onImportDxfFile,
  onImportUpidFile,
  onImportProgramFile,
  onOpenEditor
}: StartWorkPanelProps) {
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const upidInputRef = useRef<HTMLInputElement>(null);
  const programInputRef = useRef<HTMLInputElement>(null);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const importMenuButtonRef = useRef<HTMLButtonElement>(null);
  const [upidMenuOpen, setUpidMenuOpen] = useState(false);
  const isImporting = interactionLocked || dxfImporting || programImporting;

  useEffect(() => {
    if (!upidMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (event.target instanceof Node && !importMenuRef.current?.contains(event.target)) {
        setUpidMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setUpidMenuOpen(false);
      importMenuButtonRef.current?.focus();
    }

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [upidMenuOpen]);

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

  async function handleUpidInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setUpidMenuOpen(false);
    await onImportUpidFile(file);
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
          ref={upidInputRef}
          accept=".upid.json,application/json"
          aria-label="UPID path project file"
          className="hidden"
          disabled={!connected || isImporting}
          onChange={handleUpidInputChange}
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
          <div className="relative flex" ref={importMenuRef}>
            <Button
              className="min-w-0 flex-1 rounded-r-none"
              disabled={!connected || isImporting}
              onClick={() => dxfInputRef.current?.click()}
              type="button"
            >
              <FileUp />
              {dxfImporting ? 'Importing Path Project...' : 'Import DXF as Path Project'}
            </Button>
            <Button
              aria-expanded={upidMenuOpen}
              aria-haspopup="menu"
              aria-label="More path project import options"
              className="w-8 shrink-0 rounded-l-none border-l border-primary-foreground/25 px-0"
              disabled={!connected || isImporting}
              onClick={() => setUpidMenuOpen((open) => !open)}
              ref={importMenuButtonRef}
              type="button"
            >
              <ChevronDown className="size-3.5" />
            </Button>
            {upidMenuOpen && (
              <div
                aria-label="Path project import options"
                className="absolute right-0 top-full z-20 mt-1 min-w-56 border border-border bg-popover p-1 shadow-xl"
                role="menu"
              >
                <button
                  aria-label="Import UPID Path Project"
                  className="flex h-8 w-full items-center gap-2 px-2 text-left text-[10px] text-popover-foreground outline-none hover:bg-accent focus:bg-accent"
                  onClick={() => {
                    setUpidMenuOpen(false);
                    upidInputRef.current?.click();
                  }}
                  role="menuitem"
                  type="button"
                >
                  <FileJson2 className="size-3.5" />
                  Import UPID Path Project
                </button>
              </div>
            )}
          </div>
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
