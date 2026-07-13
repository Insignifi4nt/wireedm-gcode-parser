import { useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import {
  Database,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon
} from 'lucide-react';

import { StatusNotificationMenu, type StatusToast } from '@/components/StatusToasts';
import { Button } from '@/components/ui/button';
import { normalizeOutputExtension } from '@/domain/post/gcodeTemplates';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { AppRailProvider, type AppRailContent } from './AppRailContext';
import type { MachineProfileSettingsActions } from './MachineOutputSettingsPanel';
import { WorkbenchSettingsDialog } from './WorkbenchSettingsDialog';

interface AppShellProps extends MachineProfileSettingsActions {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  errorMessage: string | null;
  interactionLocked: boolean;
  onConnectWorkbench: () => void | Promise<void>;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  storageSwitchDisabled: boolean;
  storageActionLabel: string | null;
  statusNotifications: StatusToast[];
  storageWarningMessage: string | null;
  children: ReactNode;
}

export function AppShell({
  workbenchStatus,
  connectedWorkbench,
  errorMessage,
  interactionLocked,
  onConnectWorkbench,
  onAcknowledgeMachineProfile,
  onCreateBlankMachineProfile,
  onDeleteMachineProfile,
  onDuplicateMachineProfile,
  onExportMachineProfile,
  onImportMachineProfileFile,
  onSaveMachineProfile,
  onSaveWorkbenchSettings,
  onSetDefaultMachineProfile,
  settingsErrorMessage,
  settingsStatus,
  storageSwitchDisabled,
  storageActionLabel,
  statusNotifications,
  storageWarningMessage,
  children
}: AppShellProps) {
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [railContent, setRailContent] = useState<AppRailContent | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isReady = workbenchStatus === 'ready' && connectedWorkbench;
  const isConnectingStorage =
    workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage';
  const isTemporaryStorage = isReady && connectedWorkbench.adapter.kind === 'memory';
  const activeStorageLabel = !connectedWorkbench
    ? isConnectingStorage
      ? 'Preparing storage'
      : 'No storage'
    : connectedWorkbench.adapter.kind === 'directory'
      ? 'Workbench folder'
      : connectedWorkbench.adapter.kind === 'browser-cache'
        ? 'Browser cache'
        : 'Temporary storage';
  const storageStatusLabel = isTemporaryStorage
    ? 'Temporary storage only'
    : isReady
      ? connectedWorkbench.adapter.kind === 'directory'
        ? 'Workbench folder connected'
        : `${activeStorageLabel} active`
      : isConnectingStorage
        ? 'Connecting Workbench Folder'
        : 'Storage not connected';
  const storageStatusTone = isTemporaryStorage
    ? 'temporary'
    : workbenchStatus === 'error' || (!connectedWorkbench && !isConnectingStorage)
      ? 'error'
      : 'neutral';
  const projectCount = connectedWorkbench?.manifest.projects.length ?? 0;
  const hasRailContent = railContent !== null;
  const replaceRailChrome = Boolean(railContent?.replaceRailChrome);
  const outputExtension = connectedWorkbench
    ? `.${normalizeOutputExtension(
        connectedWorkbench.manifest.output.extension,
        connectedWorkbench.manifest.output.customExtension
      )}`
    : 'No output';
  const lineEnding = connectedWorkbench?.manifest.output.lineEnding.toUpperCase() ?? 'No line ending';

  function handleSidebarResizeStart(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = Math.min(380, Math.max(160, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(nextWidth);
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  }

  return (
    <div
      className="technical-workbench flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-app-shell
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      <header
        className="flex h-10 shrink-0 items-center border-b border-border bg-[#11171b] px-2"
        data-app-header
      >
        {headerContent ?? (
          <div className="mr-4 flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
            <HardDrive className="size-4 text-primary" />
            <span className="truncate">Wire EDM Workbench</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <StatusNotificationMenu notifications={statusNotifications} />
          <span
            aria-label={storageStatusLabel}
            className={`inline-flex h-7 items-center gap-2 rounded-[2px] border px-2 text-[10px] ${
              storageStatusTone === 'temporary'
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-100'
                : storageStatusTone === 'error'
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : 'border-border bg-background/60 text-muted-foreground'
            }`}
            title={storageStatusLabel}
          >
            <Database className="size-3.5" />
            <span data-storage-status-label>{storageStatusLabel}</span>
          </span>
          <Button
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
            size="icon"
            title="Settings"
            type="button"
            variant="outline"
          >
            <SettingsIcon />
          </Button>
        </div>
      </header>

      <div
        className="grid min-h-0 flex-1 transition-[grid-template-columns]"
        data-app-workspace-grid
        data-has-rail={hasRailContent ? 'true' : 'false'}
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
        style={
          {
            '--app-rail-width': `${sidebarWidth}px`,
            gridTemplateColumns: hasRailContent ? undefined : 'minmax(0, 1fr)'
          } as CSSProperties
        }
      >
        {railContent && (
          <aside
            className={`grid min-w-0 overflow-hidden ${
              replaceRailChrome
                ? 'grid-rows-[minmax(0,1fr)] bg-background pb-8 pt-2'
                : 'grid-rows-[auto_minmax(0,1fr)] border-r border-border bg-card/95'
            }`}
            data-app-rail
          >
            {!replaceRailChrome && (
              <div className="flex h-7 shrink-0 items-center justify-end border-b border-border px-1">
                <button
                  aria-label={sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'}
                  className="flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setSidebarCollapsed((current) => !current)}
                  title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  type="button"
                >
                  {sidebarCollapsed ? (
                    <PanelLeftOpen className="size-3.5" />
                  ) : (
                    <PanelLeftClose className="size-3.5" />
                  )}
                </button>
              </div>
            )}
            <div
              aria-hidden={sidebarCollapsed ? undefined : true}
              className={`min-h-0 overflow-hidden ${sidebarCollapsed ? '' : 'hidden'}`}
              data-app-rail-collapsed-content
              inert={sidebarCollapsed ? undefined : true}
            >
              {railContent.collapsed}
            </div>
            <div
              aria-hidden={sidebarCollapsed ? true : undefined}
              className={`min-h-0 overflow-hidden ${sidebarCollapsed ? 'hidden' : ''}`}
              data-app-rail-expanded-content
              inert={sidebarCollapsed ? true : undefined}
            >
              {railContent.expanded}
            </div>
          </aside>
        )}
        {railContent && !sidebarCollapsed && (
          <div
            aria-label="Resize project rail"
            className="cursor-col-resize border-r border-border bg-border/30 transition hover:bg-primary/40"
            data-app-rail-resizer
            onPointerDown={handleSidebarResizeStart}
            role="separator"
          />
        )}

        <AppRailProvider value={{ setHeaderContent, setRailCollapsed: setSidebarCollapsed, setRailContent }}>
          <main className="min-h-0 min-w-0 overflow-hidden">{children}</main>
        </AppRailProvider>
      </div>
      <footer
        aria-label="Application status"
        className="technical-value flex h-6 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-[#11171b] px-3 text-[10px] text-muted-foreground"
        data-app-status-bar
      >
        <span className="truncate text-foreground" title={activeStorageLabel}>
          {activeStorageLabel}
        </span>
        <span aria-hidden="true">•</span>
        <span
          className="truncate"
          title={connectedWorkbench?.activeMachineProfile.name ?? 'No machine profile'}
        >
          {connectedWorkbench?.activeMachineProfile.name ?? 'No machine profile'}
        </span>
        <span aria-hidden="true">•</span>
        <span>{outputExtension}</span>
        <span aria-hidden="true">•</span>
        <span>{lineEnding}</span>
        <span aria-hidden="true">•</span>
        <span>
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </span>
      </footer>
      <WorkbenchSettingsDialog
        connectedWorkbench={connectedWorkbench}
        errorMessage={errorMessage}
        interactionLocked={interactionLocked}
        onAcknowledgeMachineProfile={onAcknowledgeMachineProfile}
        onClose={() => setSettingsOpen(false)}
        onConnectWorkbench={onConnectWorkbench}
        onCreateBlankMachineProfile={onCreateBlankMachineProfile}
        onDeleteMachineProfile={onDeleteMachineProfile}
        onDuplicateMachineProfile={onDuplicateMachineProfile}
        onExportMachineProfile={onExportMachineProfile}
        onImportMachineProfileFile={onImportMachineProfileFile}
        onSaveMachineProfile={onSaveMachineProfile}
        onSaveWorkbenchSettings={onSaveWorkbenchSettings}
        onSetDefaultMachineProfile={onSetDefaultMachineProfile}
        open={settingsOpen}
        settingsErrorMessage={settingsErrorMessage}
        settingsStatus={settingsStatus}
        storageSwitchDisabled={storageSwitchDisabled}
        storageActionLabel={storageActionLabel}
        storageWarningMessage={storageWarningMessage}
        workbenchStatus={workbenchStatus}
      />
    </div>
  );
}
