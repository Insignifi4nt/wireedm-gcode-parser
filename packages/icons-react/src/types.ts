import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';

export interface WorkbenchIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
}

export type WorkbenchIconComponent = ForwardRefExoticComponent<WorkbenchIconProps & RefAttributes<SVGSVGElement>>;
/** An icon that `createIcon` makes. `paths` is its drawing as SVG path data on the 24-unit grid, for a caller that draws many copies into one SVG of its own. */
export type WorkbenchDrawnIconComponent = WorkbenchIconComponent & { readonly paths: readonly string[] };
