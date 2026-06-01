import {
  useEffect,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, X } from 'lucide-react';

export type EditorDockSide = 'left' | 'right';
export type EditorPanelPlacement = 'floating' | 'hidden' | `docked-${EditorDockSide}`;

export interface EditorFloatingPanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorWorkspacePanelController {
  dockOrder?: number;
  geometry: EditorFloatingPanelGeometry;
  placement: EditorPanelPlacement;
  onDragEnd: (point: { x: number; y: number }) => void;
  onFloatFromDock: (point: { x: number; y: number }) => void;
  onGeometryChange: (geometry: EditorFloatingPanelGeometry) => void;
  onHide: () => void;
}

interface EditorPanelMenuItem {
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

export function EditorPanelToolbar({ groups }: EditorPanelToolbarProps) {
  const visibleGroups = groups.filter((group) => group.panels.length > 0);
  if (visibleGroups.length === 0) return null;

  return (
    <details
      className="relative min-w-0 font-mono text-[10px]"
      data-editor-panel-toolbar
    >
      <summary className="flex h-7 cursor-pointer select-none items-center border border-border bg-background/70 px-2 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground">
        Panels
      </summary>
      <div className="absolute right-0 top-8 z-50 grid max-h-[76vh] w-72 gap-2 overflow-auto border border-border bg-card p-2 shadow-2xl">
        {visibleGroups.map((group) => (
          <section
            className="grid gap-1 border border-border bg-background/35 p-1"
            data-editor-panel-menu-group={group.id}
            key={group.id}
          >
            <h3 className="px-1 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
              {group.title}
            </h3>
            {group.panels.map((panel) => {
              const isHidden = panel.placement === 'hidden';

              return (
                <button
                  aria-label={`${isHidden ? 'Show' : 'Hide'} ${panel.title}`}
                  className="grid h-7 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border border-border px-1.5 text-left text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
                  data-editor-panel-menu-item={panel.id}
                  key={panel.id}
                  onClick={isHidden ? panel.onShow : panel.onHide}
                  title={`${isHidden ? 'Show' : 'Hide'} ${panel.title}`}
                  type="button"
                >
                  {isHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  <span className="truncate">{panel.title}</span>
                  <span className="text-[8px] uppercase text-muted-foreground">
                    {isHidden ? 'off' : panel.placement === 'floating' ? 'free' : panel.placement.replace('docked-', '')}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </details>
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
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/95 font-mono text-[10px]"
      data-editor-panel-dock-zone={side}
      data-editor-panel-dock-zone-collapsed={collapsed ? 'true' : 'false'}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border px-1">
        <span className="truncate px-1 text-[9px] font-semibold uppercase text-muted-foreground">
          {collapsed ? title.slice(0, 1) : title}
        </span>
        <div className="flex items-center gap-1">
          <span className="px-1 text-[8px] text-muted-foreground">{panelCount}</span>
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
        className={`min-h-0 overflow-auto p-1 ${collapsed ? 'hidden' : 'grid content-start gap-1'}`}
        data-editor-dock-panel-stack={side}
      >
        {panelCount === 0 && (
          <div
            className="grid min-h-24 place-items-center border border-dashed border-border bg-background/25 px-2 text-center text-[9px] uppercase text-muted-foreground"
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
  title: string;
  onDragEnd: (point: { x: number; y: number }) => void;
  onGeometryChange: (geometry: EditorFloatingPanelGeometry) => void;
  onHide: () => void;
}

export function EditorFloatingPanel({
  children,
  geometry,
  id,
  title,
  onDragEnd,
  onGeometryChange,
  onHide
}: EditorFloatingPanelProps) {
  function handleDragStart(event: PointerEvent<HTMLDivElement>) {
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

  function handleResizeStart(event: PointerEvent<HTMLDivElement>) {
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
      className="fixed z-30 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/98 font-mono text-[10px] shadow-2xl"
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
      <div
        className="flex h-7 cursor-move items-center justify-between gap-2 border-b border-border bg-background/70 px-1"
        data-editor-workspace-panel-handle={id}
        onPointerDown={handleDragStart}
      >
        <span className="min-w-0 truncate px-1 text-[10px] font-semibold text-foreground">{title}</span>
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
      <div
        aria-label={`Resize ${title}`}
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize border-b border-r border-primary/70"
        data-editor-floating-panel-resizer={id}
        onPointerDown={handleResizeStart}
        role="separator"
      />
    </aside>
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
  onDragEnd,
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
    setDockTarget(document.querySelector<HTMLElement>(`[data-editor-dock-panel-stack="${dockSide}"]`));
  }, [placement]);

  if (placement === 'hidden') return null;

  if (placement === 'floating') {
    const panel = (
      <EditorFloatingPanel
        geometry={geometry}
        id={id}
        onDragEnd={onDragEnd}
        onGeometryChange={onGeometryChange}
        onHide={onHide}
        title={title}
      >
        <div
          className="h-full min-h-0 overflow-auto p-2"
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
      className={`grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/70 ${
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
        <span className="truncate px-1 text-[10px] font-semibold text-foreground">{title}</span>
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
      <div className="min-h-0 overflow-auto p-2">{children}</div>
    </section>
  );

  return dockTarget ? createPortal(dockedPanel, dockTarget) : dockedPanel;
}
