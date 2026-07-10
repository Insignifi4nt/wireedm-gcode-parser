import { useEffect, useState } from 'react';
import { Database, RefreshCw, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BROWSER_WORKBENCH_NAMESPACE } from '@/domain/storage/connectCachedWorkbench';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { MachineOutputSettingsPanel } from './MachineOutputSettingsPanel';

type WorkbenchStatus = 'initializing' | 'ready' | 'connecting-storage' | 'error';

interface WorkbenchSettingsDialogProps {
  connectedWorkbench: ConnectedWorkbench | null;
  errorMessage: string | null;
  onClose: () => void;
  onConnectWorkbench: () => void | Promise<void>;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
  open: boolean;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  storageActionLabel: string | null;
  storageWarningMessage: string | null;
  workbenchStatus: WorkbenchStatus;
}

export function WorkbenchSettingsDialog({
  connectedWorkbench,
  errorMessage,
  onClose,
  onConnectWorkbench,
  onSaveWorkbenchSettings,
  open,
  settingsErrorMessage,
  settingsStatus,
  storageActionLabel,
  storageWarningMessage,
  workbenchStatus
}: WorkbenchSettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<'storage' | 'machine-output'>('storage');

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) setActiveSection('storage');
  }, [open]);

  if (!open) return null;

  const isConnecting =
    workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage';
  const isConnected = workbenchStatus === 'ready' && connectedWorkbench !== null;
  const statusLabel = getStorageStatusLabel(connectedWorkbench, workbenchStatus);
  const locationRows = getStorageLocationRows(connectedWorkbench);
  const canConnect = Boolean(storageActionLabel) && !isConnecting;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      data-workbench-settings-overlay
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        aria-label="Workbench settings"
        aria-modal="true"
        className="grid max-h-[86vh] w-full max-w-4xl grid-cols-[220px_minmax(0,1fr)] overflow-hidden border border-border bg-card shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <aside className="min-h-0 border-r border-border bg-background/45 p-3">
          <button
            aria-label="Close settings"
            className="mb-4 flex size-8 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
          <nav aria-label="Settings sections" className="grid gap-1">
            <button
              aria-current={activeSection === 'storage' ? 'page' : undefined}
              aria-label="Storage settings"
              className={`flex h-9 items-center gap-2 border px-3 text-left font-mono text-[11px] outline-none transition ${
                activeSection === 'storage'
                  ? 'border-primary/40 bg-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => setActiveSection('storage')}
              type="button"
            >
              <Database className="size-4" />
              Storage
            </button>
            <button
              aria-current={activeSection === 'machine-output' ? 'page' : undefined}
              aria-label="Machine & Output settings"
              className={`flex h-9 items-center gap-2 border px-3 text-left font-mono text-[11px] outline-none transition ${
                activeSection === 'machine-output'
                  ? 'border-primary/40 bg-accent text-foreground'
                  : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => setActiveSection('machine-output')}
              type="button"
            >
              <SlidersHorizontal className="size-4" />
              Machine &amp; Output
            </button>
          </nav>
        </aside>

        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <header className="border-b border-border p-4">
            <h2 className="font-mono text-base font-semibold">
              {activeSection === 'storage' ? 'Storage' : 'Machine & Output'}
            </h2>
          </header>

          <div className="min-h-0 overflow-auto p-4">
            {activeSection === 'storage' ? (
              <div className="grid gap-5">
                <section>
                  <h3 className="font-mono text-xs font-semibold">Connection</h3>
                  <div className="mt-3 divide-y divide-border border-y border-border font-mono text-[11px]">
                    <SettingsRow label="Status" value={statusLabel} />
                    <SettingsRow
                      label="Workbench"
                      value={connectedWorkbench?.manifest.name ?? 'Not connected'}
                    />
                    <SettingsRow
                      label="Projects"
                      value={`${connectedWorkbench?.manifest.projects.length ?? 0} projects`}
                    />
                  </div>
                  {errorMessage && (
                    <p className="mt-3 border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
                      {errorMessage}
                    </p>
                  )}
                  {storageWarningMessage && (
                    <p className="mt-3 border border-amber-500/50 bg-amber-500/10 p-2 font-mono text-[10px] text-amber-100">
                      {storageWarningMessage}
                    </p>
                  )}
                  {canConnect && (
                    <Button
                      aria-label={storageActionLabel ?? 'Choose Workbench Folder'}
                      className="mt-3"
                      onClick={onConnectWorkbench}
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw />
                      {storageActionLabel}
                    </Button>
                  )}
                  {isConnected && connectedWorkbench.adapter.kind === 'memory' && (
                    <p className="mt-3 border border-amber-500/50 bg-amber-500/10 p-2 font-mono text-[10px] text-amber-100">
                      Changes stay available only until this tab reloads.
                    </p>
                  )}
                </section>

                <section>
                  <h3 className="font-mono text-xs font-semibold">Location</h3>
                  <div className="mt-3 divide-y divide-border border-y border-border font-mono text-[11px]">
                    {locationRows.map((row) => (
                      <SettingsRow key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <MachineOutputSettingsPanel
                connectedWorkbench={connectedWorkbench}
                onSaveWorkbenchSettings={onSaveWorkbenchSettings}
                settingsErrorMessage={settingsErrorMessage}
                settingsStatus={settingsStatus}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 py-3">
      <div className="text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words text-foreground">{value}</div>
    </div>
  );
}

function getStorageStatusLabel(
  connectedWorkbench: ConnectedWorkbench | null,
  workbenchStatus: WorkbenchStatus
) {
  if (workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage') {
    return 'Connecting Workbench Folder';
  }
  if (!connectedWorkbench) return 'Storage not connected';
  if (connectedWorkbench.adapter.kind === 'memory') return 'Temporary storage only';
  if (connectedWorkbench.adapter.kind === 'directory') return 'Workbench folder connected';
  return 'Browser cache active';
}

function getStorageLocationRows(connectedWorkbench: ConnectedWorkbench | null) {
  if (!connectedWorkbench) {
    return [
      { label: 'Type', value: 'No active workbench storage' },
      { label: 'Persistence', value: 'No - connect a workbench folder to save files on disk.' },
      { label: 'Workbench folder', value: 'No chosen workbench folder is connected.' }
    ];
  }

  if (connectedWorkbench.adapter.kind === 'memory') {
    return [
      { label: 'Type', value: 'Temporary memory' },
      { label: 'Persistence', value: 'No - current tab only.' },
      { label: 'Location', value: 'This workbench has no persistent storage location.' },
      { label: 'Workbench folder', value: 'This workbench has no persistent storage location.' }
    ];
  }

  if (connectedWorkbench.adapter.kind === 'directory') {
    return [
      { label: 'Type', value: 'Chosen workbench folder' },
      { label: 'Persistence', value: 'Yes - files are written into the selected folder.' },
      { label: 'Folder name', value: connectedWorkbench.adapter.name },
      {
        label: 'Reconnect',
        value: 'The browser remembers this folder handle and can reconnect after you approve access.'
      },
      {
        label: 'Full path',
        value: 'The browser folder picker does not expose the absolute OS path to this app.'
      }
    ];
  }

  return [
    { label: 'Type', value: 'Browser cache fallback' },
    {
      label: 'Persistence',
      value: 'Yes - kept as site data until browser or site data is cleared.'
    },
    { label: 'Location', value: 'Current site cache' },
    { label: 'Site', value: browserStorageScope() },
    { label: 'Workbench keys', value: `${BROWSER_WORKBENCH_NAMESPACE}:*` },
    { label: 'Workbench folder', value: 'No chosen workbench folder is connected.' }
  ];
}

function browserStorageScope() {
  if (typeof window === 'undefined') return 'Current browser origin';
  return `${window.location.origin}${window.location.pathname}`;
}
