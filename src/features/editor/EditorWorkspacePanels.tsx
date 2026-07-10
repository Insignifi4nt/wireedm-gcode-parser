import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import {
  Eye,
  EyeOff,
  ListOrdered,
  ListTree,
  MousePointer2,
  Move,
  PanelsTopLeft,
  Ruler,
  Search,
  Settings2,
  TriangleAlert,
  X
} from 'lucide-react';

export type EditorDockSide = 'left' | 'right';
export type EditorPanelPlacement = 'floating' | 'hidden' | `docked-${EditorDockSide}`;

export interface EditorFloatingPanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorFloatingPanelViewport {
  height: number;
  left: number;
  top: number;
  width: number;
}

export const EDITOR_FLOATING_PANEL_GAP = 8;
export const EDITOR_FLOATING_PANEL_TOP = 42;

export function clampEditorFloatingPanelGeometry(
  geometry: EditorFloatingPanelGeometry,
  viewport: EditorFloatingPanelViewport
): EditorFloatingPanelGeometry {
  const maxWidth = Math.max(
    260,
    viewport.width - viewport.left - EDITOR_FLOATING_PANEL_GAP
  );
  const width = Math.min(Math.max(260, geometry.width), maxWidth);
  const maxHeight = Math.max(
    180,
    viewport.height - viewport.top - EDITOR_FLOATING_PANEL_GAP
  );
  const height = Math.min(Math.max(180, geometry.height), maxHeight);
  const maxX = Math.max(
    viewport.left,
    viewport.width - width - EDITOR_FLOATING_PANEL_GAP
  );
  const maxY = Math.max(
    viewport.top,
    viewport.height - height - EDITOR_FLOATING_PANEL_GAP
  );
  const x = Math.min(Math.max(viewport.left, geometry.x), maxX);
  const y = Math.min(Math.max(viewport.top, geometry.y), maxY);

  if (
    x === geometry.x &&
    y === geometry.y &&
    width === geometry.width &&
    height === geometry.height
  ) {
    return geometry;
  }

  return { height, width, x, y };
}

export interface EditorWorkspacePanelController {
  dockOrder?: number;
  geometry: EditorFloatingPanelGeometry;
  placement: EditorPanelPlacement;
  onDock: (side: EditorDockSide) => void;
  onDragEnd: (point: { x: number; y: number }) => void;
  onFloat: () => void;
  onFloatFromDock: (point: { x: number; y: number }) => void;
  onGeometryChange: (geometry: EditorFloatingPanelGeometry) => void;
  onHide: () => void;
}

interface EditorPanelMenuItem {
  description?: string;
  id: string;
  title: string;
  placement: EditorPanelPlacement;
  onHide: () => void;
  onShow: () => void;
}

interface EditorPanelMenuGroup {
  id: string;
  title: string;
  panels: EditorPanelMenuItem[];
}

interface EditorPanelToolbarProps {
  groups: EditorPanelMenuGroup[];
}

const EDITOR_PANEL_SHORTCUTS = [
  { icon: ListTree, id: 'contour-tree' },
  { icon: MousePointer2, id: 'path-actions' },
  { icon: ListOrdered, id: 'cut-sequence' },
  { icon: Move, id: 'path-transform' },
  { icon: TriangleAlert, id: 'path-diagnostics' },
  { icon: Search, id: 'statistics' },
  { icon: Ruler, id: 'measurement' },
  { icon: Settings2, id: 'machine' }
] as const;
const EDITOR_PANEL_HOVER_OPEN_DELAY_MS = 500;

