import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { cadPanelLayout, changeCadPanelPreference, DEFAULT_CAD_PANEL_PREFERENCES } from './cadPanelLayout';

/** CAD presentation state is independent of documents, history and CAM rails. */
export function useCadPanelLayout(propertiesVisible: boolean) {
  const body = useRef<HTMLDivElement>(null);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [preferences, setPreferences] = useState(DEFAULT_CAD_PANEL_PREFERENCES);
  const layout = cadPanelLayout(workspaceWidth, preferences, propertiesVisible);
  const currentLayout = useRef(layout); currentLayout.current = layout;
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setWorkspaceWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const setTreeWidth = useCallback((width: number) => {
    if (currentLayout.current.kind === 'resizable' && width !== currentLayout.current.treeWidth) setPreferences(previous => changeCadPanelPreference(previous, 'tree', width));
  }, []);
  const setPropertiesWidth = useCallback((width: number) => {
    if (currentLayout.current.kind === 'resizable' && width !== currentLayout.current.propertiesWidth) setPreferences(previous => changeCadPanelPreference(previous, 'properties', width));
  }, []);
  return { body, layout, setTreeWidth, setPropertiesWidth };
}
