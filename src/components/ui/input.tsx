import * as React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';
import './input.css';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  density?: 'default' | 'compact';
}

/** Native inputs retain browser validation, selection, file and form semantics. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, density = 'default', title, ...props }, ref) => {
    const control = <input ref={ref} className={cn('ui-input', className)} data-density={density} {...props} />;
    return <Tooltip content={title}>{control}</Tooltip>;
  }
);
Input.displayName = 'Input';
export { Input };
