import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { StatusToast, StatusToastType } from '@/components/StatusToasts';
import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import { supportsWorkbenchDirectoryAccess } from '@/domain/storage/fileSystemAccess';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { defaultAppServices, type AppServices } from './appServices';

export type WorkbenchStatus = 'initializing' | 'ready' | 'connecting-storage' | 'error';
export type ImportStatus = 'idle' | 'importing' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'error';
export type SettingsStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ActiveView = 'dashboard' | 'editor';
type WorkbenchOperationKind =
  | 'dxf-import'
  | 'editor-import'
  | 'editor-save'
  | 'project-delete'
  | 'project-open'
  | 'project-rename'
  | 'settings-save'
  | 'storage-switch';
const WORKBENCH_BUSY_MESSAGE = 'Another workbench operation is still in progress.';

export interface WorkbenchAppController {
  activeView: ActiveView;
  connectedWorkbench: ConnectedWorkbench | null;
  editorImportErrorMessage: string | null;
  editorImportStatus: ImportStatus;
  editorSaveErrorMessage: string | null;
  editorSaveStatus: SaveStatus;
  workbenchInteractionLocked: boolean;
  errorMessage: string | null;
  importErrorMessage: string | null;
  importStatus: ImportStatus;
  storageActionLabel: string | null;
  storageWarningMessage: string | null;
  latestImport: ImportDxfProjectResult | null;
  loadedEditorProgram: LoadedEditorProgram | null;
  settingsErrorMessage: string | null;
  settingsStatus: SettingsStatus;
  statusNotifications: StatusToast[];
  statusToasts: StatusToast[];
  workbenchStatus: WorkbenchStatus;
  dismissStatusToast: (id: string) => void;
  handleBackToDashboard: () => void;
  handleConnectWorkbench: () => Promise<void>;
  handleDownloadEditorFile: (fileName: string, text: string) => void;
  handleImportDxfFile: (file: File) => Promise<void>;
  handleImportExternalProgram: (file: File) => Promise<void>;
  handleOpenEditor: () => void;
  handleOpenLatestImportInEditor: () => Promise<void>;
  handleOpenWorkbenchProject: (projectPath: string) => Promise<void>;
  handleDeleteWorkbenchProject: (projectId: string) => Promise<void>;
  handleRenameWorkbenchProject: (projectId: string, name: string) => Promise<void>;
  handleSaveEditorDraft: (draft: EditorSaveDraft) => Promise<void>;
  handleSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => Promise<void>;
  showStatusToast: (message: string, type?: StatusToastType) => void;
}

