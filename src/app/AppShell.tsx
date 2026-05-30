import { useState, type ReactNode } from 'react';
import { Database, HardDrive, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

interface AppShellProps {
  workbenchStatus: 'initializing' | 'ready' | 'switching-folder' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  directoryAccessAvailable: boolean;
  errorMessage: string | null;
  children: ReactNode;
}

export function AppShell({
  workbenchStatus,
  connectedWorkbench,
  directoryAccessAvailable,
  errorMessage,
  children
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isReady = workbenchStatus === 'ready' && connectedWorkbench;
  const activeStorageLabel =
    connectedWorkbench?.adapter.kind === 'directory'
      ? 'Directory'
      : connectedWorkbench?.adapter.kind === 'browser-cache'
        ? 'Browser cache'
        : 'Memory';
  const projectCount = connectedWorkbench?.manifest.projects.length ?? 0;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      data-app-shell
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      <header className="flex h-9 shrink-0 items-center border-b border-border bg-[#11171b]/95 px-2">
        <button
          aria-label={sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'}
          className="mr-2 flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
          onClick={() => setSidebarCollapsed((current) => !current)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          type="button"
        >
          {sidebarCollapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}
        </button>
        <div className="mr-4 flex min-w-0 items-center gap-2 font-mono text-xs font-semibold text-foreground">
          <HardDrive className="size-4 text-primary" />
          <span className="truncate">Wire EDM Workbench</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {directoryAccessAvailable ? 'Folder picker available' : 'Folder picker unavailable'}
          </span>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 transition-[grid-template-columns] ${
          sidebarCollapsed ? 'grid-cols-[42px_minmax(0,1fr)]' : 'grid-cols-[220px_minmax(0,1fr)]'
        }`}
      >
        <aside className="min-w-0 overflow-hidden border-r border-border bg-card/95">
          {sidebarCollapsed ? (
            <div className="flex h-full flex-col items-center gap-3 py-3">
              <Database className="size-4 text-primary" />
              <div
                className="rotate-180 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground [writing-mode:vertical-rl]"
                title={isReady ? `${projectCount} project${projectCount === 1 ? '' : 's'}` : 'Preparing cache'}
              >
                {isReady ? `${projectCount} ${projectCount === 1 ? 'project' : 'projects'}` : 'cache'}
              </div>
            </div>
          ) : (
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
                    Preparing the browser cache workbench. Folder access is optional.
                  </p>
                )}
              </div>

              {errorMessage && (
                <p className="mt-3 border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
                  {errorMessage}
                </p>
              )}

              <div className="mt-5 border-t border-border pt-3 font-mono text-[10px] text-muted-foreground">
                <p>Cache-first projects</p>
                <p className="mt-1">Header / body / footer output</p>
                <p className="mt-1">No feeds in generated defaults</p>
              </div>
            </div>
          )}
        </aside>

        <main className="min-h-0 min-w-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
