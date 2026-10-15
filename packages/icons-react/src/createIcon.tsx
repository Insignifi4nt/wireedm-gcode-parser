import { forwardRef, type ForwardedRef } from 'react';
import type { WorkbenchIconComponent, WorkbenchIconProps } from './types.js';

export function renderIcon(name: string, paths: readonly string[], {
  size = 24, absoluteStrokeWidth = false, children,
  'aria-label': label, 'aria-labelledby': labelledBy, ...props
}: WorkbenchIconProps, ref: ForwardedRef<SVGSVGElement>) {
  const named = Boolean(label || labelledBy);
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
    focusable="false" role={named ? 'img' : undefined} aria-hidden={named ? undefined : true}
    aria-label={label} aria-labelledby={labelledBy} {...props} ref={ref} data-workbench-icon={name}>
    {paths.map((d, index) => <path key={index} d={d} vectorEffect={absoluteStrokeWidth ? 'non-scaling-stroke' : undefined} />)}
    {children}
  </svg>;
}

export function createIcon(name: string, paths: readonly string[]): WorkbenchIconComponent {
  const Icon = forwardRef<SVGSVGElement, WorkbenchIconProps>(function Icon(props, ref) {
    return renderIcon(name, paths, props, ref);
  });
  Icon.displayName = `WorkbenchIcon(${name})`;
  return Icon;
}
