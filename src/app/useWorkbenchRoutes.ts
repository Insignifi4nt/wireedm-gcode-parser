import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { CadController } from '@/features/cad/useCadController';
import { hasUnsavedCadDraft } from '@/features/cad/cadSession';
import { createCadDocument } from '@/domain/cad/cadSchema';
import type { DraftReadSnapshot } from '@/features/webmcp/workbenchSiteTools';
import type { useWorkbenchAppController } from './useWorkbenchAppController';
import { navigationBlockReason, parseWorkbenchRoute, workbenchRoutePath } from './workbenchRoutes';
import type { WorkbenchSettingsSection } from './WorkbenchSettingsDialog';

type AppController = ReturnType<typeof useWorkbenchAppController>;

/** URL requests use the same guarded open operations as the UI and WebMCP.
 * Controller-driven imports, handoffs and saves publish their actual identity afterward.
 */
export function useWorkbenchRoutes(app: AppController, cad: CadController, getEditorDraft: () => DraftReadSnapshot | null,
  releaseEditorDraft: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledLocation = useRef<string | null>(null);
  const pending = useRef(false);
  const publishing = useRef(false);
  const live = useRef({ app, cad, getEditorDraft, releaseEditorDraft });
  live.current = { app, cad, getEditorDraft, releaseEditorDraft };
  const currentPath = cad.open ? workbenchRoutePath({ kind: 'cad', projectId: cad.snapshot.savedVersion ? cad.snapshot.document.id : null })
    : app.activeView === 'editor' ? workbenchRoutePath({ kind: 'editor', projectId: app.loadedEditorProgram?.project.id ?? null }) : '/';
  const route = parseWorkbenchRoute(location.pathname);
  const settingsReturnPath = useRef('/');
  const openedSettings = useRef(false);

  function blockReason(path: string) {
    const state = live.current;
    return navigationBlockReason({
      busy: pending.current || state.app.workbenchInteractionLocked || state.cad.isBusy(),
      workflowOpen: state.cad.snapshot.workflowOpen || Boolean(state.getEditorDraft()?.workflowOpen),
      editorDirty: state.app.activeView === 'editor' && Boolean(state.getEditorDraft()?.dirty),
      cadDirty: hasUnsavedCadDraft(state.cad.snapshot), cadId: state.cad.snapshot.document.id
    }, parseWorkbenchRoute(path));
  }
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !publishing.current
    && currentLocation.pathname !== nextLocation.pathname && nextLocation.pathname !== currentPath && blockReason(nextLocation.pathname) !== null);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const reason = blockReason(blocker.location.pathname);
    if (reason === 'busy' || reason === 'workflow') {
      live.current.app.showStatusToast(reason === 'busy' ? 'Wait for the current operation to finish before navigating.' : 'Finish or cancel the active command before navigating.', 'warning');
      blocker.reset();
      return;
    }
    if (!window.confirm('Discard unsaved changes and open the requested page?')) { blocker.reset(); return; }
    if (reason === 'unsaved-cad') live.current.cad.session.replace(createCadDocument());
    if (reason === 'unsaved-editor') live.current.releaseEditorDraft();
    blocker.proceed();
  }, [blocker.state]);

  useEffect(() => {
    if (app.workbenchStatus !== 'ready' || !app.connectedWorkbench || handledLocation.current === location.key) return;
    handledLocation.current = location.key;
    const requested = parseWorkbenchRoute(location.pathname);
    setError(null); setLoading(false);
    if (requested.kind === 'settings') return;
    if (requested.kind === 'not-found') { setError('This page does not exist.'); return; }
    if (location.pathname === currentPath) return;
    const controller = new AbortController();
    pending.current = true; setLoading(true);
    void (async () => {
      const state = live.current;
      if (requested.kind === 'dashboard') {
        if (state.cad.open) state.cad.back();
        if (state.app.activeView === 'editor') { state.releaseEditorDraft(); state.app.handleBackToDashboard(); }
      } else if (requested.kind === 'cad') {
        if (state.app.activeView === 'editor') { state.releaseEditorDraft(); state.app.handleBackToDashboard(); }
        if (requested.projectId === null || requested.projectId === state.cad.snapshot.document.id && state.cad.snapshot.dirty) state.cad.enter();
        else await state.cad.openDocument(requested.projectId, state.cad.snapshot.version, controller.signal);
      } else {
        if (state.cad.open) state.cad.back();
        if (requested.projectId === null) {
          if (state.app.activeView !== 'editor' || state.app.loadedEditorProgram) state.app.handleOpenEditor();
        } else if (state.app.activeView !== 'editor' || state.app.loadedEditorProgram?.project.id !== requested.projectId) {
          if (!await state.app.handleOpenWorkbenchProject(requested.projectId, controller.signal)) throw new Error('This project could not be opened in the selected workbench.');
        }
      }
    })().catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'The requested project could not be opened.');
    }).finally(() => {
      if (!controller.signal.aborted) { pending.current = false; setLoading(false); }
    });
    return () => { controller.abort(); pending.current = false; };
  }, [location.key, app.workbenchStatus, app.connectedWorkbench?.adapter]);

  useLayoutEffect(() => {
    if (handledLocation.current !== location.key || pending.current || error || route.kind === 'settings' || route.kind === 'not-found') return;
    if (location.pathname === currentPath) return;
    publishing.current = true;
    const canonical = parseWorkbenchRoute(currentPath);
    const normalizeCurrentEntry = route.kind === 'dashboard' && canonical.kind === 'dashboard'
      || (route.kind === 'cad' || route.kind === 'editor') && canonical.kind === route.kind
        && (route.projectId === null || route.projectId === canonical.projectId);
    void navigate(currentPath, { replace: normalizeCurrentEntry });
    publishing.current = false;
  }, [currentPath, location.key, location.pathname, error, loading]);

  return {
    loading, error,
    settingsSection: route.kind === 'settings' ? route.section : null,
    openSettings(section: WorkbenchSettingsSection) {
      if (route.kind !== 'settings') { settingsReturnPath.current = currentPath; openedSettings.current = true; }
      void navigate(workbenchRoutePath({ kind: 'settings', section }), { replace: route.kind === 'settings' });
    },
    closeSettings() {
      if (currentPath !== settingsReturnPath.current) {
        openedSettings.current = false;
        publishing.current = true; void navigate(currentPath, { replace: true }); publishing.current = false;
      } else if (openedSettings.current) { openedSettings.current = false; void navigate(-1); }
      else void navigate(settingsReturnPath.current, { replace: true });
    },
    openCadProject(id: string) { return navigate(workbenchRoutePath({ kind: 'cad', projectId: id })); },
    home() { return navigate('/'); }
  };
}
