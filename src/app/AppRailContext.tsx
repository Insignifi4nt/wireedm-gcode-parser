import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';

export type EditorCompactDrawer = 'upid' | 'workflow' | null;

export interface AppRailContent {
  collapsed: ReactNode;
  expanded: ReactNode;
  hasActiveWorkflow?: boolean;
  isCollapsed?: boolean;
  isPathProject?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  replaceRailChrome?: boolean;
  sizing?: {
    maxWidth: number;
    minWidth: number;
    onWidthChange: (width: number) => void;
    width: number;
  };
}

interface AppRailContextValue {
  closeCompactDrawerWithRailFocus: () => void;
  compactDrawer: EditorCompactDrawer;
  compactModalHost: HTMLElement | null;
  compactTransitionOverlay: boolean;
  isCompactViewport: boolean;
  isMiddleViewport: boolean;
  setCompactDrawer: Dispatch<SetStateAction<EditorCompactDrawer>>;
  setCompactTransitionOverlay: Dispatch<SetStateAction<boolean>>;
  setHeaderContent: Dispatch<SetStateAction<ReactNode | null>>;
  setRailCollapsed: Dispatch<SetStateAction<boolean>>;
  setRailContent: Dispatch<SetStateAction<AppRailContent | null>>;
}

const AppRailContext = createContext<AppRailContextValue | null>(null);

export const AppRailProvider = AppRailContext.Provider;

export function useAppRail() {
  const context = useContext(AppRailContext);
  if (!context) {
    throw new Error('useAppRail must be used inside AppShell.');
  }
  return context;
}
