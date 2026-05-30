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
      directoryAccessAvailable={app.directoryAccessAvailable}
      errorMessage={app.errorMessage}
      workbenchStatus={app.workbenchStatus}
    >
      <StatusToastList onDismiss={app.dismissStatusToast} toasts={app.statusToasts} />
      {app.activeView === 'editor' ? (
        <EditorPage
          importErrorMessage={app.editorImportErrorMessage}
          importStatus={app.editorImportStatus}
          key={app.loadedEditorProgram?.filePath ?? 'empty-editor'}
          onBackToDashboard={app.handleBackToDashboard}
          onDownloadEditorFile={app.handleDownloadEditorFile}
          onImportProgramFile={app.handleImportExternalProgram}
          onSaveProgramText={app.handleSaveEditorProgram}
          onStatusMessage={app.showStatusToast}
          program={app.loadedEditorProgram}
          saveErrorMessage={app.editorSaveErrorMessage}
          saveStatus={app.editorSaveStatus}
        />
      ) : (
        <DashboardPage
          connectedWorkbench={app.connectedWorkbench}
          directoryAccessAvailable={app.directoryAccessAvailable}
          importErrorMessage={app.importErrorMessage}
          importStatus={app.importStatus}
          latestImport={app.latestImport}
          onConnectWorkbench={app.handleConnectWorkbench}
          onDownloadLatestProgram={app.handleDownloadLatestProgram}
          onImportDxfFile={app.handleImportDxfFile}
          onOpenEditor={app.handleOpenEditor}
          onOpenLatestImportInEditor={app.handleOpenLatestImportInEditor}
          onOpenProject={app.handleOpenWorkbenchProject}
          onSaveWorkbenchSettings={app.handleSaveWorkbenchSettings}
          settingsErrorMessage={app.settingsErrorMessage}
          settingsStatus={app.settingsStatus}
          workbenchStatus={app.workbenchStatus}
        />
      )}
    </AppShell>
  );
}