export function EditorPanelToolbar({ groups }: EditorPanelToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const visibleGroups = groups.filter((group) => group.panels.length > 0);
  const panelsById = new Map(
    visibleGroups.flatMap((group) => group.panels.map((panel) => [panel.id, panel] as const))
  );

  function clearHoverOpenTimer() {
    if (hoverOpenTimerRef.current === null) return;
    window.clearTimeout(hoverOpenTimerRef.current);
    hoverOpenTimerRef.current = null;
  }

  function handleMouseEnter() {
    clearHoverOpenTimer();
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null;
      setMenuOpen(true);
    }, EDITOR_PANEL_HOVER_OPEN_DELAY_MS);
  }

  function handleMouseLeave() {
    clearHoverOpenTimer();
    setMenuOpen(false);
  }

  useEffect(() => clearHoverOpenTimer, []);

  if (visibleGroups.length === 0) return null;

  function handleBlur(event: FocusEvent<HTMLElement>) {
    const nextFocus = event.relatedTarget;
    if (!nextFocus || !event.currentTarget.contains(nextFocus as Node)) {
      clearHoverOpenTimer();
      setMenuOpen(false);
    }
  }

  function handleSummaryClick(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    clearHoverOpenTimer();
    setMenuOpen((current) => !current);
  }

  function handlePanelClick(panel: EditorPanelMenuItem) {
    clearHoverOpenTimer();
    if (panel.placement === 'hidden') panel.onShow();
    else panel.onHide();
    setMenuOpen(false);
  }

  return (
    <div className="flex min-w-0 items-center gap-1 text-[10px]" data-editor-panel-toolbar>
      <div className="hidden items-center gap-1 min-[1360px]:flex" data-editor-panel-shortcuts>
        {EDITOR_PANEL_SHORTCUTS.map((shortcut) => {
          const panel = panelsById.get(shortcut.id);
          if (!panel) return null;
          const action = panel.placement === 'hidden' ? 'Show' : 'Hide';
          const ShortcutIcon = shortcut.icon;

          return (
            <button
              aria-label={`${action} ${panel.title} workspace panel`}
              className="flex size-7 items-center justify-center border border-border bg-background/70 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              data-editor-panel-shortcut={shortcut.id}
              key={shortcut.id}
              onClick={() => handlePanelClick(panel)}
              title={`${action} ${panel.title}`}
              type="button"
            >
              <ShortcutIcon aria-hidden="true" className="size-3.5" />
            </button>
          );
        })}
      </div>
      <details
        className="relative min-w-0"
        onBlur={handleBlur}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        open={menuOpen}
      >
        <summary
          aria-label="Panels"
          className="flex size-7 cursor-pointer select-none items-center justify-center border border-border bg-background/70 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={handleSummaryClick}
          title="All workspace panels"
        >
          <PanelsTopLeft aria-hidden="true" className="size-3.5" />
        </summary>
        <div className="absolute right-0 top-7 z-50 grid max-h-[76vh] w-72 gap-2 overflow-auto border border-border bg-card p-2 shadow-2xl">
          {visibleGroups.map((group) => (
            <section
              className="grid gap-1 border border-border bg-background/35 p-1"
              data-editor-panel-menu-group={group.id}
              key={group.id}
            >
              <h3 className="px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                {group.title}
              </h3>
              {group.panels.map((panel) => {
                const isHidden = panel.placement === 'hidden';
                const status = isHidden
                  ? 'off'
                  : panel.placement === 'floating'
                    ? 'free'
                    : panel.placement.replace('docked-', '');

                return (
                  <button
                    aria-label={`${isHidden ? 'Show' : 'Hide'} ${panel.title}`}
                    className="grid min-h-8 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border border-border px-1.5 py-1 text-left text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
                    data-editor-panel-menu-item={panel.id}
                    key={panel.id}
                    onClick={() => handlePanelClick(panel)}
                    title={`${isHidden ? 'Show' : 'Hide'} ${panel.title}`}
                    type="button"
                  >
                    {isHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] text-foreground">{panel.title}</span>
                      {panel.description && (
                        <span
                          className="block truncate text-[10px] text-muted-foreground"
                          data-editor-panel-menu-item-description
                        >
                          {panel.description}
                        </span>
                      )}
                    </span>
                    <span
                      className="technical-value text-[10px] uppercase text-muted-foreground"
                      data-editor-panel-menu-item-status
                    >
                      {status}
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}

interface EditorPanelDockZoneProps {
  children?: ReactNode;
  collapsed?: boolean;
  panelCount: number;
  side: EditorDockSide;
  title: string;
  onDropPanel: (panelId: string, side: EditorDockSide, point: { x: number; y: number }) => void;
  onToggleCollapsed?: () => void;
}

export function EditorPanelDockZone({
  children,
  collapsed = false,
  panelCount,
  side,
  title,
  onDropPanel,
  onToggleCollapsed
}: EditorPanelDockZoneProps) {
  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const panelId = event.dataTransfer.getData('application/x-editor-panel-id');
    if (!panelId) return;
    onDropPanel(panelId, side, { x: event.clientX, y: event.clientY });
  }

  return (
    <aside
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/95 text-[10px]"
      data-editor-panel-dock-zone={side}
      data-editor-panel-dock-zone-collapsed={collapsed ? 'true' : 'false'}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border px-1">
        <span className="truncate px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {collapsed ? title.slice(0, 1) : title}
        </span>
        <div className="flex items-center gap-1">
          <span className="technical-value px-1 text-[10px] text-muted-foreground">{panelCount}</span>
          {onToggleCollapsed && (
            <button
              aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
              className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
              onClick={onToggleCollapsed}
              title={`${collapsed ? 'Expand' : 'Collapse'} ${title}`}
              type="button"
            >
              {collapsed ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
            </button>
          )}
        </div>
      </div>
      <div
        className={`work-region-scrollbar min-h-0 overflow-auto p-1 ${collapsed ? 'hidden' : 'grid content-start gap-1'}`}
        data-editor-dock-panel-stack={side}
      >
        {panelCount === 0 && (
          <div
            className="grid min-h-24 place-items-center border border-dashed border-border bg-background/25 px-2 text-center text-[10px] uppercase text-muted-foreground"
            data-editor-empty-dock={side}
          >
            Drop panels
          </div>
        )}
        {children}
      </div>
    </aside>
  );
}

interface EditorFloatingPanelProps {
  children: ReactNode;
  geometry: EditorFloatingPanelGeometry;
  id: string;
  onDock: (side: EditorDockSide) => void;
  title: string;
  onDragEnd: (point: { x: number; y: number }) => void;
  onFloat: () => void;
  onGeometryChange: (geometry: EditorFloatingPanelGeometry) => void;
  onHide: () => void;
}

export function EditorFloatingPanel({
  children,
  geometry,
  id,
  onDock,
  title,
  onDragEnd,
  onFloat,
  onGeometryChange,
  onHide
}: EditorFloatingPanelProps) {
  function handleDragStart(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startGeometry = geometry;
    let lastPoint = { x: event.clientX, y: event.clientY };

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      lastPoint = { x: moveEvent.clientX, y: moveEvent.clientY };
      onGeometryChange({
        ...startGeometry,
        x: Math.max(6, startGeometry.x + moveEvent.clientX - startX),
        y: Math.max(42, startGeometry.y + moveEvent.clientY - startY)
      });
    }

    function handlePointerUp(upEvent: globalThis.PointerEvent) {
      lastPoint = { x: upEvent.clientX, y: upEvent.clientY };
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      onDragEnd(lastPoint);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  }

  function handleMoveKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 1 : 10;
    const delta = keyboardArrowDelta(event.key, step);
    if (!delta) return;

    event.preventDefault();
    event.stopPropagation();
    onGeometryChange({
      ...geometry,
      x: geometry.x + delta.x,
      y: geometry.y + delta.y
    });
  }

  function handleResizeKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 1 : 10;
    const delta = keyboardArrowDelta(event.key, step);
    if (!delta) return;

    event.preventDefault();
    event.stopPropagation();
    onGeometryChange({
      ...geometry,
      width: geometry.width + delta.x,
      height: geometry.height + delta.y
    });
  }

  function handleResizeStart(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startGeometry = geometry;

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      onGeometryChange({
        ...startGeometry,
        width: Math.max(260, startGeometry.width + moveEvent.clientX - startX),
        height: Math.max(180, startGeometry.height + moveEvent.clientY - startY)
      });
    }

    function handlePointerUp() {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  }

  return (
    <aside
      className="fixed z-30 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/98 text-[10px] shadow-2xl"
      data-editor-floating-panel={id}
      style={
        {
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: geometry.height
        } as CSSProperties
      }
    >
      <div className="flex h-7 items-center gap-1 border-b border-border bg-background/70 px-1">
        <button
          aria-label={`Move ${title}`}
          className="flex h-6 min-w-0 flex-1 cursor-move items-center truncate px-1 text-left text-[10px] font-semibold text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          data-editor-workspace-panel-handle={id}
          onKeyDown={handleMoveKeyDown}
          onPointerDown={handleDragStart}
          title={`Move ${title}`}
          type="button"
        >
          <span className="truncate">{title}</span>
        </button>
        <EditorPanelPlacementControls
          onDock={onDock}
          onFloat={onFloat}
          placement="floating"
          title={title}
        />
        <button
          aria-label={`Hide ${title}`}
          className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
          onClick={onHide}
          onPointerDown={(event) => event.stopPropagation()}
          title={`Hide ${title}`}
          type="button"
        >
          <X className="size-3" />
        </button>
      </div>
      <div className="min-h-0 overflow-hidden">{children}</div>
      <button
        aria-label={`Resize ${title}`}
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize border-b border-r border-primary/70"
        data-editor-floating-panel-resizer={id}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizeStart}
        title={`Resize ${title}`}
        type="button"
      />
    </aside>
  );
}

function keyboardArrowDelta(key: string, step: number) {
  if (key === 'ArrowLeft') return { x: -step, y: 0 };
  if (key === 'ArrowRight') return { x: step, y: 0 };
  if (key === 'ArrowUp') return { x: 0, y: -step };
  if (key === 'ArrowDown') return { x: 0, y: step };
  return null;
}

function EditorPanelPlacementControls({
  onDock,
  onFloat,
  placement,
  title
}: {
  onDock: (side: EditorDockSide) => void;
  onFloat: () => void;
  placement: EditorPanelPlacement;
  title: string;
}) {
  const commands = [
    {
      disabled: placement === 'docked-left',
      label: `Dock ${title} left`,
      shortLabel: 'L',
      onClick: () => onDock('left')
    },
    {
      disabled: placement === 'docked-right',
      label: `Dock ${title} right`,
      shortLabel: 'R',
      onClick: () => onDock('right')
    },
    {
      disabled: placement === 'floating',
      label: `Float ${title}`,
      shortLabel: 'F',
      onClick: onFloat
    }
  ];

  return (
    <div className="flex shrink-0 items-center gap-0.5" data-editor-panel-placement-controls>
      {commands.map((command) => (
        <button
          aria-label={command.label}
          className="flex size-5 items-center justify-center border border-border font-mono text-[9px] text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default disabled:opacity-35"
          disabled={command.disabled}
          key={command.label}
          onClick={command.onClick}
          onPointerDown={(event) => event.stopPropagation()}
          title={command.label}
          type="button"
        >
          <span aria-hidden="true">{command.shortLabel}</span>
        </button>
      ))}
    </div>
  );
}

interface EditorWorkspacePanelFrameProps extends EditorWorkspacePanelController {
  children: ReactNode;
  id: string;
  title: string;
  fill?: boolean;
}

export function EditorWorkspacePanelFrame({
  children,
  dockOrder = 0,
  fill = false,
  geometry,
  id,
  placement,
  title,
  onDock,
  onDragEnd,
  onFloat,
  onFloatFromDock,
  onGeometryChange,
  onHide
}: EditorWorkspacePanelFrameProps) {
  const [floatingLayer, setFloatingLayer] = useState<HTMLElement | null>(null);
  const [dockTarget, setDockTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setFloatingLayer(document.querySelector<HTMLElement>('[data-editor-floating-layer]'));
  }, []);

  useEffect(() => {
    if (!placement.startsWith('docked-')) {
      setDockTarget(null);
      return;
    }

    const dockSide = placement === 'docked-left' ? 'left' : 'right';
    const selector = `[data-editor-dock-panel-stack="${dockSide}"]`;
    let retryCount = 0;
    let retryTimer: number | null = null;
    const findDockTarget = () => {
      const nextDockTarget = document.querySelector<HTMLElement>(selector);
      if (nextDockTarget) {
        setDockTarget(nextDockTarget);
        return;
      }
      if (retryCount >= 10) return;

      retryCount += 1;
      retryTimer = window.setTimeout(findDockTarget, 0);
    };

    findDockTarget();

    return () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [placement]);

  if (placement === 'hidden') return null;

  if (placement === 'floating') {
    const panel = (
      <EditorFloatingPanel
        geometry={geometry}
        id={id}
        onDock={onDock}
        onDragEnd={onDragEnd}
        onFloat={onFloat}
        onGeometryChange={onGeometryChange}
        onHide={onHide}
        title={title}
      >
        <div
          className="work-region-scrollbar h-full min-h-0 overflow-auto p-2"
          data-editor-workspace-panel={id}
          data-editor-workspace-panel-placement={placement}
        >
          {children}
        </div>
      </EditorFloatingPanel>
    );

    return floatingLayer ? createPortal(panel, floatingLayer) : panel;
  }

  const side = placement === 'docked-left' ? 'left' : 'right';

  function handleNativeDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.setData('application/x-editor-panel-id', id);
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleNativeDragEnd(event: DragEvent<HTMLDivElement>) {
    if (event.dataTransfer.dropEffect !== 'move') {
      onFloatFromDock({ x: event.clientX, y: event.clientY });
    }
  }

  const dockedPanel = (
    <section
      className={`grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-x-0 border-b-0 border-t border-border bg-card/55 ${
        fill ? 'flex-1' : 'shrink-0'
      }`}
      data-editor-workspace-panel={id}
      data-editor-workspace-panel-placement={placement}
      data-editor-workspace-panel-side={side}
      style={{ order: dockOrder }}
    >
      <div
        className="flex h-7 shrink-0 cursor-move items-center justify-between gap-2 border-b border-border bg-background/45 px-1"
        data-editor-workspace-panel-handle={id}
        draggable
        onDragEnd={handleNativeDragEnd}
        onDragStart={handleNativeDragStart}
      >
        <span className="min-w-0 flex-1 truncate px-1 text-[10px] font-semibold text-foreground">
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <EditorPanelPlacementControls
            onDock={onDock}
            onFloat={onFloat}
            placement={placement}
            title={title}
          />
          <button
            aria-label={`Hide ${title}`}
            className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
            onClick={onHide}
            onPointerDown={(event) => event.stopPropagation()}
            title={`Hide ${title}`}
            type="button"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
      <div className="work-region-scrollbar min-h-0 overflow-auto p-2">{children}</div>
    </section>
  );

  return dockTarget ? createPortal(dockedPanel, dockTarget) : dockedPanel;
}
