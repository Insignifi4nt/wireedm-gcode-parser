import * as React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';
import './input.css';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, title, ...props }, ref) => {
    const control = <textarea ref={ref} className={cn('ui-textarea', className)} {...props} />;
    return <Tooltip content={title}>{control}</Tooltip>;
  }
);
Textarea.displayName = 'Textarea';
export { Textarea };
