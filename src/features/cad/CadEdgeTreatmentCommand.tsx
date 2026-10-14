import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChamferIcon, ExpandDownIcon, FilletIcon } from '@/components/icons';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { cadToolbarPopupPosition } from './cadToolbarPopupPosition';

type EdgeTreatmentKind = Extract<CadFeature['kind'], 'fillet' | 'chamfer'>;

/** Keep edge treatments together, with the menu outside the scrolling toolbar. */
export function CadEdgeTreatmentCommand({ disabled, onChoose, context = 'model' }: { disabled: boolean; onChoose(kind: EdgeTreatmentKind): void; context?: 'model' | 'sketch' }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const id = useId();
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const rectangle = trigger.current?.getBoundingClientRect();
    const menuRectangle = popup.current?.getBoundingClientRect();
    if (!rectangle || !menuRectangle) return;
    setPosition(cadToolbarPopupPosition({ trigger: rectangle, popup: menuRectangle, viewport: { width: window.innerWidth, height: window.innerHeight } }));
    const commands = popup.current?.querySelectorAll<HTMLButtonElement>('button');
    (initialFocus.current === 'last' ? commands?.[commands.length - 1] : commands?.[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !popup.current?.contains(event.target)) setOpen(false);
    };
    const moved = () => setOpen(false);
    window.document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', moved);
    window.document.addEventListener('scroll', moved, true);
    return () => {
      window.document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', moved);
      window.document.removeEventListener('scroll', moved, true);
    };
  }, [open, disabled]);
  return <>
    <button ref={trigger} className="cad-tool" aria-label={context === 'sketch' ? 'Sketch corner tools' : 'Fillet / Chamfer'} title={context === 'sketch' ? 'Round supported sketch corners' : 'Round or bevel solid edges'} disabled={disabled} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={open && !disabled ? id : undefined}
      onPointerDown={event => { if (open) event.preventDefault(); }}
      onClick={() => { if (open) close(true); else { initialFocus.current = 'first'; setOpen(true); } }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); }
      }}><FilletIcon size={15} /><span>Fillet / Chamfer</span><ExpandDownIcon size={11} /></button>
    {open && !disabled && createPortal(<div ref={popup} id={id} role="menu" aria-label="Edge treatment commands" className="cad-pattern-menu" style={position}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (event.key === 'Tab') {
          event.preventDefault();
          const toolbar = trigger.current?.closest('.cad-toolbar') ?? trigger.current?.parentElement;
          const controls = [...toolbar?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
          const index = controls.findIndex(control => control === trigger.current);
          close(); (controls[index + (event.shiftKey ? -1 : 1)] ?? trigger.current)?.focus();
          return;
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const commands = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const current = commands.findIndex(command => command === window.document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? commands.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length;
        commands[next]?.focus();
      }}>
      <button role="menuitem" onClick={() => { close(); onChoose('fillet'); }}><FilletIcon size={14} /> Fillet</button>
      {context === 'model' && <button role="menuitem" onClick={() => { close(); onChoose('chamfer'); }}><ChamferIcon size={14} /> Chamfer</button>}
    </div>, window.document.body)}
  </>;
}
