import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from '@/app/AppShell';
import { StatusToastList, type StatusToast, type StatusToastType } from '@/components/StatusToasts';
import {
  importDxfProject,
  type ImportDxfProjectInput,
  type ImportDxfProjectResult
} from '@/domain/dxf/importDxfProject';
import {
  importExternalProgram,
  type ImportExternalProgramInput,
  type ImportExternalProgramResult
} from '@/domain/editor/importExternalProgram';
import {
  loadEditorProgram,
  type LoadedEditorProgram
} from '@/domain/editor/loadEditorProgram';
import {
  openWorkbenchProject,
  type OpenWorkbenchProjectResult
} from '@/domain/editor/openWorkbenchProject';
import {
  saveEditorProgram,
  type SaveEditorProgramInput
} from '@/domain/editor/saveEditorProgram';
import {
  downloadProgramFile,
  type DownloadProgramFileInput
} from '@/domain/post/downloadProgramFile';
import { connectCachedWorkbench } from '@/domain/storage/connectCachedWorkbench';
import { connectWorkbenchDirectory } from '@/domain/storage/connectWorkbenchDirectory';
import { supportsWorkbenchDirectoryAccess } from '@/domain/storage/fileSystemAccess';
import {
  updateWorkbenchSettings,
  type UpdateWorkbenchSettingsInput
} from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { EditorPage } from '@/features/editor/EditorPage';

type WorkbenchStatus = 'initializing' | 'ready' | 'switching-folder' | 'error';
type ImportStatus = 'idle' | 'importing' | 'error';
type SaveStatus = 'idle' | 'saving' | 'error';
type SettingsStatus = 'idle' | 'saving' | 'saved' | 'error';
type ActiveView = 'dashboard' | 'editor';

export interface AppServices {
  connectCachedWorkbench: () => Promise<ConnectedWorkbench>;
  connectWorkbenchDirectory: () => Promise<ConnectedWorkbench>;
  importDxfProject: (
    workbench: ConnectedWorkbench,
    input: ImportDxfProjectInput
  ) => Promise<ImportDxfProjectResult>;
  importExternalProgram: (
    workbench: ConnectedWorkbench,
    input: ImportExternalProgramInput
  ) => Promise<ImportExternalProgramResult>;
  loadEditorProgram: typeof loadEditorProgram;
  openWorkbenchProject: (
    workbench: ConnectedWorkbench,
    projectPath: string
  ) => Promise<OpenWorkbenchProjectResult>;
  saveEditorProgram: (
    workbench: ConnectedWorkbench,
    input: SaveEditorProgramInput
  ) => Promise<LoadedEditorProgram>;
  updateWorkbenchSettings: (
    workbench: ConnectedWorkbench,
    input: UpdateWorkbenchSettingsInput
  ) => Promise<ConnectedWorkbench>;
  downloadGeneratedProgram: (input: DownloadProgramFileInput) => void;
}

interface AppProps {
  services?: Partial<AppServices>;
}

const defaultAppServices: AppServices = {
  connectCachedWorkbench,
  connectWorkbenchDirectory,
  importDxfProject,
  importExternalProgram,
  loadEditorProgram,
  openWorkbenchProject,
  saveEditorProgram,
  updateWorkbenchSettings,
  downloadGeneratedProgram: downloadProgramFile
};

