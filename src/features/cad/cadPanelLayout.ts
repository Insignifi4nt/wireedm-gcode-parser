export type CadPanelSide = 'tree' | 'properties';
export interface CadPanelPreferences {
  readonly tree: number;
  readonly properties: number;
  readonly priority: CadPanelSide;
}
export const CAD_PANEL_LIMITS = Object.freeze({
  desktopMinimum: 1024,
  canvasMinimum: 480,
  separatorWidth: 4,
  tree: Object.freeze({ minimum: 180, maximum: 420, initial: 220 }),
  properties: Object.freeze({ minimum: 240, maximum: 520, initial: 272 })
});
export const DEFAULT_CAD_PANEL_PREFERENCES: CadPanelPreferences = Object.freeze({
  tree: CAD_PANEL_LIMITS.tree.initial, properties: CAD_PANEL_LIMITS.properties.initial, priority: 'properties'
});
export type CadPanelLayout = { readonly kind: 'fixed' } | {
  readonly kind: 'resizable';
  readonly treeWidth: number;
  readonly propertiesWidth: number;
  readonly treeMaximum: number;
  readonly propertiesMaximum: number;
};
function preferredWidth(side: CadPanelSide, width: number): number {
  const limits = CAD_PANEL_LIMITS[side];
  return Number.isFinite(width) ? Math.min(limits.maximum, Math.max(limits.minimum, Math.round(width))) : limits.initial;
}
export function changeCadPanelPreference(preferences: CadPanelPreferences, side: CadPanelSide, width: number): CadPanelPreferences {
  return { ...preferences, [side]: preferredWidth(side, width), priority: side };
}

/** Responsive limits never replace the user's preferred widths. */
export function cadPanelLayout(workspaceWidth: number, preferences: CadPanelPreferences, propertiesVisible: boolean): CadPanelLayout {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth < CAD_PANEL_LIMITS.desktopMinimum) return { kind: 'fixed' };
  const available = Math.floor(workspaceWidth) - CAD_PANEL_LIMITS.canvasMinimum - CAD_PANEL_LIMITS.separatorWidth * (propertiesVisible ? 2 : 1);
  let treeWidth = preferredWidth('tree', preferences.tree);
  let propertiesWidth = preferredWidth('properties', preferences.properties);
  if (!propertiesVisible) treeWidth = Math.min(treeWidth, available);
  else if (preferences.priority === 'tree') {
    treeWidth = Math.min(treeWidth, available - CAD_PANEL_LIMITS.properties.minimum);
    propertiesWidth = Math.min(propertiesWidth, available - treeWidth);
  } else {
    propertiesWidth = Math.min(propertiesWidth, available - CAD_PANEL_LIMITS.tree.minimum);
    treeWidth = Math.min(treeWidth, available - propertiesWidth);
  }
  return {
    kind: 'resizable', treeWidth, propertiesWidth,
    treeMaximum: Math.min(CAD_PANEL_LIMITS.tree.maximum, available - (propertiesVisible ? propertiesWidth : 0)),
    propertiesMaximum: propertiesVisible ? Math.min(CAD_PANEL_LIMITS.properties.maximum, available - treeWidth) : CAD_PANEL_LIMITS.properties.maximum
  };
}
