import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode
} from 'react';
import {
  Database,
  HardDrive,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon
} from 'lucide-react';

import { StatusNotificationMenu, type StatusToast } from '@/components/StatusToasts';
import { Button } from '@/components/ui/button';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { AppRailProvider, type AppRailContent, type EditorCompactDrawer } from './AppRailContext';
import type { MachinePostSettingsActions } from './MachinePostSettingsPanel';
import { WorkbenchSettingsDialog } from './WorkbenchSettingsDialog';
import { EditorCompactDrawerLaunchers } from '@/features/editor/EditorWorkspacePanels';

interface AppShellProps extends MachinePostSettingsActions {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbenchCatalog | null;
  errorMessage: string | null;
  interactionLocked: boolean;
  onUseBrowserCache: () => void | Promise<void>;
  onConnectWorkbench: () => void | Promise<void>;
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
  onUseBrowserCache,
  onActivateMachineSetup,
  onCommitMachinePackage,
  onPrepareMachinePackage,
  onRemoveMachineDefinition,
  onSaveCatalogPreferences,
  settingsErrorMessage,
  settingsStatus,
  storageSwitchDisabled,
  storageActionLabel,
  statusNotifications,
  storageWarningMessage,
  children
}: AppShellProps) {
  const [headerContent, setHeaderContent] = useState<ReactNode | null>(null);
  const [shellRailCollapsed, setShellRailCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [railContent, setRailContent] = useState<AppRailContent | null>(null);
  const [compactDrawer, setCompactDrawer] = useState<EditorCompactDrawer>(null);
  const [compactModalHost, setCompactModalHost] = useState<HTMLDivElement | null>(null);
  const [compactTransitionOverlay, setCompactTransitionOverlay] = useState(false);
  const compactDrawerRef = useRef(compactDrawer);
  compactDrawerRef.current = compactDrawer;
  const restoreRailFocusAfterDrawerCloseRef = useRef(false);
  const [isCompactViewport, setIsCompactViewport] = useState(() => window.innerWidth < 768);
  const [isMiddleViewport, setIsMiddleViewport] = useState(
    () => window.innerWidth >= 768 && window.innerWidth < 1024
  );
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
  const hasRailContent = railContent !== null;
  const replaceRailChrome = Boolean(railContent?.replaceRailChrome);
  const requestedSidebarCollapsed = railContent?.isCollapsed ?? shellRailCollapsed;
  const sidebarCollapsed = Boolean(
    requestedSidebarCollapsed || (isMiddleViewport && railContent?.isPathProject)
  );
  const railWidth = railContent?.sizing?.width ?? sidebarWidth;
  const compactModalOpen = compactDrawer !== null;
  const closeCompactDrawerWithRailFocus = useCallback(() => {
    restoreRailFocusAfterDrawerCloseRef.current = true;
    setCompactDrawer(null);
  }, []);

  useEffect(() => {
    if (!window.matchMedia) {
      const updateCompactViewport = () => {
        const compact = window.innerWidth < 768;
        const middle = window.innerWidth >= 768 && window.innerWidth < 1024;
        if (!compact && !middle && compactDrawerRef.current === 'upid') {
          restoreRailFocusAfterDrawerCloseRef.current = true;
        }
        setIsCompactViewport(compact);
        setIsMiddleViewport(middle);
        setCompactDrawer((current) => {
          if (!compact && !middle) return null;
          if (middle && current === 'workflow') return null;
          return current;
        });
      };
      window.addEventListener('resize', updateCompactViewport);
      return () => window.removeEventListener('resize', updateCompactViewport);
    }
    const media = window.matchMedia('(max-width: 767px)');
    const middleMedia = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
    const updateCompactViewport = () => {
      if (!media.matches && !middleMedia.matches && compactDrawerRef.current === 'upid') {
        restoreRailFocusAfterDrawerCloseRef.current = true;
      }
      setIsCompactViewport(media.matches);
      setIsMiddleViewport(middleMedia.matches);
      setCompactDrawer((current) => {
        if (!media.matches && !middleMedia.matches) return null;
        if (middleMedia.matches && current === 'workflow') return null;
        return current;
      });
    };
    updateCompactViewport();
    media.addEventListener('change', updateCompactViewport);
    middleMedia.addEventListener('change', updateCompactViewport);
    return () => {
      media.removeEventListener('change', updateCompactViewport);
      middleMedia.removeEventListener('change', updateCompactViewport);
    };
  }, []);

  useEffect(() => {
    if (compactDrawer !== null || !restoreRailFocusAfterDrawerCloseRef.current) return;
    restoreRailFocusAfterDrawerCloseRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const candidates = [
        document.querySelector<HTMLElement>(
          '[data-app-rail-expanded-content] [role="tab"][aria-selected="true"]'
        ),
        document.querySelector<HTMLElement>(
          '[data-app-rail-collapsed-content] [aria-label="Expand UPID rail"]'
        ),
        document.querySelector<HTMLElement>(
          '[data-editor-compact-drawer-launchers] [aria-label="Open UPID rail"]'
        )
      ];
      candidates
        .find((candidate) => candidate && candidate.getClientRects().length > 0)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [compactDrawer, sidebarCollapsed]);

  useEffect(() => {
    if (!railContent || !railContent.isPathProject) {
      setCompactDrawer(null);
      setCompactTransitionOverlay(false);
    }
  }, [railContent]);

  function handleSidebarResizeStart(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const sizing = railContent?.sizing;
    const startWidth = sizing?.width ?? sidebarWidth;

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const nextWidth = Math.min(
        sizing?.maxWidth ?? 380,
        Math.max(sizing?.minWidth ?? 160, startWidth + moveEvent.clientX - startX)
      );
      if (sizing) sizing.onWidthChange(nextWidth);
      else setSidebarWidth(nextWidth);
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
      className="technical-workbench flex h-dvh flex-col overflow-hidden bg-background text-foreground"
      data-app-shell
      data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      <header
        aria-hidden={compactModalOpen ? true : undefined}
        className="flex h-10 shrink-0 items-center border-b border-border bg-[#11171b] px-2"
        data-app-header
        inert={compactModalOpen ? true : undefined}
      >
        {headerContent ?? (
          <div className="mr-4 flex min-w-0 items-center gap-2 text-xs font-semibold text-foreground">
            <HardDrive className="size-4 text-primary" />
            <span className="truncate">Wire EDM Workbench</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2" data-app-header-system-controls>
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
            data-storage-status
            role="status"
            title={connectedWorkbench?.adapter.persistenceWarning ?? storageStatusLabel}
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
        aria-hidden={compactModalOpen ? true : undefined}
        className="grid min-h-0 flex-1 transition-[grid-template-columns]"
        data-app-workspace-grid
        data-has-rail={hasRailContent ? 'true' : 'false'}
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : 'false'}
        inert={compactModalOpen ? true : undefined}
        style={
          {
            '--app-rail-width': `${railWidth}px`,
            gridTemplateColumns: hasRailContent ? undefined : 'minmax(0, 1fr)'
          } as CSSProperties
        }
      >
        {railContent && (
          <aside
            aria-hidden={isCompactViewport ? true : undefined}
            className={`grid min-w-0 overflow-hidden ${
              replaceRailChrome
                ? 'grid-rows-[minmax(0,1fr)] bg-background pb-8 pt-2'
                : 'grid-rows-[auto_minmax(0,1fr)] border-r border-border bg-card/95'
            }`}
            data-app-rail
            inert={isCompactViewport ? true : undefined}
          >
            {!replaceRailChrome && (
              <div className="flex h-7 shrink-0 items-center justify-end border-b border-border px-1">
                <button
                  aria-label={sidebarCollapsed ? 'Expand workbench sidebar' : 'Collapse workbench sidebar'}
                  className="flex size-7 items-center justify-center rounded-[2px] border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    const nextCollapsed = !sidebarCollapsed;
                    if (railContent.onCollapsedChange) {
                      railContent.onCollapsedChange(nextCollapsed);
                    } else {
                      setShellRailCollapsed(nextCollapsed);
                    }
                  }}
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

        <AppRailProvider value={{ closeCompactDrawerWithRailFocus, compactDrawer, compactModalHost, compactTransitionOverlay, isCompactViewport, isMiddleViewport, setCompactDrawer, setCompactTransitionOverlay, setHeaderContent, setRailCollapsed: setShellRailCollapsed, setRailContent }}>
          <main
            className="min-h-0 min-w-0 overflow-hidden"
          >
            {children}
          </main>
          <EditorCompactDrawerLaunchers
            drawer={compactDrawer}
            hasActiveWorkflow={Boolean(railContent?.hasActiveWorkflow)}
            hasUpidRail={Boolean(railContent?.isPathProject)}
            modalHost={compactModalHost}
            onDrawerChange={setCompactDrawer}
            transitionOverlay={compactTransitionOverlay}
            upidContent={railContent?.expanded ?? null}
          />
        </AppRailProvider>
      </div>
      <WorkbenchSettingsDialog
        connectedWorkbench={connectedWorkbench}
        errorMessage={errorMessage}
        interactionLocked={interactionLocked}
        onClose={() => setSettingsOpen(false)}
        onConnectWorkbench={onConnectWorkbench}
        onUseBrowserCache={onUseBrowserCache}
        onActivateMachineSetup={onActivateMachineSetup}
        onCommitMachinePackage={onCommitMachinePackage}
        onPrepareMachinePackage={onPrepareMachinePackage}
        onRemoveMachineDefinition={onRemoveMachineDefinition}
        onSaveCatalogPreferences={onSaveCatalogPreferences}
        open={settingsOpen}
        settingsErrorMessage={settingsErrorMessage}
        settingsStatus={settingsStatus}
        storageSwitchDisabled={storageSwitchDisabled}
        storageActionLabel={storageActionLabel}
        storageWarningMessage={storageWarningMessage}
        workbenchStatus={workbenchStatus}
      />
      <div data-editor-compact-modal-host ref={setCompactModalHost} />
    </div>
  );
}
