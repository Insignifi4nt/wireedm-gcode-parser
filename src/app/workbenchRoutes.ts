import type { WorkbenchSettingsSection } from './WorkbenchSettingsDialog';

export type WorkbenchRoute =
  | { kind: 'dashboard' }
  | { kind: 'cad' | 'editor'; projectId: string | null }
  | { kind: 'settings'; section: WorkbenchSettingsSection }
  | { kind: 'not-found' };

export function parseWorkbenchRoute(pathname: string): WorkbenchRoute {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] === '') return { kind: 'dashboard' };
  if (parts[0] === 'settings' && parts.length <= 2) {
    const section = parts[1] ?? 'storage';
    if (section === 'storage' || section === 'cad' || section === 'machine-output') return { kind: 'settings', section };
  }
  if ((parts[0] === 'cad' || parts[0] === 'editor') && parts.length <= 2) {
    try {
      const projectId = parts[1] ? decodeURIComponent(parts[1]) : null;
      if (projectId !== null && (/[\u0000-\u001f/\\]/.test(projectId) || projectId.length > 160)) return { kind: 'not-found' };
      return { kind: parts[0], projectId };
    } catch { /* Invalid URL escapes are an unavailable route, never a storage path. */ }
  }
  return { kind: 'not-found' };
}

export function workbenchRoutePath(route: Exclude<WorkbenchRoute, { kind: 'not-found' }>): string {
  if (route.kind === 'dashboard') return '/';
  if (route.kind === 'settings') return `/settings/${route.section}`;
  return `/${route.kind}${route.projectId === null ? '' : `/${encodeURIComponent(route.projectId)}`}`;
}

export type NavigationBlockReason = 'busy' | 'workflow' | 'unsaved-editor' | 'unsaved-cad';
export function navigationBlockReason(state: {
  busy: boolean; workflowOpen: boolean; editorDirty: boolean; cadDirty: boolean; cadId: string;
}, target: WorkbenchRoute): NavigationBlockReason | null {
  if (target.kind === 'settings') return null;
  if (state.busy) return 'busy';
  if (state.workflowOpen) return 'workflow';
  if (state.editorDirty) return 'unsaved-editor';
  if (state.cadDirty && target.kind === 'cad' && target.projectId !== null && target.projectId !== state.cadId) return 'unsaved-cad';
  return null;
}
