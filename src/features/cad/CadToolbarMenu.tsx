import { Button } from '@/components/ui/button';
import { MenuCheckboxItem, MenuItem, MenuLabel, MenuSeparator, MenuSurface } from '@/components/ui/menu';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from '@wire-edm/icons-react';
import { focusFell, restoreFocus } from './cadFocus';
import { cadToolbarPopupPosition } from './cadToolbarPopupPosition';

export type CadToolbarMenuItem = { readonly kind?: 'command'; readonly key: string; readonly label: string; readonly icon?: ReactNode; readonly title?: string; readonly disabled?: boolean;
  /** A toggle row: checked shows the state is already applied, and choosing it again undoes it. */
  readonly checked?: boolean; onSelect(): void }
  | { readonly kind: 'label'; readonly key: string; readonly label: string } | { readonly kind: 'separator'; readonly key: string };

/** A toolbar command with a popup of choices. The popup escapes the horizontally scrolling toolstrip. */
export function CadToolbarMenu({ label, icon, menuLabel, disabled, pressed, title, className, items }: {
  label: string; icon: ReactNode; menuLabel: string; disabled: boolean; pressed?: boolean; title?: string; className?: string; items: readonly CadToolbarMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const initialFocus = useRef<'first' | 'last'>('first');
  const id = useId();
  const close = (returnFocus = false) => { setOpen(false); if (returnFocus) trigger.current?.focus(); };
  // A chosen command closes the menu with focus in it; focus that fell to the page then returns to the button, while an editor the command
  // opened keeps the focus it took.
  const chosen = useRef(false);
  useLayoutEffect(() => {
    if (open || !chosen.current) return;
    chosen.current = false;
    if (focusFell()) restoreFocus(trigger.current);
  }, [open]);
  const choose = (onSelect: () => void) => { chosen.current = true; close(); onSelect(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || disabled) return;
    const rectangle = trigger.current?.getBoundingClientRect();
    const menuRectangle = popup.current?.getBoundingClientRect();
    if (!rectangle || !menuRectangle) return;
    setPosition(cadToolbarPopupPosition({ trigger: rectangle, popup: menuRectangle, viewport: { width: window.innerWidth, height: window.innerHeight } }));
    const commands = popup.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
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
    <Button ref={trigger} className="cad-tool" aria-label={label} title={title ?? label} disabled={disabled} aria-pressed={pressed} aria-haspopup="menu" aria-expanded={open && !disabled} aria-controls={open && !disabled ? id : undefined}
      onPointerDown={event => { if (open) event.preventDefault(); }}
      onClick={() => { if (open) close(true); else { initialFocus.current = 'first'; setOpen(true); } }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true); }
      }}>{icon}<span>{label}</span><ChevronDown size={11} /></Button>
    {open && !disabled && createPortal(<MenuSurface ref={popup} id={id} aria-label={menuLabel} className={className ?? 'cad-pattern-menu'} style={position}
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
        const commands = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const current = commands.findIndex(command => command === window.document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? commands.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + commands.length) % commands.length;
        commands[next]?.focus();
      }}>
      {items.map(item => item.kind === 'separator' ? <MenuSeparator key={item.key} /> : item.kind === 'label' ? <MenuLabel key={item.key}>{item.label}</MenuLabel>
        : item.checked !== undefined ? <MenuCheckboxItem key={item.key} title={item.title} disabled={item.disabled} checked={item.checked} onCheckedChange={() => choose(item.onSelect)}>{item.icon} {item.label}</MenuCheckboxItem>
        : <MenuItem key={item.key} title={item.title} disabled={item.disabled} onClick={() => choose(item.onSelect)}>{item.icon} {item.label}</MenuItem>)}
    </MenuSurface>, window.document.body)}
  </>;
}
