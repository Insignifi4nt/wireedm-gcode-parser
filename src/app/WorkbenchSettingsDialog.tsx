import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Database, RefreshCw, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
  const latestCloseRef = useRef(onClose);
  const openerRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  latestCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !overlayRef.current || !dialogRef.current) return;
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = [...(overlay.parentElement?.children ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => ({
        ariaHidden: element.getAttribute('aria-hidden'),
        element,
        inertAttribute: element.getAttribute('inert'),
        inertProperty: element.inert
      }));
    for (const sibling of siblings) {
      sibling.element.inert = true;
      sibling.element.setAttribute('inert', '');
      sibling.element.setAttribute('aria-hidden', 'true');
    }
    (closeButtonRef.current ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        latestCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = readDialogFocusableElements(dialog);
      const first = focusable[0] ?? dialog;
      const last = focusable.at(-1) ?? dialog;
      const active = document.activeElement;
      if (!(active instanceof Node) || !dialog.contains(active) || (!event.shiftKey && active === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      for (const sibling of siblings) {
        sibling.element.inert = sibling.inertProperty;
        restoreAttribute(sibling.element, 'inert', sibling.inertAttribute);
        restoreAttribute(sibling.element, 'aria-hidden', sibling.ariaHidden);
      }
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (open) setActiveSection('storage');
  }, [open]);

  if (!open) return null;
  const connecting = workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage';
  const canConnect = Boolean(storageActionLabel) && !connecting;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" data-workbench-settings-overlay onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} ref={overlayRef}>
      <div aria-label="Workbench settings" aria-modal="true" className="grid h-[86vh] w-full max-w-4xl grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-[2px] border border-border bg-card shadow-2xl max-[720px]:grid-cols-1" onMouseDown={(event) => event.stopPropagation()} ref={dialogRef} role="dialog" tabIndex={-1}>
        <aside className="min-h-0 border-r border-border bg-background/45 p-3">
          <button aria-label="Close settings" className="mb-4 flex size-8 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent hover:text-foreground" onClick={onClose} ref={closeButtonRef} type="button"><X className="size-4" /></button>
          <nav aria-label="Settings sections" className="grid gap-1">
            <SectionButton active={activeSection === 'storage'} icon={<Database className="size-4" />} label="Storage" onClick={() => setActiveSection('storage')} />
            <SectionButton active={activeSection === 'machine-output'} icon={<SlidersHorizontal className="size-4" />} label="Machines & setups" onClick={() => setActiveSection('machine-output')} />
          </nav>
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
  return <button aria-current={active ? 'page' : undefined} className={`flex h-8 items-center gap-2 rounded-[2px] border px-3 text-left text-[10px] outline-none ${active ? 'border-primary/40 bg-accent text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:bg-accent/50'}`} onClick={onClick} type="button">{icon}{label}</button>;
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4 py-3"><div className="text-muted-foreground">{label}</div><div className="break-words text-foreground">{value}</div></div>;
}

function Message({ children, tone }: { children: ReactNode; tone: 'error' | 'warning' }) {
  return <p className={`mt-3 border p-2 font-mono text-[10px] ${tone === 'error' ? 'border-destructive bg-destructive/10 text-destructive' : 'border-amber-500/50 bg-amber-500/10 text-amber-100'}`}>{children}</p>;
}

function readDialogFocusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.closest('[hidden], [aria-hidden="true"], [inert]'));
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function storageStatus(workbench: ConnectedWorkbenchCatalog | null, status: WorkbenchStatus) {
  if (status === 'initializing' || status === 'connecting-storage') return 'Connecting';
  if (!workbench) return 'Not connected';
  if (workbench.adapter.kind === 'memory') return 'Temporary storage';
  if (workbench.adapter.kind === 'directory') return 'Workbench folder connected';
  return 'Browser cache active';
}
