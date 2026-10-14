import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import './cad-context-help.css';

/** Nonmodal contextual disclosure. Hover/focus previews; clicking pins it. */
export function CadContextHelp({ label, children, onOpenChange, className = '', triggerContent, buttonLabel, activation = 'preview' }: {
  label: string; children: ReactNode; onOpenChange?(open: boolean): void; className?: string;
  triggerContent?: ReactNode; buttonLabel?: string; activation?: 'preview' | 'click';
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const opened = useRef(false), suppressed = useRef(false), closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyboardActivation = useRef(false);
  const callback = useRef(onOpenChange);
  useEffect(() => { callback.current = onOpenChange; }, [onOpenChange]);
  const clearTimer = () => { if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const show = (next: boolean) => {
    clearTimer();
    if (opened.current === next) return;
    opened.current = next; setOpen(next); callback.current?.(next);
  };
  const dismiss = (restoreFocus = false) => {
    suppressed.current = true; setPinned(false); show(false);
    if (restoreFocus && panel.current?.contains(document.activeElement)) trigger.current?.focus();
  };
  const leave = () => {
    if (pinned || trigger.current === document.activeElement || panel.current?.contains(document.activeElement)) return;
    clearTimer(); closeTimer.current = setTimeout(() => show(false), 180);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(288, window.innerWidth - 24), height = panel.current?.getBoundingClientRect().height ?? 180;
      const preferred = anchor.right + width + 8 < window.innerWidth - 12 ? anchor.right + 8 : anchor.left - width - 8;
      setPosition({ left: Math.max(12, Math.min(preferred, window.innerWidth - width - 12)), top: Math.max(12, Math.min(anchor.top, window.innerHeight - height - 12)) });
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation(); dismiss(true);
    };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  useEffect(() => {
    if (open && pinned && keyboardActivation.current) { keyboardActivation.current = false; panel.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
  }, [open, pinned]);
  useEffect(() => () => { clearTimer(); if (opened.current) callback.current?.(false); }, []);
  return <span className={`cad-context-help ${className}`}>
    <button ref={trigger} type="button" className="cad-context-help-trigger" aria-label={buttonLabel ?? `${label} help`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onMouseEnter={() => { clearTimer(); if (activation === 'preview' && !suppressed.current) show(true); }} onMouseLeave={() => { suppressed.current = false; leave(); }}
      onFocus={() => { if (activation === 'preview' && !suppressed.current) show(true); }} onBlur={event => { suppressed.current = false; if (!panel.current?.contains(event.relatedTarget)) leave(); }}
      onClick={event => { if (pinned) dismiss(); else { keyboardActivation.current = event.detail === 0; suppressed.current = false; setPinned(true); show(true); } }}>{triggerContent ?? <Info size={12} aria-hidden="true" />}</button>
    {open && createPortal(<div ref={panel} id={id} className="cad-context-help-popover" role="dialog" aria-label={`${label} help`} style={position}
      onMouseEnter={clearTimer} onMouseLeave={leave} onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) leave(); }}>
      <header><strong>{label}</strong><button type="button" aria-label={`Close ${label} help`} onClick={() => dismiss(true)}><X size={12} aria-hidden="true" /></button></header>
      <div className="cad-context-help-content">{children}</div>
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </span>;
}
