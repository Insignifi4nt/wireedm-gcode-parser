import { useState, type PointerEvent, type ReactNode } from 'react';
import {
  Database,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { AppRailProvider, type AppRailContent } from './AppRailContext';
import { WorkbenchSettingsDialog } from './WorkbenchSettingsDialog';

interface AppShellProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  errorMessage: string | null;
  onConnectWorkbench: () => void | Promise<void>;
  storageActionLabel: string | null;
  storageWarningMessage: string | null;
  children: ReactNode;
}

export function AppShell({
  workbenchStatus,
  connectedWorkbench,
  errorMessage,
  onConnectWorkbench,
  storageActionLabel,
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
  const activeStorageLabel =
    connectedWorkbench?.adapter.kind === 'directory'
      ? 'Workbench folder'
      : connectedWorkbench?.adapter.kind === 'browser-cache'
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
  const replaceExpandedRailChrome = Boolean(railContent?.replaceRailChrome && !sidebarCollapsed);

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
          gridTemplateColumns: sidebarCollapsed ? '42px minmax(0, 1fr)' : `${sidebarWidth}px 4px minmax(0, 1fr)`
        }}
      >
        <aside
          className={`grid min-w-0 overflow-hidden border-r border-border bg-card/95 ${
            replaceExpandedRailChrome ? 'grid-rows-[minmax(0,1fr)]' : 'grid-rows-[auto_minmax(0,1fr)]'
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
          <div className={`min-h-0 overflow-hidden ${replaceExpandedRailChrome ? 'p-2' : ''}`}>
            {sidebarCollapsed ? (
              railContent?.collapsed ?? (
                <div className="flex h-full flex-col items-center gap-3 py-3">
                  <Database className="size-4 text-primary" />
                  <div
                    className="rotate-180 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]"
                    title={
                      isReady
                        ? `${projectCount} project${projectCount === 1 ? '' : 's'}`
                        : 'Preparing local storage'
                    }
                  >
                    {isReady
                      ? `${projectCount} ${projectCount === 1 ? 'project' : 'projects'}`
                      : 'storage'}
                  </div>
                </div>
              )
            ) : (
              railContent?.expanded ?? (
                <div className="p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase text-muted-foreground">Local Storage</p>
                      <h1 className="mt-1 font-mono text-sm font-semibold">Workbench</h1>
                    </div>
                    <Database className="size-4 text-primary" />
                  </div>

                  <div className="border border-border bg-background/50 p-2 font-mono text-[11px]">
                    {isReady ? (
                      <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-y-2">
                        <dt className="text-muted-foreground">Storage</dt>
                        <dd className="truncate text-foreground">{activeStorageLabel}</dd>
                        <dt className="text-muted-foreground">Name</dt>
                        <dd className="truncate text-foreground">{connectedWorkbench.manifest.name}</dd>
                        <dt className="text-muted-foreground">Projects</dt>
                        <dd>
                          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
                        </dd>
                        <dt className="text-muted-foreground">Output</dt>
                        <dd>.{connectedWorkbench.manifest.output.extension}</dd>
                      </dl>
                    ) : (
                      <p className="text-muted-foreground">
                        Preparing the local storage workbench.
                      </p>
                    )}
                    {isTemporaryStorage && (
                      <p className="mt-3 border-t border-border pt-2 text-amber-100">
                        Changes stay available only until this tab reloads.
                      </p>
                    )}
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

                  <div className="mt-5 border-t border-border pt-3 font-mono text-[10px] text-muted-foreground">
                    <p>Cache-first projects</p>
                    <p className="mt-1">Machine-profile export</p>
                    <p className="mt-1">No feeds in export defaults</p>
                  </div>
                </div>
              )
            )}
          </div>
        </aside>
        {!sidebarCollapsed && (
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
      <WorkbenchSettingsDialog
        connectedWorkbench={connectedWorkbench}
        errorMessage={errorMessage}
        onClose={() => setSettingsOpen(false)}
        onConnectWorkbench={onConnectWorkbench}
        open={settingsOpen}
        storageActionLabel={storageActionLabel}
        storageWarningMessage={storageWarningMessage}
        workbenchStatus={workbenchStatus}
      />
    </div>
  );
}