export function useWorkbenchAppController(
  services?: Partial<AppServices>
): WorkbenchAppController {
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
  const [storageActionLabel, setStorageActionLabel] = useState<string | null>(null);
  const [storageWarningMessage, setStorageWarningMessage] = useState<string | null>(null);
  const [latestImport, setLatestImport] = useState<ImportDxfProjectResult | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [loadedEditorProgram, setLoadedEditorProgram] = useState<LoadedEditorProgram | null>(null);
  const [statusNotifications, setStatusNotifications] = useState<StatusToast[]>([]);
  const [statusToasts, setStatusToasts] = useState<StatusToast[]>([]);
  const [activeWorkbenchOperation, setActiveWorkbenchOperation] =
    useState<WorkbenchOperationKind | null>(null);
  const workbenchOperationRef = useRef<{ id: number; kind: WorkbenchOperationKind } | null>(null);
  const workbenchOperationCounter = useRef(0);
  const statusToastCounter = useRef(0);

  const dismissStatusToast = useCallback((id: string) => {
    setStatusToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showStatusToast = useCallback((message: string, type: StatusToastType = 'info') => {
    const id = `status-${Date.now()}-${++statusToastCounter.current}`;
    const toast = {
      createdAt: Date.now(),
      durationMs: type === 'error' ? 6500 : 3500,
      id,
      message,
      type
    };
    setStatusToasts((current) => [toast, ...current].slice(0, 3));
    setStatusNotifications((current) => [toast, ...current].slice(0, 25));
  }, []);

  useEffect(() => {
    let isActive = true;

    async function prepareWorkbench() {
      const rememberedDirectory = await appServices.connectRememberedWorkbenchDirectory();
      if (!isActive) return;

      if (rememberedDirectory.status === 'connected') {
        setConnectedWorkbench(rememberedDirectory.workbench);
        setWorkbenchStatus('ready');
        setStorageActionLabel(null);
        setStorageWarningMessage(null);
        return;
      }

      const workbench = await appServices.connectCachedWorkbench();
      if (!isActive) return;

      setConnectedWorkbench(workbench);
      setWorkbenchStatus('ready');
      const warning = getStorageFallbackWarning(rememberedDirectory.status);
      setStorageWarningMessage(warning.message);
      setStorageActionLabel(warning.actionLabel);
    }

    prepareWorkbench()
      .then(() => {
        if (!isActive) return;
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setWorkbenchStatus('error');
        setErrorMessage(
          error instanceof Error ? error.message : 'Could not prepare local storage workbench.'
        );
      });

    return () => {
      isActive = false;
    };
  }, [appServices]);

  async function handleConnectWorkbench() {
    if (activeView === 'editor' || workbenchStatus === 'connecting-storage') return;
    const operationId = beginWorkbenchOperation('storage-switch');
    if (operationId === null) return;

    setWorkbenchStatus('connecting-storage');
    setErrorMessage(null);

    try {
      const workbench = await appServices.connectWorkbenchDirectory();
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(workbench);
      setLoadedEditorProgram(null);
      setLatestImport(null);
      resetEditorLoadState();
      setActiveView('dashboard');
      setSettingsStatus('idle');
      setSettingsErrorMessage(null);
      setStorageActionLabel(null);
      setStorageWarningMessage(null);
      setWorkbenchStatus('ready');
      showStatusToast(`Workbench folder connected: ${workbench.manifest.name}`, 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
        return;
      }

      setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
      const message = error instanceof Error ? error.message : 'Could not connect workbench folder.';
      setErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleSaveWorkbenchSettings(input: UpdateWorkbenchSettingsInput) {
    if (!connectedWorkbench || settingsStatus === 'saving') return;
    const operationId = beginWorkbenchOperation('settings-save');
    if (operationId === null) return;

    setSettingsStatus('saving');
    setSettingsErrorMessage(null);

    try {
      const updatedWorkbench = await appServices.updateWorkbenchSettings(connectedWorkbench, input);
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(updatedWorkbench);
      setSettingsStatus('saved');
      showStatusToast('Workbench settings saved.', 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setSettingsStatus('error');
      const message = error instanceof Error ? error.message : 'Could not save workbench settings.';
      setSettingsErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleImportDxfFile(file: File) {
    if (!connectedWorkbench || importStatus === 'importing') return;
    const operationId = beginWorkbenchOperation('dxf-import');
    if (operationId === null) return;

    setImportStatus('importing');
    setImportErrorMessage(null);

    try {
      const text = await file.text();
      const result = await appServices.importDxfProject(connectedWorkbench, {
        fileName: file.name,
        text
      });
      const editorProgram = await appServices.loadEditorProgram(result.workbench, result.project);
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      setLatestImport(result);
      setLoadedEditorProgram(editorProgram);
      resetEditorLoadState();
      setActiveView('editor');
      setImportStatus('idle');
      showStatusToast(`DXF imported and opened: ${file.name}`, 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setImportStatus('error');
      const message = error instanceof Error ? error.message : 'Could not import DXF.';
      setImportErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  function handleDownloadEditorFile(fileName: string, text: string) {
    appServices.downloadGeneratedProgram({ fileName, text });
    showStatusToast(`Downloaded ${fileName}.`, 'success');
  }

  async function handleOpenLatestImportInEditor() {
    if (!latestImport) return;
    const operationId = beginWorkbenchOperation('project-open');
    if (operationId === null) return;
    const activeImport = latestImport;

    try {
      const editorProgram = await appServices.loadEditorProgram(
        activeImport.workbench,
        activeImport.project
      );
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setLoadedEditorProgram(editorProgram);
      resetEditorLoadState();
      setActiveView('editor');
      showStatusToast('Path project opened in editor.', 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      const message = error instanceof Error ? error.message : 'Could not open the latest path project.';
      setErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleOpenWorkbenchProject(projectPath: string) {
    if (!connectedWorkbench) return;
    const operationId = beginWorkbenchOperation('project-open');
    if (operationId === null) return;
    const workbench = connectedWorkbench;

    try {
      const result = await appServices.openWorkbenchProject(workbench, projectPath);
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setLoadedEditorProgram(result.editorProgram);
      resetEditorLoadState();
      setActiveView('editor');
      showStatusToast(`Project opened: ${result.project.name}`, 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      const message = error instanceof Error ? error.message : 'Could not open workbench project.';
      setErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleRenameWorkbenchProject(projectId: string, name: string) {
    if (!connectedWorkbench) {
      throw new Error('Workbench is not connected.');
    }
    const operationId = beginWorkbenchOperation('project-rename');
    if (operationId === null) throw new Error(WORKBENCH_BUSY_MESSAGE);
    const workbench = connectedWorkbench;

    try {
      const result = await appServices.renameWorkbenchProject(workbench, {
        projectId,
        name
      });
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      reconcileProjectMutation(result.workbench, result.project);
      showStatusToast(`Project renamed: ${result.project.name}`, 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      const message = error instanceof Error ? error.message : 'Could not rename workbench project.';
      showStatusToast(message, 'error');
      throw error instanceof Error ? error : new Error(message);
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleDeleteWorkbenchProject(projectId: string) {
    if (!connectedWorkbench) {
      throw new Error('Workbench is not connected.');
    }
    const operationId = beginWorkbenchOperation('project-delete');
    if (operationId === null) throw new Error(WORKBENCH_BUSY_MESSAGE);
    const workbench = connectedWorkbench;

    try {
      const result = await appServices.deleteWorkbenchProject(workbench, {
        projectId
      });
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      removeDeletedProjectState(result.project.id);
      if (result.cleanupErrorMessages.length > 0) {
        const fileLabel = result.cleanupErrorMessages.length === 1 ? 'owned file' : 'owned files';
        showStatusToast(
          `Project removed, but ${result.cleanupErrorMessages.length} ${fileLabel} could not be deleted.`,
          'error'
        );
      } else {
        showStatusToast(`Project deleted: ${result.project.name}`, 'success');
      }
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      const message = error instanceof Error ? error.message : 'Could not delete workbench project.';
      showStatusToast(message, 'error');
      throw error instanceof Error ? error : new Error(message);
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleImportExternalProgram(file: File) {
    if (!connectedWorkbench || editorImportStatus === 'importing') return;
    const operationId = beginWorkbenchOperation('editor-import');
    if (operationId === null) return;

    setEditorImportStatus('importing');
    setEditorImportErrorMessage(null);

    try {
      const text = await file.text();
      const result = await appServices.importExternalProgram(connectedWorkbench, {
        fileName: file.name,
        text,
        byteLength: file.size
      });
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      setLoadedEditorProgram(result.editorProgram);
      setEditorSaveStatus('idle');
      setEditorSaveErrorMessage(null);
      setActiveView('editor');
      setEditorImportStatus('idle');
      showStatusToast(`Program imported: ${file.name}`, 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setEditorImportStatus('error');
      const message = error instanceof Error ? error.message : 'Could not import program.';
      setEditorImportErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleSaveEditorDraft(draft: EditorSaveDraft) {
    if (!connectedWorkbench || !loadedEditorProgram || editorSaveStatus === 'saving') return;
    const operationId = beginWorkbenchOperation('editor-save');
    if (operationId === null) return;
    const workbench = connectedWorkbench;
    const editorProgram = loadedEditorProgram;

    setEditorSaveStatus('saving');
    setEditorSaveErrorMessage(null);

    try {
      const result = await appServices.saveEditorProgram(workbench, {
        filePath: editorProgram.filePath,
        ...draft,
        project: editorProgram.project
      });
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      setLoadedEditorProgram(result.editorProgram);
      refreshLatestImportAfterSave(result.workbench, result.editorProgram);
      setEditorSaveStatus('idle');
      showStatusToast(draft.model === 'upid-document' ? 'Path plan saved.' : 'Program saved.', 'success');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setEditorSaveStatus('error');
      const message = error instanceof Error ? error.message : 'Could not save editor program.';
      setEditorSaveErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  function beginWorkbenchOperation(kind: WorkbenchOperationKind) {
    if (workbenchOperationRef.current !== null) return null;

    const id = ++workbenchOperationCounter.current;
    workbenchOperationRef.current = { id, kind };
    setActiveWorkbenchOperation(kind);
    return id;
  }

  function isCurrentWorkbenchOperation(id: number) {
    return workbenchOperationRef.current?.id === id;
  }

  function finishWorkbenchOperation(id: number) {
    if (!isCurrentWorkbenchOperation(id)) return;
    workbenchOperationRef.current = null;
    setActiveWorkbenchOperation(null);
  }

  function resetEditorLoadState() {
    setEditorSaveStatus('idle');
    setEditorSaveErrorMessage(null);
    setEditorImportStatus('idle');
    setEditorImportErrorMessage(null);
  }

  function refreshLatestImportAfterSave(
    workbench: ConnectedWorkbench,
    editorProgram: LoadedEditorProgram
  ) {
    setLatestImport((current) => {
      if (!current || current.project.id !== editorProgram.project?.id) return current;
      if (editorProgram.model !== 'upid-document' || !editorProgram.project.upid) return null;

      return {
        ...current,
        workbench,
        project: editorProgram.project,
        pathDocument: editorProgram.pathDocument,
        pathDiagnostics: editorProgram.pathDocument.diagnostics
      };
    });
  }

  function reconcileProjectMutation(
    workbench: ConnectedWorkbench,
    project: { id: string; name: string; updatedAt: string }
  ) {
    setLoadedEditorProgram((current) =>
      current && current.project?.id === project.id
        ? {
            ...current,
            project: current.project
              ? {
                  ...current.project,
                  name: project.name,
                  updatedAt: project.updatedAt
                }
              : current.project
          }
        : current
    );

    setLatestImport((current) =>
      current && current.project.id === project.id
        ? {
            ...current,
            workbench,
            project: {
              ...current.project,
              name: project.name,
              updatedAt: project.updatedAt
            }
          }
        : current
    );
  }

  function removeDeletedProjectState(projectId: string) {
    setLoadedEditorProgram((current) => {
      if (!current || current.project?.id !== projectId) return current;
      return null;
    });
    setLatestImport((current) => {
      if (!current || current.project.id !== projectId) return current;
      return null;
    });
    setEditorSaveStatus('idle');
    setEditorSaveErrorMessage(null);
    setActiveView((current) => (current === 'editor' ? 'dashboard' : current));
  }

  return {
    activeView,
    connectedWorkbench,
    editorImportErrorMessage,
    editorImportStatus,
    workbenchInteractionLocked: activeWorkbenchOperation !== null,
    editorSaveErrorMessage,
    editorSaveStatus,
    errorMessage,
    importErrorMessage,
    importStatus,
    storageActionLabel,
    storageWarningMessage,
    latestImport,
    loadedEditorProgram,
    settingsErrorMessage,
    settingsStatus,
    statusNotifications,
    statusToasts,
    workbenchStatus,
    dismissStatusToast,
    handleBackToDashboard: () => {
      if (workbenchOperationRef.current !== null) return;
      setActiveView('dashboard');
    },
    handleConnectWorkbench,
    handleDownloadEditorFile,
    handleImportDxfFile,
    handleImportExternalProgram,
    handleOpenEditor: () => {
      if (workbenchOperationRef.current !== null) return;
      setActiveView('editor');
    },
    handleOpenLatestImportInEditor,
    handleOpenWorkbenchProject,
    handleDeleteWorkbenchProject,
    handleRenameWorkbenchProject,
    handleSaveEditorDraft,
    handleSaveWorkbenchSettings,
    showStatusToast
  };
}

function getStorageFallbackWarning(status: 'missing' | 'permission-needed' | 'unsupported' | 'error') {
  if (status === 'unsupported' || !supportsWorkbenchDirectoryAccess()) {
    return {
      actionLabel: null,
      message: 'This browser does not support choosing a workbench folder. Browser cache is active.'
    };
  }

  if (status === 'permission-needed') {
    return {
      actionLabel: 'Reconnect Workbench Folder',
      message:
        'Workbench folder permission needs to be renewed. Browser cache is active until you reconnect.'
    };
  }

  if (status === 'error') {
    return {
      actionLabel: 'Choose Workbench Folder',
      message:
        'Could not reconnect the remembered workbench folder. Browser cache is active until you choose a folder again.'
    };
  }

  return {
    actionLabel: 'Choose Workbench Folder',
    message: 'Choose a workbench folder to store files on disk. Browser cache is active until then.'
  };
}
