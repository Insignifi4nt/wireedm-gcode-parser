import { useLayoutEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]';

/** Whether focus has fallen to the page, as it does when the element holding it is removed or disabled. */
export function focusFell(document: Document = window.document): boolean {
  const active = document.activeElement;
  return active === null || active === document.body;
}

/**
 * Focus moves to the first target that takes it, so it does not fall to the page when what held it closes or goes. A group, such as a drawn
 * dimension, gives focus to its first element with a tab stop, its label. Returns the element that took focus, if any.
 */
export function restoreFocus(...targets: readonly (Element | null | undefined)[]): Element | null {
  for (const target of targets) {
    const element = target?.isConnected ? target.matches(FOCUSABLE) ? target : target.querySelector(FOCUSABLE) : null;
    if (!(element instanceof HTMLElement || element instanceof SVGElement) || element.matches(':disabled')) continue;
    element.focus({ preventScroll: true });
    if (element.ownerDocument.activeElement === element) return element;
  }
  return null;
}

/** The canvas of the sketch being edited in the workbench holding `element`, where focus goes when nothing nearer can take it. */
export function cadSketchCanvasOf(element: Element | null | undefined): SVGSVGElement | null {
  return element?.closest('.cad-workbench')?.querySelector<SVGSVGElement>('svg.cad-sketch-canvas') ?? null;
}

/**
 * However a sketch editor closes, by Cancel, Escape, Apply or what it edits going, focus it held, or that fell to the page while it was open,
 * moves to `anchor()` when that can take it, else to the sketch canvas, so the canvas keys work at once. Focus the user moved elsewhere stays.
 */
export function useCadSketchEditorFocusReturn(container: RefObject<HTMLElement | null>, anchor?: () => Element | null): void {
  const latest = useRef(anchor);
  useLayoutEffect(() => { latest.current = anchor; });
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    // An unmounting editor is still in the page here, so its canvas can be found from it.
    return () => {
      const owner = element.ownerDocument;
      if (element.contains(owner.activeElement) || focusFell(owner)) restoreFocus(latest.current?.(), cadSketchCanvasOf(element));
    };
  }, [container]);
}
