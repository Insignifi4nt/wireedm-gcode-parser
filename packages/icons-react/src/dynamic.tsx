import { forwardRef } from 'react';
import { iconCatalog, type IconName } from './catalog.js';
import { createIcon, renderIcon } from './createIcon.js';
import type { WorkbenchIconProps } from './types.js';

/** Dynamic lookup deliberately loads the full catalog. Prefer named imports. */
export const WorkbenchIcon = forwardRef<SVGSVGElement, WorkbenchIconProps & { name: IconName }>(
  function WorkbenchIcon({ name, ...props }, ref) {
    return renderIcon(name, iconCatalog[name].paths, props, ref);
  }
);

export function makeIcon(name: IconName) {
  return createIcon(name, iconCatalog[name].paths);
}

export { iconCatalog } from './catalog.js';
export type { IconName, IconCategory } from './catalog.js';
export type { WorkbenchIconComponent, WorkbenchIconProps } from './types.js';
