import { Button } from '@/components/ui/button';
import { MenuItem, MenuSurface } from '@/components/ui/menu';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, CircularPatternIcon, LinearPatternIcon, PatternIcon } from '@wire-edm/icons-react';
import type { CadFeature } from '@/domain/cad/cadDocument';
import { cadToolbarPopupPosition } from './cadToolbarPopupPosition';

type PatternKind = Extract<CadFeature['kind'], 'linear-pattern' | 'circular-pattern'>;

/** A toolbar popup escapes the horizontally scrolling toolstrip. */
export function CadPatternCommand({ disabled, onChoose }: { disabled: boolean; onChoose(kind: PatternKind): void }) {
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
    <Button ref={trigger} className="cad-tool" aria-label="Pattern" title="Pattern" disabled={disabled} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={open && !disabled ? id : undefined}
      onPointerDown={event => { if (open) event.preventDefault(); }}
      onClick={() => { if (open) close(true); else { initialFocus.current = 'first'; setOpen(true); } }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); }
      }}><PatternIcon size={15} strokeWidth={1.5} /><span>Pattern</span><ChevronDown size={11} /></Button>
    {open && !disabled && createPortal(<MenuSurface ref={popup} id={id} aria-label="Pattern commands" className="cad-pattern-menu" style={position}
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
      <MenuItem onClick={() => { close(); onChoose('linear-pattern'); }}><LinearPatternIcon size={14} /> Linear pattern</MenuItem>
      <MenuItem onClick={() => { close(); onChoose('circular-pattern'); }}><CircularPatternIcon size={14} /> Circular pattern</MenuItem>
    </MenuSurface>, window.document.body)}
  </>;
}
