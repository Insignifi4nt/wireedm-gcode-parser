import { useEffect, useRef, type HTMLAttributes, type KeyboardEvent, type PointerEvent } from 'react';

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
  const activeDrag = useRef<AbortController | null>(null);
  useEffect(() => () => activeDrag.current?.abort(), []);
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
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    activeDrag.current?.abort();
    const controller = new AbortController();
    activeDrag.current = controller;
    const startX = event.clientX;
    const pointerId = event.pointerId;
    const options = { signal: controller.signal };
    window.addEventListener('pointermove', move => {
      if (move.pointerId === pointerId) onWidthChange(clamp(width + direction * (move.clientX - startX)));
    }, options);
    const finish = (end: globalThis.PointerEvent) => {
      if (end.pointerId !== pointerId) return;
      controller.abort();
      activeDrag.current = null;
    };
    window.addEventListener('pointerup', finish, options);
    window.addEventListener('pointercancel', finish, options);
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
