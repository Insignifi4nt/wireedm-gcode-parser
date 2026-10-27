import * as React from 'react';
import { createPortal } from 'react-dom';
import { Popper, PopperAnchor, PopperContent } from '@radix-ui/react-popper';
import './tooltip.css';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  side?: React.ComponentProps<typeof PopperContent>['side'];
}

type TriggerEvent = React.SyntheticEvent<HTMLElement>;
type TriggerHandler<E extends TriggerEvent> = ((event: E) => void) | undefined;

/** Opening help closes any other open help. */
const helpOpened = 'ui-tooltip-open';
const openDelay = 400, reopenWindow = 300;

/** The control's own handler runs first; one that prevents the default keeps help unchanged. */
function after<E extends TriggerEvent>(theirs: TriggerHandler<E>, ours: (event: E) => void) {
  return (event: E) => { theirs?.(event); if (!event.defaultPrevented) ours(event); };
}

/**
 * Help describes a control; its visible text or aria-label remains its name. A closed tooltip renders only its control, which
 * keeps the same position and node while help appears, changes or goes. Help that opens is positioned beside it.
 */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const hasContent = content !== undefined && content !== null && content !== '' && content !== false;
  const state = React.useRef({ hasContent, open: false, delayed: true, openTimer: 0, reopenTimer: 0, pointerDown: false, pointerOpened: false,
    control: null as HTMLElement | null, detach: undefined as (() => void) | undefined });
  state.current.hasContent = hasContent;
  const anchor = React.useRef<HTMLElement | null>(null);
  const [, anchorMoved] = React.useReducer((count: number) => count + 1, 0);
  const control = children as React.ReactElement<React.HTMLAttributes<HTMLElement> & React.RefAttributes<HTMLElement>>;
  const controlRef = control.props.ref;
  // Help follows the control's current node, as Radix's trigger did. A control that renders a new node while help is open, on its
  // own or from above, renders the tooltip again so the help moves beside the new node. A control that forwards this ref through
  // its own callback may drop the cleanup and report removal as null instead, which detaches the last node in the same way.
  const followControl = React.useCallback((node: HTMLElement | null) => {
    const current = state.current;
    current.detach?.();
    if (!node) return;
    const moved = current.open && current.control !== node;
    current.control = anchor.current = node;
    if (moved) anchorMoved();
    const cleanup = typeof controlRef === 'function' ? controlRef(node) : void (controlRef && (controlRef.current = node));
    const detach = () => {
      if (current.detach !== detach) return;
      current.detach = undefined;
      if (anchor.current === node) anchor.current = null;
      if (typeof cleanup === 'function') cleanup();
      else if (typeof controlRef === 'function') controlRef(null);
      else if (controlRef) controlRef.current = null;
    };
    current.detach = detach;
    return detach;
  }, [controlRef]);
  const release = React.useCallback(() => { state.current.pointerDown = false; }, []);
  // Help opened within a moment of closing opens again at once, as with the earlier per-control Radix provider. As there, an
  // attempt to open a control without help still counts: it closes other help, and help added later opens at once on hover.
  // That help still waits for the next focus or hover.
  const show = React.useCallback(() => {
    const current = state.current;
    window.clearTimeout(current.openTimer); current.openTimer = 0;
    if (current.open) return;
    window.clearTimeout(current.reopenTimer); current.delayed = false;
    document.dispatchEvent(new CustomEvent(helpOpened, { detail: id }));
    if (!current.hasContent) return;
    current.open = true;
    setOpen(true);
  }, [id]);
  const hide = React.useCallback(() => {
    const current = state.current;
    window.clearTimeout(current.openTimer); current.openTimer = 0;
    if (!current.open) return;
    current.open = false; window.clearTimeout(current.reopenTimer);
    current.reopenTimer = window.setTimeout(() => { current.delayed = true; }, reopenWindow);
    setOpen(false);
  }, []);
  React.useEffect(() => () => {
    const current = state.current;
    window.clearTimeout(current.openTimer); window.clearTimeout(current.reopenTimer);
    document.removeEventListener('pointerup', release);
  }, [release]);
  const shown = open && hasContent;
  React.useEffect(() => {
    if (!open) return;
    const closeForOther = (event: Event) => { if (event instanceof CustomEvent && event.detail !== id) hide(); };
    const closeOnScroll = (event: Event) => { if (event.target instanceof Node && anchor.current && event.target.contains(anchor.current)) hide(); };
    document.addEventListener(helpOpened, closeForOther);
    window.addEventListener('scroll', closeOnScroll, { capture: true });
    // Any press closes help from the next task on, as with Radix's dismissable layer, so a press that opened it does not.
    const pressCloses = window.setTimeout(() => document.addEventListener('pointerdown', hide));
    return () => {
      window.clearTimeout(pressCloses);
      document.removeEventListener(helpOpened, closeForOther);
      document.removeEventListener('pointerdown', hide);
      window.removeEventListener('scroll', closeOnScroll, { capture: true });
    };
  }, [open, id, hide]);
  React.useEffect(() => {
    if (!shown) return;
    // Escape closes help without consuming the event; the focused field or draft still owns it, with IME input.
    const closeHelp = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('keydown', closeHelp, true);
    return () => window.removeEventListener('keydown', closeHelp, true);
  }, [shown, hide]);
  const { props } = control;
  const description = props['aria-describedby'];
  const trigger = React.cloneElement(control, {
    ref: followControl,
    title: undefined,
    'aria-describedby': shown ? [description, id].filter(Boolean).join(' ') : description,
    'aria-description': props['aria-description'] ?? (typeof content === 'string' ? content : undefined),
    onPointerMove: after(props.onPointerMove, event => {
      const current = state.current;
      if (event.pointerType === 'touch' || current.pointerOpened) return;
      current.pointerOpened = true;
      if (!current.delayed) { show(); return; }
      window.clearTimeout(current.openTimer);
      current.openTimer = window.setTimeout(show, openDelay);
    }),
    onPointerLeave: after(props.onPointerLeave, () => { hide(); state.current.pointerOpened = false; }),
    // A press closes open help but, as before, leaves a pending hover delay running until the click.
    onPointerDown: after(props.onPointerDown, () => {
      if (state.current.open) hide();
      state.current.pointerDown = true;
      document.addEventListener('pointerup', release, { once: true });
    }),
    onFocus: after(props.onFocus, () => { if (!state.current.pointerDown) show(); }),
    onBlur: after(props.onBlur, hide),
    onClick: after(props.onClick, hide),
  });
  return <>
    {trigger}
    {shown && <Popper>
      <PopperAnchor virtualRef={anchor} />
      {createPortal(<PopperContent id={id} role="tooltip" className="ui-tooltip-content" side={side} sideOffset={6} collisionPadding={8}>
        {content}
      </PopperContent>, document.body)}
    </Popper>}
  </>;
}
