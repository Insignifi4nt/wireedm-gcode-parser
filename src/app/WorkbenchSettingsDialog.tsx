import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Database, RefreshCw, SlidersHorizontal, X } from 'lucide-react';

import { useModalFocus } from '@/components/ui/useModalFocus';
import { Button } from '@/components/ui/button';
import { APP_VERSION } from '@/domain/release/appRelease';
import { StorageReviewPanel } from './StorageReviewPanel';
import { WorkbenchBackupPanel } from './WorkbenchBackupPanel';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  MachinePostSettingsPanel,
  type MachinePostSettingsActions
} from './MachinePostSettingsPanel';

type WorkbenchStatus = 'initializing' | 'ready' | 'connecting-storage' | 'error';

interface WorkbenchSettingsDialogProps extends MachinePostSettingsActions {
  readonly connectedWorkbench: ConnectedWorkbenchCatalog | null;
  readonly errorMessage: string | null;
  readonly interactionLocked: boolean;
  readonly onClose: () => void;
  readonly onUseBrowserCache: () => void | Promise<void>;
  readonly onConnectWorkbench: () => void | Promise<void>;
  readonly open: boolean;
  readonly settingsErrorMessage: string | null;
  readonly settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  readonly storageSwitchDisabled: boolean;
  readonly storageActionLabel: string | null;
  readonly storageWarningMessage: string | null;
  readonly workbenchStatus: WorkbenchStatus;
}

export function WorkbenchSettingsDialog({
  connectedWorkbench,
  errorMessage,
  interactionLocked,
  onClose,
  onConnectWorkbench,
  onUseBrowserCache,
  open,
  settingsErrorMessage,
  settingsStatus,
  storageSwitchDisabled,
  storageActionLabel,
  storageWarningMessage,
  workbenchStatus,
  ...machinePostActions
}: WorkbenchSettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<'storage' | 'machine-output'>('storage');
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useModalFocus({ open, overlayRef, dialogRef, initialFocusRef: closeButtonRef, onClose });

  useEffect(() => {
    if (open) setActiveSection('storage');
  }, [open]);

  if (!open) return null;
  const connecting = workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage';
  const canConnect = Boolean(storageActionLabel) && !connecting;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" data-workbench-settings-overlay onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} ref={overlayRef}>
      <div aria-label="Workbench settings" aria-modal="true" className="grid h-[86vh] w-full max-w-4xl grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-[2px] border border-border bg-card shadow-2xl max-[720px]:grid-cols-1" onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <aside className="min-h-0 border-r border-border bg-background/45 p-3">
          <button aria-label="Close settings" className="mb-4 flex size-8 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground" onClick={onClose} ref={closeButtonRef} type="button"><X className="size-4" /></button>
          <nav aria-label="Settings sections" className="grid gap-1">
            <SectionButton active={activeSection === 'storage'} icon={<Database className="size-4" />} label="Storage" onClick={() => setActiveSection('storage')} />
            <SectionButton active={activeSection === 'machine-output'} icon={<SlidersHorizontal className="size-4" />} label="Machines & setups" onClick={() => setActiveSection('machine-output')} />
          </nav>
          <p className="mt-4 text-[11px] text-muted-foreground">Wire EDM Workbench {APP_VERSION}</p>
          <a className="mt-2 block text-[11px] underline" href={`${import.meta.env.BASE_URL}documentation/`} target="_blank" rel="noreferrer">Postprocessor documentation</a>
        </aside>
        <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          <header className="border-b border-border p-4"><h2 className="text-base font-semibold">{activeSection === 'storage' ? 'Storage' : 'Machines & setups'}</h2></header>
          <div className="work-region-scrollbar min-h-0 overflow-auto p-4">
            {activeSection === 'storage' ? (
              <div className="grid gap-5 text-[11px]">
                <section>
                  <h3 className="text-xs font-semibold">Connection</h3>
                  <div className="technical-value mt-3 divide-y divide-border border-y border-border">
                    <SettingsRow label="Status" value={storageStatus(connectedWorkbench, workbenchStatus)} />
                    <SettingsRow label="Workbench" value={connectedWorkbench?.manifest.name ?? 'Not connected'} />
                    <SettingsRow label="Projects" value={`${connectedWorkbench?.manifest.projects.length ?? 0}`} />
                  </div>
                  {errorMessage && <Message tone="error">{errorMessage}</Message>}
                  {storageWarningMessage && <Message tone="warning">{storageWarningMessage}</Message>}
                  <p className="mt-3 text-muted-foreground">Each storage location has its own project library. Switching locations does not copy projects; browser-cache projects stay in this browser.</p>
                  {(connectedWorkbench?.adapter.kind === 'directory' || !connectedWorkbench) && <Button className="mt-3 mr-2" disabled={storageSwitchDisabled || connecting} onClick={onUseBrowserCache} type="button" variant="outline">Use browser cache</Button>}
                  {canConnect && <Button className="mt-3" disabled={storageSwitchDisabled} onClick={onConnectWorkbench} type="button" variant="outline"><RefreshCw />{storageActionLabel}</Button>}
                </section>
                <section>
                  <h3 className="text-xs font-semibold">Location</h3>
                  <div className="technical-value mt-3 divide-y divide-border border-y border-border">
                    <SettingsRow label="Adapter" value={connectedWorkbench?.adapter.kind ?? 'None'} />
                    <SettingsRow label="Name" value={connectedWorkbench?.adapter.name ?? 'None'} />
                    <SettingsRow label="Persistence" value={connectedWorkbench?.adapter.kind === 'memory' ? 'Session only' : connectedWorkbench ? 'Persistent' : 'Not connected'} />
                  </div>
                </section>
                {connectedWorkbench && <StorageReviewPanel workbench={connectedWorkbench} disabled={interactionLocked || connecting} />}
                {connectedWorkbench && <WorkbenchBackupPanel workbench={connectedWorkbench} disabled={storageSwitchDisabled || connecting} />}
              </div>
            ) : connectedWorkbench ? (
              <MachinePostSettingsPanel connectedWorkbench={connectedWorkbench} interactionLocked={interactionLocked} settingsErrorMessage={settingsErrorMessage} settingsStatus={settingsStatus} {...machinePostActions} />
            ) : (
              <Message tone="error">Connect a valid workbench before managing machine packages.</Message>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SectionButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button aria-current={active ? 'page' : undefined} className={`flex h-8 items-center gap-2 whitespace-nowrap rounded-[2px] border px-3 text-left text-[10px] outline-none ${active ? 'border-primary/40 bg-accent text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50'}`} onClick={onClick} type="button">{icon}{label}</button>;
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 py-3"><div className="text-muted-foreground">{label}</div><div className="break-words text-foreground">{value}</div></div>;
}

function Message({ children, tone }: { children: ReactNode; tone: 'error' | 'warning' }) {
  return <p className={`mt-3 border p-2 font-mono text-[10px] ${tone === 'error' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-amber-500/50 bg-amber-500/10 text-amber-100'}`}>{children}</p>;
}

function storageStatus(workbench: ConnectedWorkbenchCatalog | null, status: WorkbenchStatus) {
  if (status === 'initializing' || status === 'connecting-storage') return 'Connecting';
  if (!workbench) return 'Not connected';
  if (workbench.adapter.kind === 'memory') return 'Temporary storage';
  if (workbench.adapter.kind === 'directory') return 'Workbench folder connected';
  return 'Browser cache active';
}
