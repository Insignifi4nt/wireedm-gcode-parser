import { useEffect, useRef, useState } from 'react';

import type { StatusToast, StatusToastType } from '@/components/StatusToasts';
import {
  dxfProjectReimportRequiresRebuild,
  type DxfProjectReimportPreparation
} from '@/domain/dxf/reimportDxfProjectUnits';
import type { ImportedDxfProject } from '@/domain/dxf/importDxfProject';
import type { DxfImportPreviewResult } from '@/domain/dxf/prepareDxfProjectImport';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { CreateMachinePostBindingInput } from '@/domain/machine-definition/machineDefinition';
import { serializeMachineDefinition } from '@/domain/machine-definition/machineDefinition';
import { evaluatePhysicalMachineEnvelopeFit } from '@/domain/machine-definition/machineFit';
import type { DuplicateStoredMachinePostBindingInput } from '@/domain/machine-definition/machineLibraryMutations';
import type { DownloadProgramFileInput } from '@/domain/post/downloadProgramFile';
import type { PostInstallationRef } from '@/domain/post-processor/postLibrary';
import type { ControllerArtifactResult } from '@/domain/wire-edm-job';
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

export function useWorkbenchAppController(overrides: Partial<AppServices> = {}) {
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
  const [statusToasts, setStatusToasts] = useState<StatusToast[]>([]);
  const initializationStarted = useRef(false);
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
        ? 'The remembered folder needs permission. Browser storage is active until you explicitly reconnect it.'
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
    setStorageWarningMessage(warning);
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
  }

  function dismissStatusToast(id: string) {
    setStatusToasts((current) => current.filter((toast) => toast.id !== id));
  }

  async function handleConnectWorkbench() {
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
      showStatusToast('Workbench folder connected.', 'success');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
        return;
      }
      setWorkbenchStatus(connectedWorkbench ? 'ready' : 'error');
      setErrorMessage(errorText(error));
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
    setImportStatus('idle');
    showStatusToast(`Imported ${imported.project.name}.`, 'success');
  }

  async function handleImportUpidFile(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return setImportFailure('Connect a valid workbench before importing UPID.');
    setImportStatus('importing');
    setImportErrorMessage(null);
    try {
      const imported = await services.importPortableUpidProject(workbench, {
        fileName: file.name,
        text: await file.text()
      });
      if (!imported.ok) return setImportFailure(imported.error.message);
      setConnectedWorkbench(imported.workbench);
      setImportStatus('idle');
      showStatusToast(`Imported ${imported.project.name}.`, 'success');
    } catch (error) {
      setImportFailure(errorText(error));
    }
  }

  async function handleImportExternalProgram(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return setEditorImportFailure('Connect a valid workbench before importing a program.');
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
      showStatusToast(`Imported ${imported.project.name}.`, 'success');
    } catch (error) {
      setEditorImportFailure(errorText(error));
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
    const opened = await services.openWorkbenchProject(workbench, projectId);
    if (!opened.ok) return showStatusToast(opened.error.message, 'error');
    openEditorProgram(opened.editorProgram);
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
    setEditorSaveStatus('saving');
    setEditorSaveErrorMessage(null);
    const saved = await services.saveEditorProgram(workbench, {
      projectId: program.project.id,
      draft
    });
    if (!saved.ok) {
      setEditorSaveStatus('error');
      setEditorSaveErrorMessage(saved.error.message);
      return null;
    }
    setConnectedWorkbench(saved.workbench);
    setLoadedEditorProgram(saved.editorProgram);
    setEditorSaveStatus('idle');
    showStatusToast('Project saved.', 'success');
    return saved.editorProgram;
  }

  async function handlePrepareDxfReimport() {
    const workbench = requireWorkbench();
    const program = loadedEditorProgram;
    if (!workbench || !program) return;
    setDxfReimportStatus('importing');
    setDxfReimportErrorMessage(null);
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
  }

  async function handleRenameWorkbenchProject(projectId: string, name: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    const renamed = await services.renameWorkbenchProject(workbench, { projectId, name });
    if (!renamed.ok) throw new Error(renamed.error.message);
    setConnectedWorkbench(renamed.workbench);
    if (latestImport?.project.id === projectId) setLatestImport(null);
    showStatusToast('Project renamed.', 'success');
  }

  async function handleDeleteWorkbenchProject(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    const deleted = await services.deleteWorkbenchProject(workbench, { projectId });
    if (!deleted.ok) throw new Error(deleted.error.message);
    setConnectedWorkbench(deleted.workbench);
    if (latestImport?.project.id === projectId) setLatestImport(null);
    showStatusToast('Project and its catalog-owned files removed.', 'success');
  }

  async function handleExportUpidProject(projectId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return;
    const exported = await services.exportPortableUpidProject(workbench, projectId);
    if (!exported.ok) throw new Error(exported.error.message);
    services.downloadTextFile({
      fileName: exported.file.fileName,
      text: exported.file.text,
      mimeType: 'application/json;charset=utf-8'
    });
  }

  function handleDownloadEditorFile(input: DownloadProgramFileInput) {
    services.downloadTextFile(input);
  }

  async function handleGenerateControllerArtifact(input: {
    readonly machineId: string;
    readonly bindingId: string;
  }): Promise<ControllerArtifactResult> {
    const workbench = requireWorkbench();
    const program = loadedEditorProgram;
    if (!workbench || !program || program.model !== 'upid-document') {
      return artifactAppFailure('A saved catalog-owned UPID project must be open.');
    }
    if (workbench.manifest.preferences.export.status !== 'configured') {
      return artifactAppFailure('Configure the output extension and line ending before export.');
    }
    const machine = workbench.machines.machines.find(({ id }) => id === input.machineId);
    if (!machine) return artifactAppFailure(`Machine not found: ${input.machineId}.`);
    if (!globalThis.crypto?.randomUUID) {
      return artifactAppFailure('Secure UUID generation is unavailable; a saved revision cannot be identified exactly.');
    }
    const candidate = await services.createSavedWireEdmJobRevision({
      revisionId: globalThis.crypto.randomUUID(),
      savedAt: new Date().toISOString(),
      project: program.project,
      machine,
      bindingId: input.bindingId,
      postLibrary: workbench.posts
    });
    if (!candidate.ok) return artifactAppFailure(candidate.error.message);
    const saved = await services.saveStoredWireEdmJobRevision(workbench, candidate.candidate);
    if (!saved.ok) return artifactAppFailure(saved.error.message);
    setConnectedWorkbench(saved.workbench);
    setLoadedEditorProgram((current) => current ? { ...current, project: saved.project } : current);
    const artifact = await services.generateControllerArtifact(
      saved.revision,
      configuredArtifactPreference(workbench.manifest.preferences.export)
    );
    if (artifact.ok) showStatusToast(`Generated exact revision ${saved.revision.revisionId}.`, 'success');
    return artifact;
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

  async function handleImportMachineDefinition(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before installing a machine.');
    await runSettingsMutation(async () => {
      const result = await services.installStoredMachineDefinition(workbench.adapter, await file.text());
      return result.ok
        ? { ok: true as const, workbench: Object.freeze({ ...workbench, machines: result.library }) }
        : result;
    }, 'Machine definition installed.');
  }

  async function handleReplaceMachineDefinition(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before replacing a machine.');
    await runSettingsMutation(async () => {
      const result = await services.replaceStoredMachineDefinition(workbench, await file.text());
      return result.ok ? { ok: true as const, workbench: result.workbench } : result;
    }, 'Machine definition replaced.');
  }

  async function handleRemoveMachineDefinition(machineId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before removing a machine.');
    await runSettingsMutation(async () => {
      const result = await services.removeStoredMachineDefinition(workbench, machineId);
      return result.ok ? { ok: true as const, workbench: result.workbench } : result;
    }, 'Machine definition removed.');
  }

  function handleExportMachineDefinition(machineId: string) {
    const machine = connectedWorkbench?.machines.machines.find(({ id }) => id === machineId);
    if (!machine) return settingsFailure(`Machine not found: ${machineId}.`);
    services.downloadTextFile({
      fileName: `${machine.id}.wireedm-machine.json`,
      text: serializeMachineDefinition(machine),
      mimeType: 'application/json;charset=utf-8'
    });
  }

  async function handleCreateMachineBinding(machineId: string, post: PostInstallationRef, input: CreateMachinePostBindingInput) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before creating a binding.');
    await runSettingsMutation(async () => {
      const result = await services.createStoredMachinePostBinding(workbench.adapter, machineId, post, input);
      return result.ok
        ? { ok: true as const, workbench: Object.freeze({ ...workbench, machines: result.library }) }
        : result;
    }, 'Exact post binding created.');
  }

  async function handleDuplicateMachineBinding(machineId: string, sourceBindingId: string, input: DuplicateStoredMachinePostBindingInput) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before duplicating a binding.');
    await runSettingsMutation(async () => {
      const result = await services.duplicateStoredMachinePostBinding(workbench, machineId, sourceBindingId, input);
      return result.ok ? { ok: true as const, workbench: result.workbench } : result;
    }, 'Post binding duplicated with verification reset.');
  }

  async function handleRemoveMachineBinding(machineId: string, bindingId: string) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before removing a binding.');
    await runSettingsMutation(async () => {
      const result = await services.removeStoredMachinePostBinding(workbench.adapter, machineId, bindingId);
      return result.ok
        ? { ok: true as const, workbench: Object.freeze({ ...workbench, machines: result.library }) }
        : result;
    }, 'Post binding removed.');
  }

  async function handleImportPostPackage(file: File) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before installing a post.');
    await runSettingsMutation(async () => {
      const result = await services.installStoredPostPackage(workbench.adapter, await file.text());
      return result.ok
        ? { ok: true as const, workbench: Object.freeze({ ...workbench, posts: result.library }) }
        : result;
    }, 'Post package installed.');
  }

  async function handleRemovePostInstallation(post: PostInstallationRef) {
    const workbench = requireWorkbench();
    if (!workbench) return settingsFailure('Connect a valid workbench before removing a post.');
    await runSettingsMutation(async () => {
      const result = await services.removeStoredPostInstallation(workbench.adapter, post);
      return result.ok
        ? { ok: true as const, workbench: Object.freeze({ ...workbench, posts: result.library }) }
        : result;
    }, 'Post installation removed.');
  }

  async function runSettingsMutation(
    action: () => Promise<
      | { readonly ok: true; readonly workbench: ConnectedWorkbenchCatalog }
      | { readonly ok: false; readonly error: { readonly message: string } }
    >,
    successMessage: string
  ) {
    setSettingsStatus('saving');
    setSettingsErrorMessage(null);
    try {
      const result = await action();
      if (!result.ok) return settingsFailure(result.error.message);
      setConnectedWorkbench(result.workbench);
      setSettingsStatus('saved');
      showStatusToast(successMessage, 'success');
    } catch (error) {
      settingsFailure(errorText(error));
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

  const interactionLocked = [importStatus, editorImportStatus, dxfReimportStatus].includes('importing') ||
    editorSaveStatus === 'saving' || settingsStatus === 'saving';

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
    handleCreateMachineBinding,
    handleDeleteWorkbenchProject,
    handleDxfImportOverrideAcknowledgedChange,
    handleDxfImportUnitCandidateChange,
    handleDxfReimportOverrideAcknowledgedChange,
    handleDxfReimportRebuildAcknowledgedChange,
    handleDxfReimportUnitCandidateChange,
    handleDownloadEditorFile,
    handleDuplicateMachineBinding,
    handleExportMachineDefinition,
    handleExportUpidProject,
    handleGenerateControllerArtifact,
    handleImportDxfFile,
    handleImportExternalProgram,
    handleImportMachineDefinition,
    handleImportPostPackage,
    handleImportUpidFile,
    handleOpenEditor,
    handleOpenLatestImportInEditor,
    handleOpenWorkbenchProject,
    handlePrepareDxfReimport,
    handleRemoveMachineBinding,
    handleRemoveMachineDefinition,
    handleRemovePostInstallation,
    handleRenameWorkbenchProject,
    handleReplaceMachineDefinition,
    handleSaveCatalogPreferences,
    handleSaveEditorDraft,
    importErrorMessage,
    importStatus,
    latestImport,
    loadedEditorProgram,
    pendingDxfImport,
    pendingDxfReimport,
    settingsErrorMessage,
    settingsStatus,
    showStatusToast,
    statusNotifications: statusToasts,
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

function configuredArtifactPreference(
  preference: Extract<WorkbenchCatalogManifest['preferences']['export'], { status: 'configured' }>
) {
  return preference.fileExtension.kind === 'standard'
    ? {
        status: 'configured' as const,
        fileExtension: {
          kind: 'standard' as const,
          extension: preference.fileExtension.extension
        },
        lineEnding: preference.lineEnding
      }
    : {
        status: 'configured' as const,
        fileExtension: {
          kind: 'custom' as const,
          extension: preference.fileExtension.extension
        },
        lineEnding: preference.lineEnding
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