export default function App({ services }: AppProps = {}) {
  const appServices = useMemo(
    () => ({
      ...defaultAppServices,
      ...services
    }),
    [services]
  );
  const [workbenchStatus, setWorkbenchStatus] = useState<WorkbenchStatus>('initializing');
  const [connectedWorkbench, setConnectedWorkbench] = useState<ConnectedWorkbench | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [editorImportStatus, setEditorImportStatus] = useState<ImportStatus>('idle');
  const [editorImportErrorMessage, setEditorImportErrorMessage] = useState<string | null>(null);
  const [editorSaveStatus, setEditorSaveStatus] = useState<SaveStatus>('idle');
  const [editorSaveErrorMessage, setEditorSaveErrorMessage] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>('idle');
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [latestImport, setLatestImport] = useState<ImportDxfProjectResult | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [loadedEditorProgram, setLoadedEditorProgram] = useState<LoadedEditorProgram | null>(null);
  const [statusToasts, setStatusToasts] = useState<StatusToast[]>([]);
  const statusToastCounter = useRef(0);
  const directoryAccessAvailable = supportsWorkbenchDirectoryAccess();

  const dismissStatusToast = useCallback((id: string) => {
    setStatusToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showStatusToast = useCallback((message: string, type: StatusToastType = 'info') => {
    const id = `status-${Date.now()}-${++statusToastCounter.current}`;
    setStatusToasts((current) => [
      ...current.slice(-4),
      {
        id,
        message,
        type,
        durationMs: type === 'error' ? 8000 : 4500
      }
    ]);
  }, []);

  useEffect(() => {
    let isActive = true;

    appServices
      .connectCachedWorkbench()
      .then((workbench) => {
        if (!isActive) return;
        setConnectedWorkbench(workbench);
        setWorkbenchStatus('ready');
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setWorkbenchStatus('error');
        setErrorMessage(
          error instanceof Error ? error.message : 'Could not prepare browser cache workbench.'
        );
      });

    return () => {
      isActive = false;
    };
  }, [appServices]);

  async function handleConnectWorkbench() {
    if (!directoryAccessAvailable || workbenchStatus === 'switching-folder') return;

    setWorkbenchStatus('switching-folder');
    setErrorMessage(null);

    try {
      const workbench = await appServices.connectWorkbenchDirectory();
      setConnectedWorkbench(workbench);
      setSettingsStatus('idle');
      setSettingsErrorMessage(null);
      setWorkbenchStatus('ready');
      showStatusToast(`Workbench folder connected: ${workbench.manifest.name}`, 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setWorkbenchStatus(connectedWorkbench ? 'ready' : 'initializing');
        return;
      }

      setWorkbenchStatus('error');
      const message = error instanceof Error ? error.message : 'Could not connect workbench folder.';
      setErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  async function handleSaveWorkbenchSettings(input: UpdateWorkbenchSettingsInput) {
    if (!connectedWorkbench || settingsStatus === 'saving') return;

    setSettingsStatus('saving');
    setSettingsErrorMessage(null);

    try {
      const updatedWorkbench = await appServices.updateWorkbenchSettings(connectedWorkbench, input);
      setConnectedWorkbench(updatedWorkbench);
      setSettingsStatus('saved');
      showStatusToast('Workbench settings saved.', 'success');
    } catch (error) {
      setSettingsStatus('error');
      const message = error instanceof Error ? error.message : 'Could not save workbench settings.';
      setSettingsErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  async function handleImportDxfFile(file: File) {
    if (!connectedWorkbench || importStatus === 'importing') return;

    setImportStatus('importing');
    setImportErrorMessage(null);

    try {
      const text = await file.text();
      const result = await appServices.importDxfProject(connectedWorkbench, {
        fileName: file.name,
        text
      });
      const editorProgram = await appServices.loadEditorProgram(result.workbench, result.project);
      setConnectedWorkbench(result.workbench);
      setLatestImport(result);
      setLoadedEditorProgram(editorProgram);
      setEditorSaveStatus('idle');
      setEditorSaveErrorMessage(null);
      setEditorImportStatus('idle');
      setEditorImportErrorMessage(null);
      setActiveView('editor');
      setImportStatus('idle');
      showStatusToast(`DXF imported and opened: ${file.name}`, 'success');
    } catch (error) {
      setImportStatus('error');
      const message = error instanceof Error ? error.message : 'Could not import DXF.';
      setImportErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  function handleDownloadLatestProgram() {
    if (!latestImport) return;

    appServices.downloadGeneratedProgram({
      fileName:
        latestImport.project.generated.files.at(-1)?.name ?? `${latestImport.project.id}.gcode`,
      text: latestImport.generatedProgram
    });
    showStatusToast('Generated program downloaded.', 'success');
  }

  function handleDownloadEditorFile(fileName: string, text: string) {
    appServices.downloadGeneratedProgram({ fileName, text });
    showStatusToast(`Downloaded ${fileName}.`, 'success');
  }

  async function handleOpenLatestImportInEditor() {
    if (!latestImport) return;

    const editorProgram = await appServices.loadEditorProgram(
      latestImport.workbench,
      latestImport.project
    );
    setLoadedEditorProgram(editorProgram);
    setEditorSaveStatus('idle');
    setEditorSaveErrorMessage(null);
    setActiveView('editor');
    showStatusToast('Generated program opened in editor.', 'success');
  }

  async function handleOpenWorkbenchProject(projectPath: string) {
    if (!connectedWorkbench) return;

    try {
      const result = await appServices.openWorkbenchProject(connectedWorkbench, projectPath);
      setLoadedEditorProgram(result.editorProgram);
      setEditorSaveStatus('idle');
      setEditorSaveErrorMessage(null);
      setEditorImportStatus('idle');
      setEditorImportErrorMessage(null);
      setActiveView('editor');
      showStatusToast(`Project opened: ${result.project.name}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not open workbench project.';
      setErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  async function handleImportExternalProgram(file: File) {
    if (!connectedWorkbench || editorImportStatus === 'importing') return;

    setEditorImportStatus('importing');
    setEditorImportErrorMessage(null);

    try {
      const text = await file.text();
      const result = await appServices.importExternalProgram(connectedWorkbench, {
        fileName: file.name,
        text,
        byteLength: file.size
      });
      setConnectedWorkbench(result.workbench);
      setLoadedEditorProgram(result.editorProgram);
      setEditorSaveStatus('idle');
      setEditorSaveErrorMessage(null);
      setActiveView('editor');
      setEditorImportStatus('idle');
      showStatusToast(`Program imported: ${file.name}`, 'success');
    } catch (error) {
      setEditorImportStatus('error');
      const message = error instanceof Error ? error.message : 'Could not import program.';
      setEditorImportErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  async function handleSaveEditorProgram(text: string) {
    if (!connectedWorkbench || !loadedEditorProgram || editorSaveStatus === 'saving') return;

    setEditorSaveStatus('saving');
    setEditorSaveErrorMessage(null);

    try {
      const savedProgram = await appServices.saveEditorProgram(connectedWorkbench, {
        filePath: loadedEditorProgram.filePath,
        text
      });
      setLoadedEditorProgram(savedProgram);
      setEditorSaveStatus('idle');
      showStatusToast('Program saved.', 'success');
    } catch (error) {
      setEditorSaveStatus('error');
      const message = error instanceof Error ? error.message : 'Could not save editor program.';
      setEditorSaveErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  return (
    <AppShell
      connectedWorkbench={connectedWorkbench}
      directoryAccessAvailable={directoryAccessAvailable}
      errorMessage={errorMessage}
      workbenchStatus={workbenchStatus}
    >
      <StatusToastList onDismiss={dismissStatusToast} toasts={statusToasts} />
      {activeView === 'editor' ? (
        <EditorPage
          importErrorMessage={editorImportErrorMessage}
          importStatus={editorImportStatus}
          key={loadedEditorProgram?.filePath ?? 'empty-editor'}
          onBackToDashboard={() => setActiveView('dashboard')}
          onDownloadEditorFile={handleDownloadEditorFile}
          onImportProgramFile={handleImportExternalProgram}
          onSaveProgramText={handleSaveEditorProgram}
          onStatusMessage={showStatusToast}
          program={loadedEditorProgram}
          saveErrorMessage={editorSaveErrorMessage}
          saveStatus={editorSaveStatus}
        />
      ) : (
        <DashboardPage
          connectedWorkbench={connectedWorkbench}
          directoryAccessAvailable={directoryAccessAvailable}
          importErrorMessage={importErrorMessage}
          importStatus={importStatus}
          latestImport={latestImport}
          onConnectWorkbench={handleConnectWorkbench}
          onDownloadLatestProgram={handleDownloadLatestProgram}
          onImportDxfFile={handleImportDxfFile}
          onOpenEditor={() => setActiveView('editor')}
          onOpenLatestImportInEditor={handleOpenLatestImportInEditor}
          onOpenProject={handleOpenWorkbenchProject}
          onSaveWorkbenchSettings={handleSaveWorkbenchSettings}
          settingsErrorMessage={settingsErrorMessage}
          settingsStatus={settingsStatus}
          workbenchStatus={workbenchStatus}
        />
      )}
    </AppShell>
  );
}
