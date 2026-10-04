import { useRef, type ChangeEvent } from 'react';
import { ChevronDown, FileCode, FileJson2, FilePlus2, FileSearch, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useDashboardMenu } from './useDashboardMenu';

export interface StartWorkPanelProps {
  connected: boolean;
  dxfErrorMessage: string | null;
  dxfImporting: boolean;
  interactionLocked: boolean;
  programErrorMessage: string | null;
  programImporting: boolean;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onCancelDxfImport?: () => void;
  onImportUpidFile: (file: File) => void | Promise<void>;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onOpenEditor: () => void;
  onInspectGCode?: () => void;
}

export function StartWorkPanel({
  connected,
  dxfErrorMessage,
  dxfImporting,
  interactionLocked,
  programErrorMessage,
  programImporting,
  onImportDxfFile,
  onCancelDxfImport,
  onImportUpidFile,
  onImportProgramFile,
  onOpenEditor,
  onInspectGCode
}: StartWorkPanelProps) {
  const dxfInputRef = useRef<HTMLInputElement>(null);
  const upidInputRef = useRef<HTMLInputElement>(null);
  const programInputRef = useRef<HTMLInputElement>(null);
  const isImporting = interactionLocked || dxfImporting || programImporting;
  const menu = useDashboardMenu(!connected || isImporting);
  const upidMenuOpen = menu.openId !== null && connected && !isImporting;

  async function handleDxfInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    input.value = '';
    await onImportDxfFile(file);
  }

  async function handleProgramInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    input.value = '';
    await onImportProgramFile(file);
  }

  async function handleUpidInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    menu.close();
    input.value = '';
    await onImportUpidFile(file);
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
          <div className="relative flex">
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
              aria-controls={upidMenuOpen ? menu.menuId : undefined}
              aria-haspopup="menu"
              aria-label="More path project import options"
              className="w-8 shrink-0 rounded-l-none border-l border-primary-foreground/25 px-0"
              disabled={!connected || isImporting}
              onClick={() => menu.toggle('import')}
              onKeyDown={(event) => menu.onTriggerKeyDown(event, 'import')}
              ref={menu.triggerRef}
              type="button"
            >
              <ChevronDown className="size-3.5" />
            </Button>
            {upidMenuOpen && (
              <div
                aria-label="Path project import options"
                id={menu.menuId}
                ref={menu.menuRef}
                onKeyDown={menu.onMenuKeyDown}
                className="absolute right-0 top-full z-20 mt-1 min-w-56 border border-border bg-popover p-1 shadow-xl"
                role="menu"
              >
                <button
                  aria-label="Import UPID Path Project"
                  className="flex h-8 w-full items-center gap-2 px-2 text-left text-[10px] text-popover-foreground outline-none hover:bg-accent focus:bg-accent"
                  onClick={() => {
                    menu.close(true);
                    upidInputRef.current?.click();
                  }}
                  role="menuitem"
                  tabIndex={-1}
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
          {onInspectGCode && <>
            <Button disabled={isImporting} onClick={onInspectGCode} type="button" variant="outline">
              <FileSearch />Inspect G-code
            </Button>
            <p className="text-[10px] text-muted-foreground">Quick file or paste inspection. No project created.</p>
          </>}
          <Button
            disabled={!connected || isImporting}
            onClick={() => programInputRef.current?.click()}
            type="button"
            variant="outline"
          >
            <FileCode />
            {programImporting ? 'Opening Machine Program...' : 'Open Machine Program'}
          </Button>
          <p className="text-[10px] text-muted-foreground">Import an editable copy into the workbench.</p>
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

        {dxfImporting && onCancelDxfImport && <Button onClick={onCancelDxfImport} type="button" variant="outline">Cancel DXF preparation</Button>}
        {dxfErrorMessage && (
          <p role="alert" className="border border-destructive bg-destructive/10 p-2 text-destructive">
            {dxfErrorMessage}
          </p>
        )}
        {programErrorMessage && (
          <p role="alert" className="border border-destructive bg-destructive/10 p-2 text-destructive">
            {programErrorMessage}
          </p>
        )}
      </div>
    </section>
  );
}
