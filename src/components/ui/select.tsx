import * as React from 'react';
import { cn } from '@/lib/utils';
import './select.css';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  density?: 'default' | 'compact';
}

/** Keep native labels, options, forms and keyboard behavior on the actual select. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, density = 'default', ...props }, ref) =>
    <select ref={ref} className={cn('ui-select', className)} data-density={density} {...props} />
);
Select.displayName = 'Select';

export { Select };
