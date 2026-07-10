import { useEffect, useRef, useState } from 'react';
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
  interactionLocked: boolean;
  onClose: () => void;
  onConnectWorkbench: () => void | Promise<void>;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
  open: boolean;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  storageSwitchDisabled: boolean;
  storageActionLabel: string | null;
  storageWarningMessage: string | null;
  workbenchStatus: WorkbenchStatus;
}

export function WorkbenchSettingsDialog({
  connectedWorkbench,
  errorMessage,
  interactionLocked,
  onClose,
  onConnectWorkbench,
  onSaveWorkbenchSettings,
  open,
  settingsErrorMessage,
  settingsStatus,
  storageSwitchDisabled,
  storageActionLabel,
  storageWarningMessage,
  workbenchStatus
}: WorkbenchSettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<'storage' | 'machine-output'>('storage');
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const latestCloseRef = useRef(onClose);
  const openerRef = useRef<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  latestCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    if (!overlayRef.current || !dialogRef.current) return;
    const overlay: HTMLDivElement = overlayRef.current;
    const dialog: HTMLDivElement = dialogRef.current;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblingSnapshots = [...(overlay.parentElement?.children ?? [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => ({
        ariaHidden: element.getAttribute('aria-hidden'),
        element,
        inertAttribute: element.getAttribute('inert'),
        inertProperty: element.inert
      }));

    for (const snapshot of siblingSnapshots) {
      snapshot.element.inert = true;
      snapshot.element.setAttribute('inert', '');
      snapshot.element.setAttribute('aria-hidden', 'true');
    }

    (closeButtonRef.current ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        latestCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = readDialogFocusableElements(dialog);
      const first = focusableElements[0] ?? dialog;
      const last = focusableElements.at(-1) ?? dialog;
      const activeElement = document.activeElement;
      const focusIsOutside = !(activeElement instanceof Node) || !dialog.contains(activeElement);

      if (focusIsOutside || (!event.shiftKey && activeElement === last)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      for (const snapshot of siblingSnapshots) {
        snapshot.element.inert = snapshot.inertProperty;
        if (snapshot.inertAttribute === null) snapshot.element.removeAttribute('inert');
        else snapshot.element.setAttribute('inert', snapshot.inertAttribute);
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden');
        else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden);
      }
      openerRef.current?.focus();
      openerRef.current = null;
    };
  }, [open]);

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
      ref={overlayRef}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div
        aria-label="Workbench settings"
        aria-modal="true"
        className="grid max-h-[86vh] w-full max-w-4xl grid-cols-[200px_minmax(0,1fr)] overflow-hidden rounded-[2px] border border-border bg-card shadow-2xl max-[720px]:grid-cols-1"
        onMouseDown={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <aside className="min-h-0 border-r border-border bg-background/45 p-3">
          <button
            aria-label="Close settings"
            className="mb-4 flex size-8 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X className="size-4" />
          </button>
          <nav aria-label="Settings sections" className="grid gap-1">
            <button
              aria-current={activeSection === 'storage' ? 'page' : undefined}
              aria-label="Storage settings"
              className={`flex h-8 items-center gap-2 rounded-[2px] border px-3 text-left text-[11px] outline-none transition ${
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
              className={`flex h-8 items-center gap-2 rounded-[2px] border px-3 text-left text-[11px] outline-none transition ${
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
            <h2 className="text-base font-semibold">
              {activeSection === 'storage' ? 'Storage' : 'Machine & Output'}
            </h2>
          </header>

          <div className="work-region-scrollbar min-h-0 overflow-auto p-4">
            {activeSection === 'storage' ? (
              <div className="grid gap-5">
                <section>
                  <h3 className="text-xs font-semibold">Connection</h3>
                  <div className="technical-value mt-3 divide-y divide-border border-y border-border text-[11px]">
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
                      disabled={storageSwitchDisabled}
                      onClick={onConnectWorkbench}
                      title={
                        storageSwitchDisabled
                          ? 'Return to Workbench before switching storage'
                          : storageActionLabel ?? undefined
                      }
                      type="button"
                      variant="outline"
                    >
                      <RefreshCw />
                      {storageActionLabel}
                    </Button>
                  )}
                  {canConnect && storageSwitchDisabled && (
                    <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                      Return to Workbench before switching storage so the open document stays bound
                      to its current workbench.
                    </p>
                  )}
                  {isConnected && connectedWorkbench.adapter.kind === 'memory' && (
                    <p className="mt-3 border border-amber-500/50 bg-amber-500/10 p-2 font-mono text-[10px] text-amber-100">
                      Changes stay available only until this tab reloads.
                    </p>
                  )}
                </section>

                <section>
                  <h3 className="text-xs font-semibold">Location</h3>
                  <div className="technical-value mt-3 divide-y divide-border border-y border-border text-[11px]">
                    {locationRows.map((row) => (
                      <SettingsRow key={row.label} label={row.label} value={row.value} />
                    ))}
                  </div>
                </section>
              </div>
            ) : (
              <MachineOutputSettingsPanel
                connectedWorkbench={connectedWorkbench}
                interactionLocked={interactionLocked}
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
      <div className="min-w-0 break-words text-foreground" title={value}>{value}</div>
    </div>
  );
}

function readDialogFocusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'
  )].filter(
    (element) =>
      !element.closest('[hidden], [aria-hidden="true"], [inert]') &&
      element.getAttribute('aria-disabled') !== 'true'
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
