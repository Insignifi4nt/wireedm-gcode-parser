import { useCallback, useLayoutEffect, useRef, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from 'react';

interface RailResizeHandleProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onKeyDown' | 'onPointerDown' | 'role'> {
  label: string;
  side: 'left' | 'right';
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChange: (width: number) => void;
}

/** Resizes a side rail with the pointer or a focusable vertical separator. */
export function RailResizeHandle({ label, side, width, minWidth, maxWidth, onWidthChange, className = '', ...attributes }: RailResizeHandleProps) {
  const activeDrag = useRef<{ controller: AbortController; element: HTMLDivElement; pointerId: number } | null>(null);
  const current = useRef({ minWidth, maxWidth, onWidthChange });
  useLayoutEffect(() => { current.current = { minWidth, maxWidth, onWidthChange }; }, [minWidth, maxWidth, onWidthChange]);
  const finishDrag = useCallback(() => {
    const drag = activeDrag.current;
    if (!drag) return;
    activeDrag.current = null; drag.controller.abort();
    if (drag.element.hasPointerCapture?.(drag.pointerId)) {
      try { drag.element.releasePointerCapture(drag.pointerId); } catch { /* Pointer may already have left the document. */ }
    }
  }, []);
  useLayoutEffect(() => finishDrag, [finishDrag, side]);
  const direction = side === 'left' ? 1 : -1;
  const clamp = (next: number) => Math.min(maxWidth, Math.max(minWidth, next));

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 1 : 10;
    const next = event.key === 'ArrowLeft' ? width - direction * step
      : event.key === 'ArrowRight' ? width + direction * step
        : event.key === 'Home' ? minWidth
          : event.key === 'End' ? maxWidth : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    onWidthChange(clamp(next));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    event.currentTarget.focus();
    finishDrag();
    const controller = new AbortController();
    const element = event.currentTarget;
    activeDrag.current = { controller, element, pointerId: event.pointerId };
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const options = { signal: controller.signal };
    window.addEventListener('pointermove', move => {
      if (move.pointerId !== pointerId) return;
      if (!(move.buttons & 1)) { finishDrag(); return; }
      const latest = current.current;
      latest.onWidthChange(Math.min(latest.maxWidth, Math.max(latest.minWidth, width + direction * (move.clientX - startX))));
    }, options);
    const finish = (end: globalThis.PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      finishDrag();
    };
    window.addEventListener('pointerup', finish, options);
    window.addEventListener('pointercancel', finish, options);
    window.addEventListener('blur', finishDrag, options);
    element.addEventListener('lostpointercapture', finish, options);
    // Capture keeps pointerup observable outside this narrow separator. Window
    // listeners also support environments without pointer-capture APIs.
    try { element.setPointerCapture?.(pointerId); } catch { /* Capture may be unavailable for this input device. */ }
  }

  return <div
    {...attributes}
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={minWidth}
    aria-valuemax={maxWidth}
    aria-valuenow={width}
    aria-valuetext={`${Math.round(width)} pixels`}
    className={`touch-none cursor-col-resize bg-border/30 outline-none transition hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:ring-1 focus-visible:ring-ring ${className}`}
    onKeyDown={handleKeyDown}
    onPointerDown={handlePointerDown}
    role="separator"
    tabIndex={0}
    title={`${label}: arrow keys move the divider; Shift moves one pixel; Home/End set width limits`}
  />;
}
