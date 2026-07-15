import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
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

interface EditorPanelDockZoneProps {
  children?: ReactNode;
  collapsed?: boolean;
  panelCount: number;
  side: EditorDockSide;
  title: string;
  onDropPanel: (panelId: string, side: EditorDockSide, point: { x: number; y: number }) => void;
  onToggleCollapsed?: () => void;
}

interface EditorCollapsedDockZoneProps {
  panelCount: number;
  registerDockZone?: boolean;
  side: EditorDockSide;
  title: string;
  onExpand: () => void;
}

export function EditorCollapsedDockZone({
  panelCount,
  registerDockZone = true,
  side,
  title,
  onExpand
}: EditorCollapsedDockZoneProps) {
  const ExpandIcon = side === 'left' ? PanelLeftOpen : PanelRightOpen;

  return (
    <aside
      className="grid h-full min-h-0 overflow-hidden border border-border bg-card/95 text-[10px]"
      data-editor-collapsed-dock={side}
      data-editor-panel-dock-zone={registerDockZone ? side : undefined}
      data-editor-panel-dock-zone-collapsed="true"
    >
      <div className="flex min-h-0 flex-col items-center gap-2 py-1">
        <button
          aria-label={`Expand ${title}`}
          className="flex size-7 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
          onClick={onExpand}
          title={`Expand ${title}`}
          type="button"
        >
          <ExpandIcon aria-hidden="true" className="size-3.5" />
        </button>
        <span className="technical-value text-[10px] text-muted-foreground">{panelCount}</span>
        <span
          className="rotate-180 truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground [writing-mode:vertical-rl]"
          title={title}
        >
          {title}
        </span>
      </div>
    </aside>
  );
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
  if (collapsed && onToggleCollapsed) {
    return (
      <EditorCollapsedDockZone
        onExpand={onToggleCollapsed}
        panelCount={panelCount}
        side={side}
        title={title}
      />
    );
  }

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
      data-editor-panel-dock-zone-collapsed="false"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="flex h-7 shrink-0 items-center justify-between gap-2 border-b border-border px-1">
        <span className="truncate px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {title}
        </span>
        <div className="flex items-center gap-1">
          <span className="technical-value px-1 text-[10px] text-muted-foreground">{panelCount}</span>
          {onToggleCollapsed && (
            <button
              aria-label={`Collapse ${title}`}
              className="flex size-6 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground"
              onClick={onToggleCollapsed}
              title={`Collapse ${title}`}
              type="button"
            >
              {side === 'left' ? (
                <PanelLeftClose aria-hidden="true" className="size-3" />
              ) : (
                <PanelRightClose aria-hidden="true" className="size-3" />
              )}
            </button>
          )}
        </div>
      </div>
      <div
        className="work-region-scrollbar grid min-h-0 content-start gap-1 overflow-auto p-1"
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
