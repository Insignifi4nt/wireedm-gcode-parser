import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from 'react';

export interface AppRailContent {
  collapsed: ReactNode;
  expanded: ReactNode;
  replaceRailChrome?: boolean;
  sizing?: {
    maxWidth: number;
    minWidth: number;
    onWidthChange: (width: number) => void;
    width: number;
  };
}

interface AppRailContextValue {
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
