import * as React from 'react';
import { flushSync } from 'react-dom';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import './tooltip.css';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  side?: React.ComponentProps<typeof TooltipPrimitive.Content>['side'];
}

/** Help describes a control; its visible text or aria-label remains its name. */
export function Tooltip({ content, children, side }: TooltipProps) {
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  const hasContent = content !== undefined && content !== null && content !== '' && content !== false;
  React.useEffect(() => {
    if (!open || !hasContent) return;
    const closeHelp = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Remove Radix's document-capture dismiss layer before it consumes the
      // native event. The focused field/draft still owns Escape and IME input.
      flushSync(() => setOpen(false));
    };
    window.addEventListener('keydown', closeHelp, true);
    return () => window.removeEventListener('keydown', closeHelp, true);
  }, [open, hasContent]);
  const description = children.props['aria-describedby'];
  const describedBy = open && hasContent ? [description, id].filter(Boolean).join(' ') : description;
  const trigger = React.cloneElement(children, {
    title: undefined,
    'aria-describedby': describedBy,
    'aria-description': children.props['aria-description'] ?? (typeof content === 'string' ? content : undefined)
  });
  return <TooltipPrimitive.Provider delayDuration={400} disableHoverableContent>
    <TooltipPrimitive.Root open={open && hasContent} onOpenChange={next => setOpen(next && hasContent)}>
      <TooltipPrimitive.Trigger asChild>{trigger}</TooltipPrimitive.Trigger>
      {hasContent && <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content id={id} className="ui-tooltip-content" side={side} sideOffset={6} collisionPadding={8}>
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>}
    </TooltipPrimitive.Root>
  </TooltipPrimitive.Provider>;
}
