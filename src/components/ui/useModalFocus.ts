import { useEffect, useRef, type RefObject } from 'react';

/** Keeps modal focus and background isolation together, restoring both on close. */
export function useModalFocus({ open, overlayRef, dialogRef, initialFocusRef, onClose, dismissible = true }: {
  open: boolean;
  overlayRef: RefObject<HTMLElement | null>;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  dismissible?: boolean;
}) {
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };
  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!open || !overlay || !dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background: Array<{ element: HTMLElement; inert: boolean; attribute: string | null; hidden: string | null }> = [];
    for (let branch: HTMLElement | null = overlay; branch && branch !== document.body; branch = branch.parentElement) {
      for (const sibling of branch.parentElement?.children ?? []) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
        background.push({ element: sibling, inert: sibling.inert, attribute: sibling.getAttribute('inert'), hidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true;
        sibling.setAttribute('inert', '');
        sibling.setAttribute('aria-hidden', 'true');
      }
    }
    (initialFocusRef.current ?? dialog).focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.dismissible) latest.current.onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog!.querySelectorAll<HTMLElement>(':is(button, input, select, textarea, a[href], [tabindex]):not(:disabled):not([tabindex="-1"]):not([type="hidden"])')]
        .filter((element) => !element.closest('[hidden], [aria-hidden="true"], [inert]'));
      const first = focusable[0] ?? dialog!;
      const last = focusable.at(-1) ?? dialog!;
      const active = document.activeElement;
      if (!dialog!.contains(active) || (!event.shiftKey && active === last) || focusable.length === 0) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      for (const { element, inert, attribute, hidden } of background) {
        element.inert = inert;
        restoreAttribute(element, 'inert', attribute);
        restoreAttribute(element, 'aria-hidden', hidden);
      }
      if (opener?.isConnected) opener.focus();
    };
  }, [open, overlayRef, dialogRef, initialFocusRef]);
}

function restoreAttribute(element: HTMLElement, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}
