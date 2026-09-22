import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ToolError } from '@/features/webmcp/siteTools';

import type { StatusToast, StatusToastType } from '@/components/StatusToasts';
import {
  dxfProjectReimportRequiresRebuild,
  type DxfProjectReimportPreparation
} from '@/domain/dxf/reimportDxfProjectUnits';
import type { ImportedDxfProject } from '@/domain/dxf/importDxfProject';
import type { DxfImportPreviewResult } from '@/domain/dxf/prepareDxfProjectImport';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import { evaluatePhysicalMachineEnvelopeFit } from '@/domain/machine-definition/machineFit';
import type {
  MachinePackageInstallationResolution,
  PreparedMachinePackageInstallation,
  PrepareStoredMachinePackageInstallationResult
} from '@/domain/machine-package';
import { MAX_MACHINE_PACKAGE_ARCHIVE_BYTES } from '@/domain/machine-package';
import type { DownloadProgramFileInput } from '@/domain/post/downloadProgramFile';
import { selectTextFileDestination, writeSelectedTextFile } from '@/domain/post/saveTextFileAs';
import { MAX_PORTABLE_UPID_BYTES, portableFileBaseName } from '@/domain/upid/portableUpidProject';
import {
  createSavedWireEdmJobRevisionId,
  type ControllerArtifactResult
} from '@/domain/wire-edm-job';
import type {
  ConnectedWorkbenchCatalog,
  WorkbenchCatalogManifest
} from '@/domain/workbench-catalog/workbenchCatalog';
import type {
  PendingDashboardDxfImport,
  ResolvedPlanningMachineFit
} from '@/features/dashboard/dashboardTypes';

import { defaultAppServices, type AppServices } from './appServices';

export type WorkbenchStatus = 'initializing' | 'ready' | 'connecting-storage' | 'error';
export type ImportStatus = 'idle' | 'importing' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'error';
export type SettingsStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ActiveView = 'dashboard' | 'editor';

interface PendingDxfReimport {
  readonly preparation: DxfProjectReimportPreparation;
  readonly selectedUnitCandidateId: string | null;
  readonly previewResult: DxfImportPreviewResult | null;
  readonly declaredUnitOverrideAcknowledged: boolean;
  readonly rebuildAcknowledged: boolean;
  readonly rebuildRequired: boolean;
  readonly planningMachineFit: ResolvedPlanningMachineFit | null;
}

