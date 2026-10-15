import { describe, expect, it } from 'vitest';
import { navigationBlockReason, parseWorkbenchRoute, workbenchRoutePath } from './workbenchRoutes';

describe('workbench navigation boundary', () => {
  it('round-trips saved CAD and editor identities and rejects malformed or extra path segments', () => {
    expect(parseWorkbenchRoute('/cad/cad_gear-3')).toEqual({ kind: 'cad', projectId: 'cad_gear-3' });
    expect(parseWorkbenchRoute('/editor/part%20one')).toEqual({ kind: 'editor', projectId: 'part one' });
    expect(workbenchRoutePath({ kind: 'editor', projectId: 'part one' })).toBe('/editor/part%20one');
    expect(parseWorkbenchRoute('/cad/%2Fetc')).toEqual({ kind: 'not-found' });
    expect(parseWorkbenchRoute('/cad/%ZZ')).toEqual({ kind: 'not-found' });
    expect(parseWorkbenchRoute('/cad/one/two')).toEqual({ kind: 'not-found' });
    expect(parseWorkbenchRoute('/settings/cad')).toEqual({ kind: 'settings', section: 'cad' });
  });

  it('retains CAD drafts on the dashboard but guards replacement by another saved part', () => {
    const state = { busy: false, workflowOpen: false, editorDirty: false, cadDirty: true, cadId: 'first' };
    expect(navigationBlockReason(state, { kind: 'dashboard' })).toBeNull();
    expect(navigationBlockReason(state, { kind: 'cad', projectId: 'first' })).toBeNull();
    expect(navigationBlockReason(state, { kind: 'cad', projectId: 'second' })).toBe('unsaved-cad');
  });

  it('blocks unfinished operations and unsaved editor replacement while allowing settings', () => {
    const state = { busy: false, workflowOpen: false, editorDirty: true, cadDirty: false, cadId: 'first' };
    expect(navigationBlockReason(state, { kind: 'dashboard' })).toBe('unsaved-editor');
    expect(navigationBlockReason({ ...state, busy: true }, { kind: 'dashboard' })).toBe('busy');
    expect(navigationBlockReason({ ...state, workflowOpen: true }, { kind: 'cad', projectId: null })).toBe('workflow');
    expect(navigationBlockReason(state, { kind: 'settings', section: 'storage' })).toBeNull();
  });
});
