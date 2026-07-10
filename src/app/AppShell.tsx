import { useState, type PointerEvent, type ReactNode } from 'react';
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
import { WorkbenchSettingsDialog } from './WorkbenchSettingsDialog';

interface AppShellProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  errorMessage: string | null;
  onConnectWorkbench: () => void | Promise<void>;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
  settingsErrorMessage: string | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  storageActionLabel: string | null;
  statusNotifications: StatusToast[];
  storageWarningMessage: string | null;
  children: ReactNode;
}

export function AppShell({
  workbenchStatus,
  connectedWorkbench,
  errorMessage,
  onConnectWorkbench,
  onSaveWorkbenchSettings,
  settingsErrorMessage,
  settingsStatus,
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
        : storageActionLabel ?? `${activeStorageLabel} active`
      : isConnectingStorage
        ? 'Connecting Workbench Folder'
        : 'Storage not connected';
  const projectCount = connectedWorkbench?.manifest.projects.length ?? 0;
  const hasRailContent = railContent !== null;
  const replaceExpandedRailChrome = Boolean(railContent?.replaceRailChrome && !sidebarCollapsed);
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
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-app-shell
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      <header
        className="flex h-9 shrink-0 items-center border-b border-border bg-[#11171b]/95 px-2"
        data-app-header
      >
        {headerContent ?? (
          <div className="mr-4 flex min-w-0 items-center gap-2 font-mono text-xs font-semibold text-foreground">
            <HardDrive className="size-4 text-primary" />
            <span className="truncate">Wire EDM Workbench</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <StatusNotificationMenu notifications={statusNotifications} />
          <span
            aria-label={storageStatusLabel}
            className={`inline-flex h-7 items-center gap-2 border px-2 font-mono text-[10px] ${
              isTemporaryStorage
                ? 'border-amber-500/50 bg-amber-500/10 text-amber-100'
                : storageActionLabel || (!connectedWorkbench && !isConnectingStorage)
                  ? 'border-destructive/60 bg-destructive/10 text-destructive'
                  : 'border-border bg-background/60 text-muted-foreground'
            }`}
          >
            <Database className="size-3.5" />
            {storageStatusLabel}
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
        style={{
          gridTemplateColumns: !hasRailContent
            ? 'minmax(0, 1fr)'
            : sidebarCollapsed
              ? '42px minmax(0, 1fr)'
              : `${sidebarWidth}px 4px minmax(0, 1fr)`
        }}
      >
        {railContent && (
          <aside
            className={`grid min-w-0 overflow-hidden ${
              replaceExpandedRailChrome
                ? 'grid-rows-[minmax(0,1fr)] bg-background p-2'
                : 'grid-rows-[auto_minmax(0,1fr)] border-r border-border bg-card/95'
            }`}
            data-app-rail
          >
            {!replaceExpandedRailChrome && (
              <div className="flex h-7 shrink-0 items-center justify-end border-b border-border px-1">
                <button
                  aria-label={sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'}
                  className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
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
            <div className="min-h-0 overflow-hidden">
              {sidebarCollapsed ? railContent.collapsed : railContent.expanded}
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
        className="flex h-7 shrink-0 items-center gap-3 overflow-hidden border-t border-border bg-[#11171b]/95 px-3 font-mono text-[10px] text-muted-foreground"
        data-app-status-bar
      >
        <span className="truncate text-foreground">{activeStorageLabel}</span>
        <span aria-hidden="true">•</span>
        <span className="truncate">
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
        onClose={() => setSettingsOpen(false)}
        onConnectWorkbench={onConnectWorkbench}
        onSaveWorkbenchSettings={onSaveWorkbenchSettings}
        open={settingsOpen}
        settingsErrorMessage={settingsErrorMessage}
        settingsStatus={settingsStatus}
        storageActionLabel={storageActionLabel}
        storageWarningMessage={storageWarningMessage}
        workbenchStatus={workbenchStatus}
      />
    </div>
  );
}
