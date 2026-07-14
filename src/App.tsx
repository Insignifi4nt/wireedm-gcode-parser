import { AppShell } from '@/app/AppShell';
import { type AppServices } from '@/app/appServices';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { StatusToastList } from '@/components/StatusToasts';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DxfImportConfirmationDialog } from '@/features/dashboard/DxfImportConfirmationDialog';
import { EditorPage } from '@/features/editor/EditorPage';

interface AppProps {
  services?: Partial<AppServices>;
}

export default function App({ services }: AppProps = {}) {
  const app = useWorkbenchAppController(services);

  return (
    <AppShell
      connectedWorkbench={app.connectedWorkbench}
      errorMessage={app.errorMessage}
      interactionLocked={app.workbenchInteractionLocked}
      onAcknowledgeMachineProfile={app.handleAcknowledgeMachineProfile}
      onConnectWorkbench={app.handleConnectWorkbench}
      onCreateBlankMachineProfile={app.handleCreateBlankMachineProfile}
      onCreateRobofilV2CandidateProfile={app.handleCreateRobofilV2CandidateProfile}
      onDeleteMachineProfile={app.handleDeleteMachineProfile}
      onDuplicateMachineProfile={app.handleDuplicateMachineProfile}
      onExportMachineProfile={app.handleExportMachineProfile}
      onImportMachineProfileFile={app.handleImportMachineProfileFile}
      onSaveMachineProfile={app.handleSaveMachineProfile}
      onSaveWorkbenchSettings={app.handleSaveWorkbenchSettings}
      onSetDefaultMachineProfile={app.handleSetDefaultMachineProfile}
      settingsErrorMessage={app.settingsErrorMessage}
      settingsStatus={app.settingsStatus}
      storageSwitchDisabled={
        app.activeView === 'editor' || app.workbenchInteractionLocked
      }
      storageActionLabel={app.storageActionLabel}
      statusNotifications={app.statusNotifications}
      storageWarningMessage={app.storageWarningMessage}
      workbenchStatus={app.workbenchStatus}
    >
      <StatusToastList onDismiss={app.dismissStatusToast} toasts={app.statusToasts} />
      {app.activeView === 'editor' ? (
        <EditorPage
          interactionLocked={app.workbenchInteractionLocked}
          importErrorMessage={app.editorImportErrorMessage}
          importStatus={app.editorImportStatus}
          key={`${app.loadedEditorProgram?.filePath ?? 'empty-editor'}:${app.editorProgramRevision}`}
          onBackToDashboard={app.handleBackToDashboard}
          onDownloadEditorFile={app.handleDownloadEditorFile}
          onImportProgramFile={app.handleImportExternalProgram}
          onReimportDxfUnits={app.handlePrepareDxfReimport}
          onSaveEditorDraft={app.handleSaveEditorDraft}
          onStatusMessage={app.showStatusToast}
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
          pendingDxfImport={app.pendingDxfImport}
          onCancelDxfImport={app.handleCancelDxfImport}
          onConfirmDxfImport={app.handleConfirmDxfImport}
          onDxfImportMachineProfileChange={app.handleDxfImportMachineProfileChange}
          onDxfImportOverrideAcknowledgedChange={app.handleDxfImportOverrideAcknowledgedChange}
          onDxfImportUnitCandidateChange={app.handleDxfImportUnitCandidateChange}
          onImportDxfFile={app.handleImportDxfFile}
          onImportUpidFile={app.handleImportUpidFile}
          onImportProgramFile={app.handleImportExternalProgram}
          onDeleteProject={app.handleDeleteWorkbenchProject}
          onOpenEditor={app.handleOpenEditor}
          onOpenLatestImportInEditor={app.handleOpenLatestImportInEditor}
          onOpenProject={app.handleOpenWorkbenchProject}
          onExportUpidProject={app.handleExportUpidProject}
          onRenameProject={app.handleRenameWorkbenchProject}
          programImportErrorMessage={app.editorImportErrorMessage}
          programImportStatus={app.editorImportStatus}
          workbenchStatus={app.workbenchStatus}
        />
      )}
      {app.pendingDxfReimport && (
        <DxfImportConfirmationDialog
          declaredUnitOverrideAcknowledged={
            app.pendingDxfReimport.declaredUnitOverrideAcknowledged
          }
          errorMessage={app.dxfReimportErrorMessage}
          machineProfileLocked
          mode="reimport"
          onCancel={app.handleCancelDxfReimport}
          onConfirm={app.handleConfirmDxfReimport}
          onMachineProfileChange={() => undefined}
          onOverrideAcknowledgedChange={
            app.handleDxfReimportOverrideAcknowledgedChange
          }
          onRebuildAcknowledgedChange={
            app.handleDxfReimportRebuildAcknowledgedChange
          }
          onUnitCandidateChange={app.handleDxfReimportUnitCandidateChange}
          preparation={app.pendingDxfReimport.preparation}
          preview={app.pendingDxfReimport.preview}
          previewErrorMessage={app.pendingDxfReimport.previewErrorMessage}
          rebuildAcknowledged={app.pendingDxfReimport.rebuildAcknowledged}
          rebuildRequired={app.pendingDxfReimport.rebuildRequired}
          selection={app.pendingDxfReimport.selection}
          submitting={app.dxfReimportStatus === 'importing'}
          unitCandidates={app.pendingDxfReimport.unitCandidates}
        />
      )}
    </AppShell>
  );
}
