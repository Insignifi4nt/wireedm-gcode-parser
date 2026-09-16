import { useState } from 'react';

import { AppShell } from '@/app/AppShell';
import { type AppServices } from '@/app/appServices';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { StatusToastList } from '@/components/StatusToasts';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DxfImportConfirmationDialog } from '@/features/dashboard/DxfImportConfirmationDialog';
import { EditorPage } from '@/features/editor/EditorPage';
import { OnboardingDialog } from '@/features/onboarding/OnboardingDialog';
import {
  hasDismissedOnboarding,
  rememberOnboardingDismissal
} from '@/features/onboarding/onboardingPreference';

interface AppProps {
  services?: Partial<AppServices>;
}

export default function App({ services }: AppProps = {}) {
  const [onboardingOpen, setOnboardingOpen] = useState(() => !hasDismissedOnboarding());
  const app = useWorkbenchAppController(services);
  const planningMachineId = app.connectedWorkbench?.manifest.preferences.recentPlanningMachineId;
  const planningMachine = app.connectedWorkbench?.machines.machines.find(
    ({ id }) => id === planningMachineId
  ) ?? null;

  function dismissOnboarding() {
    setOnboardingOpen(false);
    rememberOnboardingDismissal();
  }

  return (
    <AppShell
      connectedWorkbench={app.connectedWorkbench}
      errorMessage={app.errorMessage}
      interactionLocked={app.workbenchInteractionLocked}
      onConnectWorkbench={app.handleConnectWorkbench}
      onUseBrowserCache={app.handleUseBrowserCache}
      onActivateMachineSetup={app.handleActivateMachineSetup}
      onCommitMachinePackage={app.handleCommitMachinePackage}
      onPrepareMachinePackage={app.handlePrepareMachinePackage}
      onRemoveMachineDefinition={app.handleRemoveMachineDefinition}
      onSaveCatalogPreferences={app.handleSaveCatalogPreferences}
      settingsErrorMessage={app.settingsErrorMessage}
      settingsStatus={app.settingsStatus}
      statusNotifications={app.statusNotifications}
      storageActionLabel={app.storageActionLabel}
      storageSwitchDisabled={app.activeView === 'editor' || app.workbenchInteractionLocked}
      storageWarningMessage={app.storageWarningMessage}
      workbenchStatus={app.workbenchStatus}
    >
      <StatusToastList onDismiss={app.dismissStatusToast} toasts={app.statusToasts} />
      {app.workbenchStatus === 'error' && !app.connectedWorkbench ? (
        <section className="grid h-full place-items-center p-6" role="alert">
          <div className="max-w-2xl border border-destructive bg-destructive/10 p-4 font-mono text-xs text-destructive">
            <h1 className="mb-2 font-sans text-sm font-semibold">Workbench could not be opened</h1>
            <p>{app.errorMessage ?? 'The workbench failed without a diagnostic.'}</p>
          </div>
        </section>
      ) : app.activeView === 'editor' && app.connectedWorkbench ? (
        <EditorPage
          importErrorMessage={app.editorImportErrorMessage}
          importStatus={app.editorImportStatus}
          interactionLocked={app.workbenchInteractionLocked}
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
        />
      ) : (
        <DashboardPage
          connectedWorkbench={app.connectedWorkbench}
          importErrorMessage={app.importErrorMessage}
          importStatus={app.importStatus}
          interactionLocked={app.workbenchInteractionLocked}
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
          onOpenLatestImportInEditor={app.handleOpenLatestImportInEditor}
          onOpenProject={app.handleOpenWorkbenchProject}
          onRenameProject={app.handleRenameWorkbenchProject}
          pendingDxfImport={app.pendingDxfImport}
          programImportErrorMessage={app.editorImportErrorMessage}
          programImportStatus={app.editorImportStatus}
          workbenchStatus={app.workbenchStatus}
        />
      )}
      {app.pendingDxfReimport && (
        <DxfImportConfirmationDialog
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
