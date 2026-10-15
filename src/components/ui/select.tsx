import * as React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';
import './select.css';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  density?: 'default' | 'compact';
}

/** Keep native labels, options, forms and keyboard behavior on the actual select. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, density = 'default', title, ...props }, ref) => {
    const control = <select ref={ref} className={cn('ui-select', className)} data-density={density} {...props} />;
    return <Tooltip content={title}>{control}</Tooltip>;
  }
);
Select.displayName = 'Select';

export { Select };
