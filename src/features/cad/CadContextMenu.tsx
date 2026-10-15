import { MenuItem, MenuLabel, MenuSeparator, MenuSurface } from '@/components/ui/menu';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import './cad-context-menu.css';

export type CadContextMenuItem = { readonly kind: 'separator' }
  | { readonly label: string; readonly disabled?: boolean; readonly danger?: boolean; onSelect(): void };
export interface CadContextMenuAnchor { readonly x: number; readonly y: number }

/** Target actions share existing operations; the menu owns only focus and dismissal. */
export function CadContextMenu({ anchor, title, items, onClose }: {
  anchor: CadContextMenuAnchor; title: string; items: readonly CadContextMenuItem[]; onClose(): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
    const bounds = element.getBoundingClientRect();
    setPosition({ x: Math.max(4, Math.min(anchor.x, window.innerWidth - bounds.width - 4)),
      y: Math.max(4, Math.min(anchor.y, window.innerHeight - bounds.height - 4)) });
    (element.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? element).focus();
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !element.contains(event.target)) close.current(); };
    const dismiss = () => close.current();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      if (previousFocus?.isConnected && (element.contains(document.activeElement) || document.activeElement === document.body)) previousFocus.focus({ preventScroll: true });
    };
  }, [anchor.x, anchor.y]);
  return createPortal(<MenuSurface ref={menu} className="cad-context-menu" tabIndex={-1} aria-label={`${title} actions`}
    style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!buttons.length) return;
      const current = buttons.findIndex(button => button === document.activeElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index].focus();
    }}>
    <MenuLabel>{title}</MenuLabel>
    {items.map((item, index) => 'kind' in item ? <MenuSeparator key={index} />
      : <MenuItem type="button" key={index} disabled={item.disabled} danger={item.danger}
        onClick={() => { flushSync(onClose); item.onSelect(); }}>{item.label}</MenuItem>)}
  </MenuSurface>, document.body);
}
