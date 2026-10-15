import { Input } from '@/components/ui/input';
import { MenuSurface, MenuItem } from '@/components/ui/menu';
import { useRef, type ChangeEvent } from 'react';
import { ChevronDown, FileCode, FileJson2, FilePlus2, FileSearch, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/ui/info-tip';
import { useDashboardMenu } from './useDashboardMenu';
import './dashboard.css';

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
  onOpenCad?: () => void;
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
  onOpenCad,
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
    <section className="dashboard-start" aria-label="Start work">
      <header className="dashboard-start-header"><h3>Start work</h3></header>
      <div className="dashboard-start-content">
        {onOpenCad && <div className="dashboard-start-group">
          <div className="dashboard-group-heading">
            <h4>Design and manufacturing</h4>
            <InfoTip label="About design and manufacturing" content="Parametric sketches, solid models and exact sketch or section handoff to CAM." />
          </div>
          <Button disabled={!connected || isImporting} onClick={onOpenCad} variant="outline" type="button" size="md">Design in CAD</Button>
        </div>}
        <Input
          ref={dxfInputRef}
          accept=".dxf,application/dxf"
          aria-label="DXF file"
          className="hidden"
          disabled={!connected || isImporting}
          onChange={handleDxfInputChange}
          type="file"
        />
        <Input
          ref={upidInputRef}
          accept=".upid.json,application/json"
          aria-label="UPID path project file"
          className="hidden"
          disabled={!connected || isImporting}
          onChange={handleUpidInputChange}
          type="file"
        />
        <Input
          ref={programInputRef}
          accept=".gcode,.nc,.iso,.txt,text/plain"
          aria-label="Machine program file"
          className="hidden"
          disabled={!connected || isImporting}
          onChange={handleProgramInputChange}
          type="file"
        />

        <div className="dashboard-start-group">
          <div className="dashboard-group-heading">
            <h4>DXF geometry</h4>
            <InfoTip label="About geometry import" content="Import DXF geometry as an editable path project, or use the arrow to open an existing UPID project." />
          </div>
          <div className="relative flex ui-button-group">
            <Button
              className="min-w-0 flex-1"
              disabled={!connected || isImporting}
              onClick={() => dxfInputRef.current?.click()}
              aria-label="Import DXF as Path Project"
              type="button" size="md" variant="default"
            >
              <FileUp />
              {dxfImporting ? 'Importing DXF…' : 'Import DXF'}
            </Button>
            <Button
              aria-expanded={upidMenuOpen}
              aria-controls={upidMenuOpen ? menu.menuId : undefined}
              aria-haspopup="menu"
              aria-label="More path project import options"
              className="w-8 shrink-0 border-l px-0"
              disabled={!connected || isImporting}
              onClick={() => menu.toggle('import')}
              onKeyDown={(event) => menu.onTriggerKeyDown(event, 'import')}
              ref={menu.triggerRef}
              type="button" size="md" variant="default"
            >
              <ChevronDown className="size-3.5" />
            </Button>
            {upidMenuOpen && (
              <MenuSurface
                aria-label="Path project import options"
                id={menu.menuId}
                ref={menu.menuRef}
                onKeyDown={menu.onMenuKeyDown}
                className="absolute right-0 top-full z-20 mt-1 min-w-56 p-1"
                role="menu"
              >
                <MenuItem
                  aria-label="Import UPID Path Project"
                  className="flex h-8 w-full items-center gap-2 px-2 text-left text-[10px]"
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
                </MenuItem>
              </MenuSurface>
            )}
          </div>
        </div>

        <div className="dashboard-start-group">
          <div className="dashboard-group-heading">
            <h4>Machine program</h4>
            <InfoTip label="About machine programs" content="Open .GCODE, .NC, .ISO or .TXT as an editable copy in the workbench. G-code inspection accepts a file or pasted text without creating a project." />
          </div>
          <Button
            disabled={!connected || isImporting}
            onClick={() => programInputRef.current?.click()}
            aria-label="Open Machine Program"
            type="button"
            variant="outline" size="md"
          >
            <FileCode />
            {programImporting ? 'Opening program…' : 'Open machine program'}
          </Button>
          {onInspectGCode && <>
            <Button disabled={isImporting} onClick={onInspectGCode} type="button" variant="outline" size="md">
              <FileSearch />Inspect G-code
            </Button>
          </>}
        </div>

        <div className="dashboard-start-group">
          <div className="dashboard-group-heading">
            <h4>Program workspace</h4>
            <InfoTip label="About the program workspace" content="Return to the current editor workspace. Opening a saved project from the library opens that project's editable draft." />
          </div>
          <Button
            disabled={!connected || isImporting}
            onClick={onOpenEditor}
            aria-label="Open Editor"
            type="button"
            variant="outline" size="md"
          >
            <FilePlus2 />
            Open editor
          </Button>
        </div>

        {dxfImporting && onCancelDxfImport && <Button onClick={onCancelDxfImport} type="button" variant="outline" size="md">Cancel DXF preparation</Button>}
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
