import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from 'react';

export interface WorkbenchIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
  absoluteStrokeWidth?: boolean;
}

export type WorkbenchIconComponent = ForwardRefExoticComponent<WorkbenchIconProps & RefAttributes<SVGSVGElement>>;
