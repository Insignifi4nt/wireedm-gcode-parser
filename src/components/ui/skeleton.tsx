import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import './skeleton.css';

/** Decorative loading shape. Its owner supplies the status and real content lifecycle. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} aria-hidden="true" className={cn('ui-skeleton', className)} />;
}
