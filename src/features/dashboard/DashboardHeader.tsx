import { useRef, type ChangeEvent } from 'react';
import { FileCode, FileUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

interface DashboardHeaderProps {
  connectedWorkbench: ConnectedWorkbench | null;
  importErrorMessage: string | null;
  importStatus: 'idle' | 'importing' | 'error';
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  onImportDxfFile: (file: File) => void | Promise<void>;
  onOpenEditor: () => void;
}

export function DashboardHeader({
  connectedWorkbench,
  importErrorMessage,
  importStatus,
  workbenchStatus,
  onImportDxfFile,
  onOpenEditor
}: DashboardHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPreparing = workbenchStatus === 'initializing';
  const isImporting = importStatus === 'importing';
  const storageLabel = getStorageLabel(connectedWorkbench, isPreparing);

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportDxfFile(file);
    input.value = '';
  }

  return (
    <section className="border-b border-border bg-background/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase text-muted-foreground">Dashboard</p>
          <h2 className="mt-1 font-mono text-base font-semibold">{storageLabel}</h2>
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            accept=".dxf,application/dxf"
            aria-label="DXF file"
            className="hidden"
            disabled={!connectedWorkbench || isPreparing || isImporting}
            onChange={handleFileInputChange}
            type="file"
          />
          <Button
            disabled={!connectedWorkbench || isPreparing || isImporting}
            onClick={() => fileInputRef.current?.click()}
            variant="default"
          >
            <FileUp />
            {isImporting ? 'Importing...' : 'Import DXF'}
          </Button>
          <Button
            disabled={!connectedWorkbench || isPreparing}
            onClick={onOpenEditor}
            variant="outline"
          >
            <FileCode />
            Open Editor
          </Button>
        </div>
      </div>

      {importErrorMessage && (
        <p className="mt-3 border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
          {importErrorMessage}
        </p>
      )}
    </section>
  );
}

function getStorageLabel(connectedWorkbench: ConnectedWorkbench | null, isPreparing: boolean) {
  if (isPreparing) return 'Preparing local storage workbench';
  if (!connectedWorkbench) return 'Storage not connected';
  if (connectedWorkbench.adapter.kind === 'directory') return 'Workbench folder active';
  if (connectedWorkbench.adapter.kind === 'memory') return 'Temporary storage workbench active';
  return 'Browser cache workbench active';
}
