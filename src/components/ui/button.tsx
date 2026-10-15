import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { Tooltip } from './tooltip';
import './button.css';

const buttonVariants = cva(
  'ui-button',
  {
    variants: {
      variant: {
        default: 'ui-button-primary',
        primary: 'ui-button-primary',
        secondary: 'ui-button-secondary',
        ghost: 'ui-button-ghost',
        outline: 'ui-button-outline',
        danger: 'ui-button-danger',
        menu: 'ui-button-menu',
        scrim: 'ui-button-scrim'
      },
      size: {
        compact: 'ui-button-compact',
        sm: 'ui-button-compact',
        md: 'ui-button-medium',
        icon: 'ui-button-icon',
        menu: 'ui-button-menu-size'
      }
    },
    defaultVariants: {
      variant: 'ghost',
      size: 'compact'
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, title, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    const control = (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
    return <Tooltip content={title}>{control}</Tooltip>;
  }
);
Button.displayName = 'Button';

export { Button };
