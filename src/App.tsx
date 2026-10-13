import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CadSession, hasCadDraftContent } from '@/features/cad/cadSession';
import { useCadController } from '@/features/cad/useCadController';
import { cadSiteTools } from '@/features/cad/cadSiteTools';
import { CadLibraryDialog } from '@/features/cad/CadLibraryDialog';
import { useSiteTools } from '@/features/webmcp/siteTools';
import { workbenchSiteTools, type DraftReadSnapshot, type WorkbenchToolState } from '@/features/webmcp/workbenchSiteTools';
import { useWorkbenchActions } from '@/features/webmcp/useWorkbenchActions';
import { AgentActivity } from '@/features/webmcp/AgentActivity';

import { AppShell } from '@/app/AppShell';
import { type AppServices } from '@/app/appServices';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { StatusToastList } from '@/components/StatusToasts';
import { RecoveryExportPanel } from '@/app/RecoveryExportPanel';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DxfImportConfirmationDialog } from '@/features/dashboard/DxfImportConfirmationDialog';
import { OnboardingDialog } from '@/features/onboarding/OnboardingDialog';
import {
  hasDismissedOnboarding,
  rememberOnboardingDismissal
} from '@/features/onboarding/onboardingPreference';

interface AppProps {
  services?: Partial<AppServices>;
}

const EditorPage = lazy(() => import('@/features/editor/EditorPage').then(({ EditorPage }) => ({ default: EditorPage })));
const CadWorkbench = lazy(() => import('@/features/cad/CadWorkbench').then(({ CadWorkbench }) => ({ default: CadWorkbench })));
const CadSectionDialog = lazy(() => import('@/features/cad/CadSectionDialog').then(({ CadSectionDialog }) => ({ default: CadSectionDialog })));

