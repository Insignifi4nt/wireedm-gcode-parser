import { forwardRef, useRef, type HTMLAttributes, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import { Button, type ButtonProps } from './button';
import './menu.css';

export interface MenuSurfaceProps extends HTMLAttributes<HTMLDivElement> { onDismiss?: () => void }

/** Domain owners keep anchoring and focus return; menu rows share navigation. */
export const MenuSurface = forwardRef<HTMLDivElement, MenuSurfaceProps>(
  ({ className, children, onKeyDown, onDismiss, role = 'menu', ...props }, ref) => {
    const search = useRef({ text: '', time: 0 });
    function navigate(event: KeyboardEvent<HTMLDivElement>) {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (onDismiss && (event.key === 'Escape' || event.key === 'Tab')) {
        event.preventDefault(); event.stopPropagation(); onDismiss(); return;
      }
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
        .filter(item => !item.matches(':disabled') && !item.hidden && item.closest('[role="menu"]') === event.currentTarget);
      if (!items.length) return;
      const current = items.findIndex(item => item === document.activeElement);
      let next: HTMLElement | undefined;
      if (event.key === 'Home') next = items[0];
      else if (event.key === 'End') next = items.at(-1);
      else if (event.key === 'ArrowDown') next = items[(current + 1) % items.length];
      else if (event.key === 'ArrowUp') next = items[(current < 0 ? items.length - 1 : current + items.length - 1) % items.length];
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
        const now = Date.now(), letter = event.key.toLocaleLowerCase();
        search.current = { text: now - search.current.time < 600 ? search.current.text + letter : letter, time: now };
        const candidates = [...items.slice(current + 1), ...items.slice(0, current + 1)];
        const query = [...search.current.text].every(character => character === letter) ? letter : search.current.text;
        next = candidates.find(item => (item.textContent ?? '').trim().toLocaleLowerCase().startsWith(query));
      }
      if (next) { event.preventDefault(); event.stopPropagation(); next.focus(); }
    }
    return <div ref={ref} role={role} className={cn('ui-menu', className)} onKeyDown={navigate} {...props}>{children}</div>;
  }
);
MenuSurface.displayName = 'MenuSurface';

export interface MenuItemProps extends ButtonProps { danger?: boolean }
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  ({ className, danger, role = 'menuitem', variant = 'menu', type = 'button', ...props }, ref) =>
    <Button ref={ref} role={role} variant={variant} type={type} className={cn('ui-menu-item', danger && 'ui-menu-item-danger', className)} {...props} />
);
MenuItem.displayName = 'MenuItem';
export interface MenuCheckboxItemProps extends Omit<MenuItemProps, 'onClick'> { checked: boolean; onCheckedChange: (checked: boolean) => void }
export function MenuCheckboxItem({ checked, onCheckedChange, children, ...props }: MenuCheckboxItemProps) {
  return <MenuItem role="menuitemcheckbox" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props}>
    <span className="ui-menu-check" aria-hidden="true">{checked && <Check size={13} />}</span>{children}
  </MenuItem>;
}
export function MenuSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn('ui-menu-separator', className)} {...props} />;
}
export function MenuLabel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('ui-menu-label', className)} {...props} />;
}
