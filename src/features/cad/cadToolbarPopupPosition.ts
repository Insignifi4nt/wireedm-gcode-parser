/** Place an owned toolbar menu beside its trigger without clipping at the window edge. */
export function cadToolbarPopupPosition({ trigger, popup, viewport }: {
  trigger: Pick<DOMRectReadOnly, 'left' | 'top' | 'bottom'>;
  popup: Pick<DOMRectReadOnly, 'width' | 'height'>;
  viewport: { width: number; height: number };
}): { left: number; top: number } {
  const margin = 4, gap = 5;
  const below = trigger.bottom + gap;
  const top = below + popup.height <= viewport.height - margin ? below : trigger.top - gap - popup.height;
  return {
    left: Math.max(margin, Math.min(trigger.left, viewport.width - popup.width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - popup.height - margin)),
  };
}
