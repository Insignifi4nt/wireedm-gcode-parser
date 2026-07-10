import { AppShell } from '@/app/AppShell';
import { type AppServices } from '@/app/appServices';
import { useWorkbenchAppController } from '@/app/useWorkbenchAppController';
import { StatusToastList } from '@/components/StatusToasts';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
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
      onConnectWorkbench={app.handleConnectWorkbench}
      onSaveWorkbenchSettings={app.handleSaveWorkbenchSettings}
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
          key={app.loadedEditorProgram?.filePath ?? 'empty-editor'}
          onBackToDashboard={app.handleBackToDashboard}
          onDownloadEditorFile={app.handleDownloadEditorFile}
          onImportProgramFile={app.handleImportExternalProgram}
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
          onImportDxfFile={app.handleImportDxfFile}
          onImportProgramFile={app.handleImportExternalProgram}
          onDeleteProject={app.handleDeleteWorkbenchProject}
          onOpenEditor={app.handleOpenEditor}
          onOpenLatestImportInEditor={app.handleOpenLatestImportInEditor}
          onOpenProject={app.handleOpenWorkbenchProject}
          onRenameProject={app.handleRenameWorkbenchProject}
          programImportErrorMessage={app.editorImportErrorMessage}
          programImportStatus={app.editorImportStatus}
          workbenchStatus={app.workbenchStatus}
        />
      )}
    </AppShell>
  );
}
