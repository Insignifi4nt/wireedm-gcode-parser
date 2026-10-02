import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Shared keyboard and focus behavior for the dashboard's small action menus. */
export function useDashboardMenu(disabled: boolean) {
  const [openId, setOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstFocus = useRef<'first' | 'last'>('first');
  const menuId = useId();
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];

  function close(restoreFocus = false) {
    if (restoreFocus) triggerRef.current?.focus();
    setOpenId(null);
  }
  function open(id: string, edge: 'first' | 'last' = 'first') {
    if (disabled) return;
    firstFocus.current = edge;
    if (openId === id) {
      const options = items();
      (edge === 'first' ? options[0] : options.at(-1))?.focus();
    } else setOpenId(id);
  }
  useLayoutEffect(() => {
    if (openId === null) return;
    const options = items();
    (firstFocus.current === 'first' ? options[0] : options.at(-1))?.focus();
  }, [openId]);
  useEffect(() => { if (disabled) setOpenId(null); }, [disabled]);
  useEffect(() => {
    if (openId === null) return;
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) setOpenId(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [openId]);

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open(id, event.key === 'ArrowUp' ? 'last' : 'first');
    } else if (event.key === 'Escape' && openId === id) {
      event.preventDefault();
      close(true);
    }
  }
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = items();
    const index = options.findIndex(item => item === document.activeElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = options.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      options[next]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      // Resume the ordinary tab order from the trigger before unmounting items.
      // Native Tab/Shift+Tab then moves past it without trapping focus in the menu.
      close(true);
    }
  }
  return { openId, menuId, menuRef, triggerRef, close, onTriggerKeyDown, onMenuKeyDown,
    toggle: (id: string) => openId === id ? close(true) : open(id) };
}