export default function App({ services }: AppProps = {}) {
  const [onboardingOpen, setOnboardingOpen] = useState(() => !hasDismissedOnboarding());
  const draftRead = useRef<DraftReadSnapshot | null>(null);
  const [cadSession] = useState(() => new CadSession());
  const [cadOpen, setCadOpen] = useState(false);
  const [cadSection, setCadSection] = useState<{ bodyId: string; version: string } | null>(null);
  const cadOpenRef = useRef(cadOpen); cadOpenRef.current = cadOpen;
  const app = useWorkbenchAppController(services, () => cadOpenRef.current ? {
    dirty: cadSession.getSnapshot().dirty, workflowOpen: cadSession.getSnapshot().workflowOpen,
    version: cadSession.getSnapshot().version
  } : draftRead.current);
  const cad = useCadController(app, cadSession, cadOpen, setCadOpen, () => draftRead.current);
  const cadRef = useRef(cad); cadRef.current = cad;
  useEffect(() => { if (app.activeView === 'editor') setCadOpen(false); }, [app.activeView, app.editorProgramRevision]);
  const agentActions = useWorkbenchActions(app, draftRead, cad.isBusy);
  const updateDraftRead = useCallback((snapshot: DraftReadSnapshot | null) => { draftRead.current = snapshot; }, []);
  const toolState = useRef<WorkbenchToolState>({ workbench: null, draft: null, busy: false });
  useLayoutEffect(() => { toolState.current = { workbench: app.connectedWorkbench, draft: null, busy: app.workbenchInteractionLocked, recovery: app.recoveryControls?.source ?? null }; });
  const agentActivity = useSiteTools([...workbenchSiteTools(() => ({ ...toolState.current, draft: draftRead.current,
    busy: agentActions.isBusy() || cad.isBusy() })), ...agentActions.tools, ...cadSiteTools(() => cadRef.current)]);
  const planningMachineId = app.connectedWorkbench?.manifest.preferences.recentPlanningMachineId;
  const planningMachine = app.connectedWorkbench?.machines.machines.find(
    ({ id }) => id === planningMachineId
  ) ?? null;

  function dismissOnboarding() {
    setOnboardingOpen(false);
    rememberOnboardingDismissal();
  }
  function closeCadSection() { setCadSection(null); cadSession.setWorkflowOpen(false, 'section'); }
  function switchStorage(action: () => Promise<void>) {
    try {
      const currentCad = cadRef.current;
      if (currentCad.isOpen() || currentCad.isBusy() || app.workbenchInteractionLocked || app.activeView === 'editor') throw new Error('Return to the dashboard and finish the running workflow before switching storage.');
      cadSession.assertStorageSwitchAllowed();
      return action();
    } catch (error) { app.showStatusToast(error instanceof Error ? error.message : 'Cannot switch storage.', 'error'); }
  }

  return (
    <AppShell
      recovery={app.recoveryControls}
      agentPanelContent={<><AgentActivity activity={agentActivity} />{agentActions.previewControl && <div className="mt-3 border-t border-border pt-2">{agentActions.previewControl}</div>}{cad.previewArtifact && <a className="mt-3 block text-xs text-primary underline" href={cad.previewArtifact.previewUrl} download={cad.previewArtifact.fileName}>CAD preview PNG</a>}</>}
      connectedWorkbench={app.connectedWorkbench}
      errorMessage={app.errorMessage}
      interactionLocked={app.workbenchInteractionLocked || cad.storageBusy}
      onConnectWorkbench={() => switchStorage(app.handleConnectWorkbench)}
      onUseBrowserCache={() => switchStorage(app.handleUseBrowserCache)}
      onActivateMachineSetup={app.handleActivateMachineSetup}
      onCommitMachinePackage={app.handleCommitMachinePackage}
      onPrepareMachinePackage={app.handlePrepareMachinePackage}
      onRemoveMachineDefinition={app.handleRemoveMachineDefinition}
      onSaveCatalogPreferences={app.handleSaveCatalogPreferences}
      settingsErrorMessage={app.settingsErrorMessage}
      settingsStatus={app.settingsStatus}
      statusNotifications={app.statusNotifications}
      storageActionLabel={app.storageActionLabel}
      storageSwitchDisabled={cadOpen || app.activeView === 'editor' || app.workbenchInteractionLocked || cad.storageBusy || (cad.snapshot.dirty && hasCadDraftContent(cad.snapshot.document))}
      storageWarningMessage={app.storageWarningMessage}
      workbenchStatus={app.workbenchStatus}
    >
      <StatusToastList onDismiss={app.dismissStatusToast} toasts={app.statusToasts} />
      {app.dxfReimportStatus === 'importing' && !app.pendingDxfReimport && (
        <div className="fixed left-1/2 top-14 z-50 flex -translate-x-1/2 items-center gap-3 border border-border bg-background p-3 text-xs" role="status">
          Preparing DXF unit review…
          <button className="border border-border px-2 py-1" onClick={app.handleCancelDxfReimport} type="button">Cancel DXF preparation</button>
        </div>
      )}
      {app.workbenchStatus === 'error' && !app.connectedWorkbench ? (
        <section className="grid h-full place-items-center p-6" role="alert">
          <div className="max-w-2xl border border-destructive bg-destructive/10 p-4 font-mono text-xs text-destructive">
            <h1 className="mb-2 font-sans text-sm font-semibold">Workbench could not be opened</h1>
            <p>{app.errorMessage ?? 'The workbench failed without a diagnostic.'}</p>
            <div className="mt-4 text-foreground"><RecoveryExportPanel recovery={app.recoveryControls} disabled={app.workbenchInteractionLocked} /></div>
          </div>
        </section>
      ) : cadOpen && app.connectedWorkbench ? (
        <Suspense fallback={<p className="p-4 text-xs" role="status">Opening CAD workspace…</p>}>
          <CadWorkbench
            document={cad.snapshot.document} documentVersion={cad.snapshot.version} build={cad.build} buildVersion={cad.buildVersion} buildState={cad.buildState}
            dirty={cad.snapshot.dirty} canUndo={cad.snapshot.canUndo} canRedo={cad.snapshot.canRedo}
            errorMessage={cad.errorMessage} storageBusy={cad.storageBusy || app.workbenchInteractionLocked}
            onEdit={edit => { cad.edit([edit]); }} onUndo={() => cad.undo()} onRedo={() => cad.redo()}
            onWorkflowChange={cadSession.setWorkflowOpen}
            onBack={cad.back} onSave={async () => { await cad.save(); }}
            onOpenDocument={() => { void cad.showLibrary().catch(error => cad.setErrorMessage(String(error))); }}
            onNewDocument={() => { cad.newDocument(); }} onImportDocument={async file => { await cad.importDocument(file); }}
            onExportDocument={() => { cad.exportDocument(); }}
            onExportSolid={async format => { await cad.exportSolid(format); }}
            onExportDxf={async sketchId => { await cad.exportDxf(sketchId); }}
            onSendToCam={async sketchId => { await cad.sendToCam(sketchId); }}
            onViewportControlsReady={cad.setViewportControls}
            onCaptureViewport={async () => { await cad.captureViewport(cad.snapshot.version, true); }}
            onSectionForCam={bodyId => {
              cadSession.assertWorkflowClosed();
              cadSession.setWorkflowOpen(true, 'section');
              setCadSection({ bodyId, version: cadSession.getSnapshot().version });
            }}
          />
          {cadSection && <CadSectionDialog bodies={cad.build?.meshes ?? []} initialBodyId={cadSection.bodyId} version={cadSection.version}
            onClose={closeCadSection}
            onInspect={(request, version, signal) => cad.inspectSection(request, version, signal, 'section')}
            onSend={(request, version, signal) => cad.sendSectionToCam(request, version, signal, 'section')} />}
        </Suspense>
      ) : app.activeView === 'editor' && app.connectedWorkbench ? (
        <Suspense fallback={<p className="p-4 text-xs text-muted-foreground" role="status">Opening editor…</p>}><EditorPage
          importErrorMessage={app.editorImportErrorMessage}
          onReadSnapshot={updateDraftRead}
          importStatus={app.editorImportStatus}
          interactionLocked={app.workbenchInteractionLocked || cad.storageBusy}
          key={`${app.loadedEditorProgram?.filePath ?? 'empty-editor'}:${app.editorProgramRevision}`}
          machines={app.connectedWorkbench.machines.machines}
          posts={app.connectedWorkbench.posts}
          onBackToDashboard={app.handleBackToDashboard}
          onDownloadEditorFile={(fileName, text) => app.handleDownloadEditorFile({ fileName, text })}
          onGenerateControllerArtifact={app.handleGenerateControllerArtifact}
          onImportProgramFile={app.handleImportExternalProgram}
          onReimportDxfUnits={
            app.loadedEditorProgram?.project.source.kind === 'dxf'
              ? app.handlePrepareDxfReimport
              : undefined
          }
          onSaveEditorDraft={async (draft) => { await app.handleSaveEditorDraft(draft); }}
          onStatusMessage={app.showStatusToast}
          planningMachine={planningMachine}
          program={app.loadedEditorProgram}
          saveErrorMessage={app.editorSaveErrorMessage}
          saveStatus={app.editorSaveStatus}
        /></Suspense>
      ) : (
        <DashboardPage
          dxfWriting={app.dxfWriting}
          dxfImportCancellable={app.dxfImportCancellable}
          connectedWorkbench={app.connectedWorkbench}
          importErrorMessage={app.importErrorMessage}
          importStatus={app.importStatus}
          interactionLocked={app.workbenchInteractionLocked || cad.storageBusy}
          latestImport={app.latestImport}
          onCancelDxfImport={app.handleCancelDxfImport}
          onConfirmDxfImport={app.handleConfirmDxfImport}
          onDeleteProject={app.handleDeleteWorkbenchProject}
          onDeleteSavedRevisions={app.handleDeleteSavedRevisions}
          onRestoreProject={app.handleRestoreWorkbenchProject}
          onPurgeArchivedProject={app.handlePurgeArchivedWorkbenchProject}
          onDxfImportOverrideAcknowledgedChange={app.handleDxfImportOverrideAcknowledgedChange}
          onDxfImportUnitCandidateChange={app.handleDxfImportUnitCandidateChange}
          onExportUpidProject={app.handleExportUpidProject}
          onSaveUpidProjectAs={app.handleSaveUpidProjectAs}
          onImportDxfFile={app.handleImportDxfFile}
          onImportProgramFile={app.handleImportExternalProgram}
          onImportUpidFile={app.handleImportUpidFile}
          onOpenEditor={app.handleOpenEditor}
          onOpenCad={() => { try { cad.enter(); } catch (error) { app.showStatusToast(String(error), 'error'); } }}
          onOpenLatestImportInEditor={app.handleOpenLatestImportInEditor}
          onOpenProject={app.handleOpenWorkbenchProject}
          onRenameProject={app.handleRenameWorkbenchProject}
          pendingDxfImport={app.pendingDxfImport}
          programImportErrorMessage={app.editorImportErrorMessage}
          programImportStatus={app.editorImportStatus}
          workbenchStatus={app.workbenchStatus}
        />
      )}
      {cad.library && <CadLibraryDialog entries={cad.library} diagnostic={cad.libraryDiagnostic} busy={cad.storageBusy}
        onClose={cad.closeLibrary} onOpen={async id => { await cad.openDocument(id); }} />}
      {app.pendingDxfReimport && (
        <DxfImportConfirmationDialog
          cancellationBlocked={app.dxfWriting}
          declaredUnitOverrideAcknowledged={app.pendingDxfReimport.declaredUnitOverrideAcknowledged}
          errorMessage={app.dxfReimportErrorMessage}
          mode="reimport"
          onCancel={app.handleCancelDxfReimport}
          onConfirm={app.handleConfirmDxfReimport}
          onOverrideAcknowledgedChange={app.handleDxfReimportOverrideAcknowledgedChange}
          onRebuildAcknowledgedChange={app.handleDxfReimportRebuildAcknowledgedChange}
          onUnitCandidateChange={app.handleDxfReimportUnitCandidateChange}
          planningMachineFit={app.pendingDxfReimport.planningMachineFit}
          preparationResult={{ ok: true, preparation: app.pendingDxfReimport.preparation }}
          previewResult={app.pendingDxfReimport.previewResult}
          rebuildAcknowledged={app.pendingDxfReimport.rebuildAcknowledged}
          rebuildRequired={app.pendingDxfReimport.rebuildRequired}
          selectedUnitCandidateId={app.pendingDxfReimport.selectedUnitCandidateId}
          submitting={app.dxfReimportStatus === 'importing'}
        />
      )}
      <OnboardingDialog
        onDismiss={dismissOnboarding}
        open={onboardingOpen && app.workbenchStatus === 'ready'}
      />
    </AppShell>
  );
}