export function useWorkbenchAppController(overrides: Partial<AppServices> = {}, getEditorState?: () => { dirty: boolean; workflowOpen: boolean; workflowCommand?: string } | null) {
  const [services] = useState<AppServices>(() => ({ ...defaultAppServices, ...overrides }));
  const [workbenchStatus, setWorkbenchStatus] = useState<WorkbenchStatus>('initializing');
  const [connectedWorkbench, setConnectedWorkbench] = useState<ConnectedWorkbenchCatalog | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [storageWarningMessage, setStorageWarningMessage] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [loadedEditorProgram, setLoadedEditorProgram] = useState<LoadedEditorProgram | null>(null);
  const [editorProgramRevision, setEditorProgramRevision] = useState(0);
  const [pendingDxfImport, setPendingDxfImport] = useState<PendingDashboardDxfImport | null>(null);
  const [pendingDxfReimport, setPendingDxfReimport] = useState<PendingDxfReimport | null>(null);
  const [latestImport, setLatestImport] = useState<ImportedDxfProject | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importErrorMessage, setImportErrorMessage] = useState<string | null>(null);
  const [editorImportStatus, setEditorImportStatus] = useState<ImportStatus>('idle');
  const [editorImportErrorMessage, setEditorImportErrorMessage] = useState<string | null>(null);
  const [editorSaveStatus, setEditorSaveStatus] = useState<SaveStatus>('idle');
  const [editorSaveErrorMessage, setEditorSaveErrorMessage] = useState<string | null>(null);
  const [dxfReimportStatus, setDxfReimportStatus] = useState<ImportStatus>('idle');
  const [dxfReimportErrorMessage, setDxfReimportErrorMessage] = useState<string | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<SettingsStatus>('idle');
  const [settingsErrorMessage, setSettingsErrorMessage] = useState<string | null>(null);
  const [controllerArtifactGenerating, setControllerArtifactGenerating] = useState(false);
  const [projectOpening, setProjectOpening] = useState(false);
  const [projectActionPending, setProjectActionPending] = useState(false);
  const [statusToasts, setStatusToasts] = useState<StatusToast[]>([]);
  const [statusNotifications, setStatusNotifications] = useState<StatusToast[]>([]);
  const initializationStarted = useRef(false);
  const activeMutation = useRef<'controller-artifact' | 'editor-save' | 'program-import' | 'project-open' | 'storage-connect' | 'project-action' | null>(null);
  const toastSequence = useRef(0);

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    void initialize();
  }, []);

  async function initialize() {
    try {
      const remembered = await services.connectRememberedWorkbenchDirectory();
      if ('ok' in remembered) {
        if (!remembered.ok) return failWorkbench(remembered.error.message);
        return readyWorkbench(remembered.workbench, null);
      }
      if (remembered.status === 'error') return failWorkbench(remembered.message);
      const cached = await services.connectCachedWorkbench();
      if (!cached.ok) return failWorkbench(cached.error.message);
      const warning = remembered.status === 'permission-needed'
        ? 'The remembered folder needs permission. Browser storage is active. Choose Workbench Folder to reconnect it or select another folder.'
        : remembered.status === 'unsupported'
          ? 'Folder access is unavailable in this browser. Browser storage is active.'
          : null;
      readyWorkbench(cached.workbench, warning);
    } catch (error) {
      failWorkbench(errorText(error));
    }
  }

  function readyWorkbench(workbench: ConnectedWorkbenchCatalog, warning: string | null) {
    setConnectedWorkbench(workbench);
    setStorageWarningMessage(workbench.adapter.persistenceWarning ?? warning);
    setErrorMessage(null);
    setWorkbenchStatus('ready');
  }

  function failWorkbench(message: string) {
    setConnectedWorkbench(null);
    setErrorMessage(message);
    setWorkbenchStatus('error');
  }

  function requireWorkbench() {
    return connectedWorkbench ?? null;
  }

  function showStatusToast(message: string, type: StatusToastType = 'info') {
    const id = `status-${++toastSequence.current}`;
    const toast: StatusToast = {
      id,
      message,
      type,
      createdAt: Date.now(),
      durationMs: type === 'error' ? undefined : 4500
    };
    setStatusToasts((current) => [...current.slice(-19), toast]);
    setStatusNotifications((current) => [toast, ...current].slice(0, 100));
  }

  function dismissStatusToast(id: string) {
    setStatusToasts((current) => current.filter((toast) => toast.id !== id));
  }

  async function handleConnectWorkbench() {
    if (activeMutation.current) return;
    activeMutation.current = 'storage-connect';
    setWorkbenchStatus('connecting-storage');
    setErrorMessage(null);
    try {
      const connected = await services.connectWorkbenchDirectory();
      if (!connected.ok) {
        setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
        setErrorMessage(connected.error.message);
        return;
      }
      readyWorkbench(connected.workbench, null);
      setLatestImport(null);
      handleBackToDashboard();
      handleCancelDxfImport();
      handleCancelDxfReimport();
      showStatusToast('Workbench folder connected.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
        return;
      }
      setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
      setErrorMessage(errorText(error));
    } finally {
      activeMutation.current = null;
    }
  }

  async function handleUseBrowserCache() {
    if (activeMutation.current || interactionLocked || activeView === 'editor') return;
    activeMutation.current = 'storage-connect';
    setWorkbenchStatus('connecting-storage');
    setErrorMessage(null);
    try {
      const cached = await services.connectCachedWorkbench();
      if (!cached.ok) throw new Error(cached.error.message);
      await services.forgetWorkbenchDirectory();
      readyWorkbench(cached.workbench, null);
      setLatestImport(null);
      handleBackToDashboard();
      handleCancelDxfImport();
      handleCancelDxfReimport();
      showStatusToast('Browser cache active. Folder projects remain in their folder.', 'success');
    } catch (error) {
      setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
      setErrorMessage(errorText(error));
    } finally {
      activeMutation.current = null;
    }
  }

  async function handleImportDxfFile(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return setImportFailure('Connect a valid workbench before importing DXF.');
    setImportStatus('importing');
    setImportErrorMessage(null);
    try {
      const preparationResult = services.prepareDxfProjectImport(workbench, {
        fileName: file.name,
        text: await file.text()
      });
      if (!preparationResult.ok) return setImportFailure(preparationResult.error.message);
      const selectedUnitCandidateId = preparationResult.preparation.defaultUnitCandidateId;
      const previewResult = selectedUnitCandidateId
        ? services.previewDxfProjectImport(preparationResult.preparation, { unitCandidateId: selectedUnitCandidateId })
        : null;
      setPendingDxfImport({
        preparationResult,
        selectedUnitCandidateId,
        previewResult,
        declaredUnitOverrideAcknowledged: false,
        planningMachineFit: resolvePlanningMachineFit(workbench, previewResult)
      });
      setImportStatus('idle');
    } catch (error) {
      setImportFailure(errorText(error));
    }
  }

  function handleDxfImportUnitCandidateChange(candidateId: string) {
    setPendingDxfImport((pending) => {
      if (!pending?.preparationResult.ok) return pending;
      const previewResult = services.previewDxfProjectImport(
        pending.preparationResult.preparation,
        { unitCandidateId: candidateId }
      );
      return {
        ...pending,
        selectedUnitCandidateId: candidateId,
        previewResult,
        declaredUnitOverrideAcknowledged: false,
        planningMachineFit: connectedWorkbench
          ? resolvePlanningMachineFit(connectedWorkbench, previewResult)
          : null
      };
    });
  }

  function handleDxfImportOverrideAcknowledgedChange(acknowledged: boolean) {
    setPendingDxfImport((pending) => pending
      ? { ...pending, declaredUnitOverrideAcknowledged: acknowledged }
      : null);
  }

  function handleCancelDxfImport() {
    setPendingDxfImport(null);
    setImportStatus('idle');
    setImportErrorMessage(null);
  }

  async function handleConfirmDxfImport() {
    const workbench = requireWorkbench();
    const pending = pendingDxfImport;
    if (!workbench || !pending?.preparationResult.ok) {
      return setImportFailure('The reviewed DXF import is unavailable.');
    }
    if (!pending.selectedUnitCandidateId) {
      return setImportFailure('Select an explicit DXF unit interpretation.');
    }
    setImportStatus('importing');
    try {
      const imported = await services.commitDxfProjectImport(
        workbench,
        pending.preparationResult.preparation,
        {
          unitCandidateId: pending.selectedUnitCandidateId,
          confirmed: true,
          declaredUnitOverrideAcknowledged: pending.declaredUnitOverrideAcknowledged
        }
      );
      if (!imported.ok) return setImportFailure(imported.error.message);
      setConnectedWorkbench(imported.workbench);
      setLatestImport(imported);
      setPendingDxfImport(null);
      const loaded = await services.loadEditorProgram(imported.workbench, imported.project.id);
      setImportStatus('idle');
      if (!loaded.ok) {
        showStatusToast(
          `DXF was committed, but its editor document could not be opened: ${loaded.error.message}`,
          'error'
        );
        return;
      }
      openEditorProgram(loaded.editorProgram);
      showStatusToast(`Imported ${imported.project.name}.`, 'success');
    } catch (error) {
      setImportFailure(errorText(error));
    }
  }

  async function handleImportUpidFile(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return setImportFailure('Connect a valid workbench before importing UPID.');
    if (file.size > MAX_PORTABLE_UPID_BYTES) {
      return setImportFailure('Portable UPID files must be 64 MiB or smaller.');
    }
    setImportStatus('importing');
    setImportErrorMessage(null);
    try {
      const imported = await services.importPortableUpidProject(workbench, {
        fileName: file.name,
        text: await file.text()
      });
      if (!imported.ok) return setImportFailure(imported.error.message);
      setConnectedWorkbench(imported.workbench);
      const loaded = await services.loadEditorProgram(imported.workbench, imported.project.id);
      setImportStatus('idle');
      if (!loaded.ok) return setImportFailure(
        `UPID was committed, but its editor document could not be opened: ${loaded.error.message}`
      );
      openEditorProgram(loaded.editorProgram);
      showStatusToast(`Imported ${imported.project.name}.`, 'success');
    } catch (error) {
      setImportFailure(errorText(error));
    }
  }

  async function handleImportExternalProgram(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return setEditorImportFailure('Connect a valid workbench before importing a program.');
    if (activeMutation.current) {
      return setEditorImportFailure(
        `Cannot import ${file.name} while ${activeMutation.current} is in progress.`
      );
    }
    activeMutation.current = 'program-import';
    setEditorImportStatus('importing');
    setEditorImportErrorMessage(null);
    try {
      const imported = await services.importExternalProgram(workbench, {
        fileName: file.name,
        text: await file.text()
      });
      if (!imported.ok) return setEditorImportFailure(imported.error.message);
      setConnectedWorkbench(imported.workbench);
      openEditorProgram(imported.editorProgram);
      setEditorImportStatus('idle');
      showStatusToast(`Program imported: ${file.name}.`, 'success');
    } catch (error) {
      setEditorImportFailure(errorText(error));
    } finally {
      activeMutation.current = null;
    }
  }

  function openEditorProgram(program: LoadedEditorProgram | null) {
    setLoadedEditorProgram(program);
    setEditorProgramRevision((revision) => revision + 1);
    setActiveView('editor');
    setEditorSaveErrorMessage(null);
  }

  function handleOpenEditor() {
    openEditorProgram(null);
  }

  async function handleOpenWorkbenchProject(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return showStatusToast('Connect a valid workbench before opening a project.', 'error');
    if (activeMutation.current) return;
    activeMutation.current = 'project-open';
    setProjectOpening(true);
    try {
      const opened = await services.openWorkbenchProject(workbench, projectId);
      if (!opened.ok) return showStatusToast(opened.error.message, 'error');
      openEditorProgram(opened.editorProgram);
    } catch (error) {
      showStatusToast(errorText(error), 'error');
    } finally {
      activeMutation.current = null;
      setProjectOpening(false);
    }
  }

  async function handleOpenLatestImportInEditor() {
    if (!latestImport) return;
    await handleOpenWorkbenchProject(latestImport.project.id);
  }

  function handleBackToDashboard() {
    setActiveView('dashboard');
    setLoadedEditorProgram(null);
    setPendingDxfReimport(null);
  }

  async function handleSaveEditorDraft(draft: EditorSaveDraft) {
    const workbench = requireWorkbench();
    const program = loadedEditorProgram;
    if (!workbench || !program) {
      setEditorSaveStatus('error');
      setEditorSaveErrorMessage('A catalog-owned project must be open before saving.');
      return null;
    }
    if (activeMutation.current) {
      setEditorSaveStatus('error');
      setEditorSaveErrorMessage(`Cannot save while ${activeMutation.current} is in progress.`);
      return null;
    }
    activeMutation.current = 'editor-save';
    setEditorSaveStatus('saving');
    setEditorSaveErrorMessage(null);
    try {
      const saved = await services.saveEditorProgram(workbench, {
        projectId: program.project.id,
        expectedContent: program.project.content,
        draft
      });
      if (!saved.ok) {
        setEditorSaveStatus('error');
        setEditorSaveErrorMessage(saved.error.message);
        return null;
      }
      setConnectedWorkbench(saved.workbench);
      setLoadedEditorProgram(saved.editorProgram);
      setLatestImport((current) => current?.project.id === saved.project.id
        ? {
            ...current,
            workbench: saved.workbench,
            project: saved.project,
            pathDocument: saved.editorProgram.model === 'upid-document'
              ? saved.editorProgram.pathDocument
              : current.pathDocument
          }
        : current);
      setEditorSaveStatus('idle');
      showStatusToast('Project saved.', 'success');
      return saved.editorProgram;
    } catch (error) {
      setEditorSaveStatus('error');
      setEditorSaveErrorMessage(errorText(error));
      return null;
    } finally {
      activeMutation.current = null;
    }
  }

  async function handlePrepareDxfReimport() {
    const workbench = requireWorkbench();
    const program = loadedEditorProgram;
    if (!workbench || !program) return;
    setDxfReimportStatus('importing');
    setDxfReimportErrorMessage(null);
    try {
      const prepared = await services.prepareDxfProjectReimport(workbench, program.project.id);
      if (!prepared.ok) return setDxfReimportFailure(prepared.error.message);
      const selectedUnitCandidateId = prepared.preparation.defaultUnitCandidateId;
      const previewResult = selectedUnitCandidateId
        ? services.previewDxfProjectImport(prepared.preparation, { unitCandidateId: selectedUnitCandidateId })
        : null;
      const selected = prepared.preparation.unitCandidates.find(({ id }) => id === selectedUnitCandidateId);
      setPendingDxfReimport({
        preparation: prepared.preparation,
        selectedUnitCandidateId,
        previewResult,
        declaredUnitOverrideAcknowledged: false,
        rebuildAcknowledged: false,
        rebuildRequired: selected
          ? dxfProjectReimportRequiresRebuild(prepared.preparation.project, selected)
          : false,
        planningMachineFit: resolvePlanningMachineFit(workbench, previewResult)
      });
      setDxfReimportStatus('idle');
    } catch (error) {
      setDxfReimportFailure(errorText(error));
    }
  }

  function handleDxfReimportUnitCandidateChange(candidateId: string) {
    setPendingDxfReimport((pending) => {
      if (!pending) return null;
      const previewResult = services.previewDxfProjectImport(pending.preparation, { unitCandidateId: candidateId });
      const candidate = pending.preparation.unitCandidates.find(({ id }) => id === candidateId);
      return {
        ...pending,
        selectedUnitCandidateId: candidateId,
        previewResult,
        declaredUnitOverrideAcknowledged: false,
        rebuildAcknowledged: false,
        rebuildRequired: candidate
          ? dxfProjectReimportRequiresRebuild(pending.preparation.project, candidate)
          : false,
        planningMachineFit: connectedWorkbench
          ? resolvePlanningMachineFit(connectedWorkbench, previewResult)
          : null
      };
    });
  }

  function handleDxfReimportOverrideAcknowledgedChange(value: boolean) {
    setPendingDxfReimport((pending) => pending ? { ...pending, declaredUnitOverrideAcknowledged: value } : null);
  }

  function handleDxfReimportRebuildAcknowledgedChange(value: boolean) {
    setPendingDxfReimport((pending) => pending ? { ...pending, rebuildAcknowledged: value } : null);
  }

  function handleCancelDxfReimport() {
    setPendingDxfReimport(null);
    setDxfReimportErrorMessage(null);
  }

  async function handleConfirmDxfReimport() {
    const workbench = requireWorkbench();
    const pending = pendingDxfReimport;
    if (!workbench || !pending) return setDxfReimportFailure('The reviewed DXF re-import is unavailable.');
    if (!pending.selectedUnitCandidateId) return setDxfReimportFailure('Select an explicit DXF unit interpretation.');
    setDxfReimportStatus('importing');
    try {
      const result = await services.commitDxfProjectReimport(workbench, pending.preparation, {
        unitCandidateId: pending.selectedUnitCandidateId,
        confirmed: true,
        declaredUnitOverrideAcknowledged: pending.declaredUnitOverrideAcknowledged,
        rebuildAcknowledged: pending.rebuildAcknowledged
      });
      if (!result.ok) return setDxfReimportFailure(result.error.message);
      setConnectedWorkbench(result.workbench);
      if (loadedEditorProgram?.model === 'upid-document') {
        setLoadedEditorProgram({
          ...loadedEditorProgram,
          project: result.project,
          pathDocument: result.pathDocument
        });
        setEditorProgramRevision((revision) => revision + 1);
      }
      setPendingDxfReimport(null);
      setDxfReimportStatus('idle');
      showStatusToast(result.mode === 'rebuilt' ? 'DXF project rebuilt with explicit units.' : 'DXF units unchanged.', 'success');
    } catch (error) {
      setDxfReimportFailure(errorText(error));
    }
  }

  async function runProjectAction<T>(action: () => Promise<T>): Promise<T> {
    if (activeMutation.current || interactionLocked) throw new Error('Another workbench action is in progress. Try again when it finishes.');
    activeMutation.current = 'project-action';
    setProjectActionPending(true);
    try {
      return await action();
    } finally {
      activeMutation.current = null;
      setProjectActionPending(false);
    }
  }

  async function handleRenameWorkbenchProject(projectId: string, name: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    await runProjectAction(async () => {
      const renamed = await services.renameWorkbenchProject(workbench, { projectId, name });
      if (!renamed.ok) throw new Error(renamed.error.message);
      setConnectedWorkbench(renamed.workbench);
      if (latestImport?.project.id === projectId) setLatestImport(null);
      showStatusToast('Project renamed.', 'success');
    });
  }

  async function handleDeleteWorkbenchProject(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    await runProjectAction(async () => {
      const deleted = await services.deleteWorkbenchProject(workbench, { projectId });
      if (!deleted.ok) throw new Error(deleted.error.message);
      setConnectedWorkbench(deleted.workbench);
      if (latestImport?.project.id === projectId) setLatestImport(null);
      showStatusToast('Project moved to Archive. Files and revisions retained for restoration.', 'success');
    });
  }

  async function handleRestoreWorkbenchProject(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    await runProjectAction(async () => {
      const restored = await services.restoreStoredWorkbenchProject(workbench, { projectId });
      if (!restored.ok) throw new Error(restored.error.message);
      setConnectedWorkbench(restored.workbench);
      showStatusToast('Project restored.', 'success');
    });
  }

  async function handlePurgeArchivedWorkbenchProject(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) throw new Error('Connect a workbench before deleting archived projects.');
    await runProjectAction(async () => {
      const purged = await services.purgeArchivedWorkbenchProject(workbench, { projectId });
      if (!purged.ok) throw new Error(purged.error.message);
      setConnectedWorkbench(purged.workbench);
      showStatusToast('Archived project and its files permanently deleted.', 'success');
    });
  }

  async function requestUpidProjectExport(projectId: string, options: {
    readonly expectedProjectVersion?: string;
    readonly signal?: AbortSignal;
    readonly beforeDownload?: () => void;
  } = {}) {
    const workbench = requireWorkbench();
    if (!workbench) throw new ToolError('WORKBENCH_UNAVAILABLE', 'Wait for the workbench to open.');
    options.signal?.throwIfAborted();
    return runProjectAction(async () => {
      const exported = await services.exportPortableUpidProject(workbench, projectId, { expectedProjectVersion: options.expectedProjectVersion });
      if (!exported.ok) throw new ToolError(exported.error.code, exported.error.message);
      options.signal?.throwIfAborted();
      options.beforeDownload?.();
      await services.downloadTextFile({ ...exported.file, mimeType: 'application/json;charset=utf-8' });
      showStatusToast('UPID download requested. If no file appears, use Save UPID As.', 'success');
      return { status: 'download-requested' as const, projectId, fileName: exported.file.fileName };
    });
  }

  async function handleExportUpidProject(projectId: string) {
    try {
      await requestUpidProjectExport(projectId);
    } catch (error) {
      showStatusToast('Could not export UPID: ' + errorText(error) + ' Retry using Export UPID.', 'error');
    }
  }

  async function handleSaveUpidProjectAs(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    const project = workbench.manifest.projects.find(({ id }) => id === projectId);
    if (!project) return;
    try {
      const destination = await selectTextFileDestination(`${portableFileBaseName(project.name)}.upid.json`);
      await runProjectAction(async () => {
        const exported = await services.exportPortableUpidProject(workbench, projectId);
        if (!exported.ok) throw new Error(exported.error.message);
        await writeSelectedTextFile(destination, exported.file.text);
        showStatusToast(`Saved ${exported.file.fileName}.`, 'success');
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showStatusToast('Could not save UPID: ' + errorText(error), 'error');
    }
  }

  async function handleDeleteSavedRevisions(projectId: string, revisionIds: readonly string[]) {
    const workbench = requireWorkbench();
    if (!workbench) throw new Error('Connect a workbench before deleting revisions.');
    await runProjectAction(async () => {
      const deleted = await services.deleteStoredWireEdmJobRevisions(workbench, {
        projectId,
        revisionIds,
        deletedAt: new Date()
      });
      if (!deleted.ok) throw new Error(deleted.error.message);
      setConnectedWorkbench(deleted.workbench);
      setLoadedEditorProgram((current) => current?.project.id === projectId
        ? { ...current, project: deleted.project }
        : current);
      showStatusToast(`Deleted ${deleted.deletedCount} saved ${deleted.deletedCount === 1 ? 'revision' : 'revisions'}.`, 'success');
    });
  }

  function handleDownloadEditorFile(input: DownloadProgramFileInput) {
    return services.downloadTextFile(input);
  }

  async function handleGenerateControllerArtifact(input: {
    readonly machineId: string;
    readonly signal?: AbortSignal;
    readonly beforeWrite?: () => void;
  }): Promise<ControllerArtifactResult & { readonly savedRevisionId?: string }> {
    input.signal?.throwIfAborted();
    const editor = getEditorState?.();
    if (editor?.dirty || (editor?.workflowOpen && editor.workflowCommand !== 'export.preview')) return artifactAppFailure('Save the draft and finish the editor workflow before generating controller output.');
    const workbench = requireWorkbench();
    const program = loadedEditorProgram;
    if (!workbench || !program || program.model !== 'upid-document') {
      return artifactAppFailure('A saved catalog-owned UPID project must be open.');
    }
    const machine = workbench.machines.machines.find(({ id }) => id === input.machineId);
    if (!machine) return artifactAppFailure(`Machine not found: ${input.machineId}.`);
    if (machine.activeBindingId === null) {
      return artifactAppFailure(`Machine ${machine.name} has no active setup.`);
    }
    if (!globalThis.crypto?.randomUUID) {
      return artifactAppFailure('Secure UUID generation is unavailable; a saved revision cannot be identified exactly.');
    }
    if (activeMutation.current) {
      return artifactAppFailure(`Cannot generate a controller artifact while ${activeMutation.current} is in progress.`);
    }
    activeMutation.current = 'controller-artifact';
    setControllerArtifactGenerating(true);
    let revisionWriteStarted = false;
    let savedRevisionId: string | undefined;
    try {
      const candidate = await services.createSavedWireEdmJobRevision({
        revisionId: createSavedWireEdmJobRevisionId(globalThis.crypto.randomUUID()),
        savedAt: new Date().toISOString(),
        project: program.project,
        machine,
        bindingId: machine.activeBindingId,
        postLibrary: workbench.posts
      });
      input.signal?.throwIfAborted();
      if (!candidate.ok) {
        if (candidate.error.code === 'SAVED_REVISION_EXECUTION_PLAN_INVALID') {
          return {
            ok: false,
            error: {
              code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID',
              message: candidate.error.message,
              diagnostics: candidate.error.diagnostics
            }
          };
        }
        return artifactAppFailure(candidate.error.message);
      }
      // Abort/version checks stop before the first durable write. After it, return
      // the completed generation receipt even if the caller has cancelled.
      input.signal?.throwIfAborted();
      input.beforeWrite?.();
      revisionWriteStarted = true;
      const saved = await services.saveStoredWireEdmJobRevision(workbench, candidate.candidate);
      if (!saved.ok) return artifactAppFailure(saved.error.message);
      savedRevisionId = saved.revision.revisionId;
      setConnectedWorkbench(saved.workbench);
      setLoadedEditorProgram((current) => current === program
        ? { ...current, project: saved.project }
        : current);
      const artifact = await services.generateControllerArtifact(saved.revision);
      if (artifact.ok) showStatusToast(`Generated exact revision ${saved.revision.revisionId}.`, 'success');
      return { ...artifact, savedRevisionId };
    } catch (error) {
      if (!revisionWriteStarted && (input.signal?.aborted || error instanceof ToolError)) throw error;
      return { ...artifactAppFailure(errorText(error)), ...(savedRevisionId ? { savedRevisionId } : {}) };
    } finally {
      activeMutation.current = null;
      setControllerArtifactGenerating(false);
    }
  }

  async function handleSaveCatalogPreferences(preferences: WorkbenchCatalogManifest['preferences']) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before saving preferences.');
    await runSettingsMutation(async () => {
      const result = await services.updateWorkbenchCatalogPreferences(workbench, {
        preferences,
        updatedAt: new Date()
      });
      return result.ok ? { ok: true as const, workbench: result.workbench } : result;
    }, 'Workbench preferences saved.');
  }

  async function handlePrepareMachinePackage(file: File): Promise<PrepareStoredMachinePackageInstallationResult> {
    const workbench = requireWorkbench();
    if (!workbench) {
      const message = 'Connect a valid workbench before installing a machine package.';
      settingsFailure(message);
      return { ok: false, error: { code: 'MACHINE_PACKAGE_WORKBENCH_MISSING', message } };
    }
    setSettingsStatus('saving');
    setSettingsErrorMessage(null);
    try {
      if (file.size > MAX_MACHINE_PACKAGE_ARCHIVE_BYTES) {
        const message = `Machine package is ${file.size} bytes; the maximum is ${MAX_MACHINE_PACKAGE_ARCHIVE_BYTES}.`;
        settingsFailure(message);
        return {
          ok: false,
          error: { code: 'MACHINE_PACKAGE_ARCHIVE_TOO_LARGE', message }
        };
      }
      const result = await services.prepareStoredMachinePackageInstallation(
        workbench,
        new Uint8Array(await file.arrayBuffer())
      );
      if (!result.ok) {
        settingsFailure(result.error.message);
        return result;
      }
      setSettingsStatus('idle');
      return result;
    } catch (error) {
      const message = errorText(error);
      settingsFailure(message);
      return { ok: false, error: { code: 'MACHINE_PACKAGE_READ_FAILED', message } };
    }
  }

  async function handleCommitMachinePackage(
    prepared: PreparedMachinePackageInstallation,
    resolution: MachinePackageInstallationResolution,
    options: { readonly beforeWrite?: () => void } = {}
  ) {
    const workbench = requireWorkbench();
    if (!workbench || prepared.workbench.adapter !== workbench.adapter) {
      settingsFailure('The workbench changed after the package preview. Review the package again.');
      return false;
    }
    return runSettingsMutation(async () => {
      const result = await services.commitStoredMachinePackageInstallation(prepared, resolution, options);
      return result.ok ? { ok: true as const, workbench: result.workbench } : result;
    }, 'Machine package installed.', error => error instanceof ToolError || error instanceof DOMException && error.name === 'AbortError');
  }

  async function handleActivateMachineSetup(machineId: string, setupId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return false;
    return runSettingsMutation(async () => {
      const result = await services.activateStoredMachinePostBinding(workbench.adapter, machineId, setupId);
      return result.ok
        ? { ok: true as const, workbench: Object.freeze({ ...workbench, machines: result.library }) }
        : result;
    }, 'Active machine setup changed.');
  }

  async function handleRemoveMachineDefinition(machineId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before removing a machine.');
    await runSettingsMutation(async () => {
      const result = await services.removeStoredMachineDefinition(workbench, machineId);
      return result.ok ? { ok: true as const, workbench: result.workbench } : result;
    }, 'Machine definition removed.');
  }

  async function runSettingsMutation(
    action: () => Promise<
      | { readonly ok: true; readonly workbench: ConnectedWorkbenchCatalog }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >,
    successMessage: string,
    shouldRethrow: (error: unknown) => boolean = () => false
  ) {
    if (activeMutation.current) return false;
    activeMutation.current = 'project-action';
    setSettingsStatus('saving');
    setSettingsErrorMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        settingsFailure(result.error.message);
        return false;
      }
      setConnectedWorkbench(result.workbench);
      setSettingsStatus('saved');
      showStatusToast(successMessage, 'success');
      return true;
    } catch (error) {
      if (shouldRethrow(error)) { setSettingsStatus('idle'); throw error; }
      settingsFailure(errorText(error));
      return false;
    } finally {
      activeMutation.current = null;
    }
  }

  /** Agent imports/opening use the same storage operations and app state as the interface. */
  async function runAgentWorkbenchOperation<T>(action: (workbench: ConnectedWorkbenchCatalog) => Promise<{
    workbench: ConnectedWorkbenchCatalog; editorProgram?: LoadedEditorProgram; value: T;
  }>): Promise<T> {
    if (!connectedWorkbench) throw new ToolError('WORKBENCH_UNAVAILABLE', 'Wait for the workbench.');
    if (activeMutation.current || interactionLocked) throw new ToolError('BUSY', 'A workbench operation is in progress.');
    const editor = getEditorState?.();
    if (editor?.dirty || editor?.workflowOpen) throw new ToolError('DRAFT_IN_USE', 'Save the draft and finish its workflow first.');
    activeMutation.current = 'project-action';
    flushSync(() => setProjectActionPending(true));
    try {
      const result = await action(connectedWorkbench);
      flushSync(() => {
        setConnectedWorkbench(result.workbench);
        if (result.editorProgram) openEditorProgram(result.editorProgram);
      });
      return result.value;
    } finally {
      activeMutation.current = null;
      flushSync(() => setProjectActionPending(false));
    }
  }

  function settingsFailure(message: string) {
    setSettingsStatus('error');
    setSettingsErrorMessage(message);
    showStatusToast(message, 'error');
  }

  function setImportFailure(message: string) {
    setImportStatus('error');
    setImportErrorMessage(message);
  }

  function setEditorImportFailure(message: string) {
    setEditorImportStatus('error');
    setEditorImportErrorMessage(message);
  }

  function setDxfReimportFailure(message: string) {
    setDxfReimportStatus('error');
    setDxfReimportErrorMessage(message);
  }

  const interactionLocked = workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage' ||
    projectOpening || projectActionPending || [importStatus, editorImportStatus, dxfReimportStatus].includes('importing') ||
    controllerArtifactGenerating || editorSaveStatus === 'saving' || settingsStatus === 'saving';

  return {
    activeView,
    connectedWorkbench,
    dismissStatusToast,
    dxfReimportErrorMessage,
    dxfReimportStatus,
    editorImportErrorMessage,
    editorImportStatus,
    editorProgramRevision,
    editorSaveErrorMessage,
    editorSaveStatus,
    errorMessage,
    handleBackToDashboard,
    handleCancelDxfImport,
    handleCancelDxfReimport,
    handleConfirmDxfImport,
    handleConfirmDxfReimport,
    handleConnectWorkbench,
    handleUseBrowserCache,
    handleActivateMachineSetup,
    handleCommitMachinePackage,
    handleDeleteWorkbenchProject,
    handleRestoreWorkbenchProject,
    handlePurgeArchivedWorkbenchProject,
    handleDxfImportOverrideAcknowledgedChange,
    handleDxfImportUnitCandidateChange,
    handleDxfReimportOverrideAcknowledgedChange,
    handleDxfReimportRebuildAcknowledgedChange,
    handleDxfReimportUnitCandidateChange,
    handleDownloadEditorFile,
    handleExportUpidProject,
    requestUpidProjectExport,
    handleSaveUpidProjectAs,
    handleDeleteSavedRevisions,
    handleGenerateControllerArtifact,
    handleImportDxfFile,
    handleImportExternalProgram,
    handleImportUpidFile,
    handleOpenEditor,
    handleOpenLatestImportInEditor,
    handleOpenWorkbenchProject,
    handlePrepareDxfReimport,
    handlePrepareMachinePackage,
    handleRemoveMachineDefinition,
    handleRenameWorkbenchProject,
    handleSaveCatalogPreferences,
    handleSaveEditorDraft,
    runAgentWorkbenchOperation,
    importErrorMessage,
    importStatus,
    latestImport,
    loadedEditorProgram,
    pendingDxfImport,
    pendingDxfReimport,
    settingsErrorMessage,
    settingsStatus,
    showStatusToast,
    statusNotifications,
    statusToasts,
    storageActionLabel: connectedWorkbench?.adapter.kind === 'directory'
      ? 'Choose another Workbench Folder'
      : 'Choose Workbench Folder',
    storageWarningMessage,
    workbenchInteractionLocked: interactionLocked,
    workbenchStatus
  };
}

function resolvePlanningMachineFit(
  workbench: ConnectedWorkbenchCatalog,
  preview: DxfImportPreviewResult | null
): ResolvedPlanningMachineFit | null {
  const machineId = workbench.manifest.preferences.recentPlanningMachineId;
  if (!machineId || !preview?.ok) return null;
  const machine = workbench.machines.machines.find(({ id }) => id === machineId);
  if (!machine) return null;
  const result = evaluatePhysicalMachineEnvelopeFit({
    bounds: {
      xSpanMm: preview.preview.sizeMm.widthMm,
      ySpanMm: preview.preview.sizeMm.lengthMm
    },
    machine
  });
  if (!result.ok) {
    return { machine: { id: machine.id, name: machine.name }, result };
  }
  if (result.fit.status === 'not-evaluated') {
    throw new Error('Machine fit returned not-evaluated despite an explicit machine.');
  }
  return {
    machine: { id: machine.id, name: machine.name },
    result: { ok: true, fit: result.fit }
  };
}

function artifactAppFailure(message: string): ControllerArtifactResult {
  return {
    ok: false,
    error: {
      code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED',
      message
    }
  };
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
