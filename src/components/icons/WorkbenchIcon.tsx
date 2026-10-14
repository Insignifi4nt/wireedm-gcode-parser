import { forwardRef, type SVGProps } from 'react';
import { iconCatalog, type IconName } from './iconCatalog';

// The owning control supplies the accessible name for decorative glyphs.
// aria-label opts a standalone glyph into the accessibility tree.
export interface WorkbenchIconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'viewBox'> {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
}

export const WorkbenchIcon = forwardRef<SVGSVGElement, WorkbenchIconProps & { name: IconName }>(
  function WorkbenchIcon({ name, size = 24, absoluteStrokeWidth = false, 'aria-label': label, 'aria-labelledby': labelledBy, ...props }, ref) {
    return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      {...props} ref={ref} viewBox="0 0 24 24" focusable="false" role={label || labelledBy ? 'img' : undefined} aria-label={label} aria-labelledby={labelledBy} aria-hidden={label || labelledBy ? undefined : true} data-workbench-icon={name}>
      {iconCatalog[name].paths.map((d, index) => <path key={index} d={d} vectorEffect={absoluteStrokeWidth ? 'non-scaling-stroke' : undefined} />)}
    </svg>;
  }
);

export function makeIcon(name: IconName) {
  const Icon = forwardRef<SVGSVGElement, WorkbenchIconProps>(function Icon(props, ref) { return <WorkbenchIcon {...props} name={name} ref={ref} />; });
  Icon.displayName = `WorkbenchIcon(${name})`;
  return Icon;
}

export type WorkbenchIconComponent = ReturnType<typeof makeIcon>;
