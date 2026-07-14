import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { StatusToast, StatusToastType } from '@/components/StatusToasts';
import type { DxfImportUnitCandidate } from '@/domain/dxf/dxfImportUnits';
import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type {
  DxfImportPreparation,
  DxfImportPreview,
  DxfImportSelection
} from '@/domain/dxf/prepareDxfProjectImport';
import {
  dxfProjectReimportRequiresRebuild,
  type DxfProjectReimportPreparation
} from '@/domain/dxf/reimportDxfProjectUnits';
import { upidEditorDocumentPath } from '@/domain/editor/editorProjectPaths';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { EditorSaveDraft } from '@/domain/editor/saveEditorProgram';
import {
  parseMachineProfileFile,
  planMachineProfileImport,
  serializeMachineProfileFile
} from '@/domain/machine/machineProfileFile';
import {
  createBlankMachineProfile,
  createCharmillesRobofil100V2CandidateProfile
} from '@/domain/machine/machineProfiles';
import { supportsWorkbenchDirectoryAccess } from '@/domain/storage/fileSystemAccess';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { MachineProfile } from '@/domain/workbench/types';

import { defaultAppServices, type AppServices } from './appServices';

export type WorkbenchStatus = 'initializing' | 'ready' | 'connecting-storage' | 'error';
export type ImportStatus = 'idle' | 'importing' | 'error';
export type SaveStatus = 'idle' | 'saving' | 'error';
export type SettingsStatus = 'idle' | 'saving' | 'saved' | 'error';
export type ActiveView = 'dashboard' | 'editor';
export interface PendingDxfImport {
  declaredUnitOverrideAcknowledged: boolean;
  preparation: DxfImportPreparation;
  preview: DxfImportPreview | null;
  previewErrorMessage: string | null;
  selection: DxfImportSelection;
  unitCandidates: DxfImportUnitCandidate[];
}
export interface PendingDxfReimport {
  declaredUnitOverrideAcknowledged: boolean;
  preparation: DxfProjectReimportPreparation;
  preview: DxfImportPreview | null;
  previewErrorMessage: string | null;
  project: NonNullable<LoadedEditorProgram['project']>;
  rebuildAcknowledged: boolean;
  rebuildRequired: boolean;
  selection: DxfImportSelection;
  unitCandidates: DxfImportUnitCandidate[];
}
type WorkbenchOperationKind =
  | 'dxf-import'
  | 'dxf-reimport'
  | 'editor-import'
  | 'editor-save'
  | 'project-delete'
  | 'project-open'
  | 'project-rename'
  | 'machine-profile'
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
  pendingDxfImport: PendingDxfImport | null;
  pendingDxfReimport: PendingDxfReimport | null;
  dxfReimportStatus: ImportStatus;
  dxfReimportErrorMessage: string | null;
  editorProgramRevision: number;
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
  handleCancelDxfImport: () => void;
  handleConfirmDxfImport: () => Promise<void>;
  handleDxfImportMachineProfileChange: (profileId: string) => void;
  handleDxfImportOverrideAcknowledgedChange: (acknowledged: boolean) => void;
  handleDxfImportUnitCandidateChange: (candidateId: string) => void;
  handlePrepareDxfReimport: () => Promise<void>;
  handleCancelDxfReimport: () => void;
  handleConfirmDxfReimport: () => Promise<void>;
  handleDxfReimportOverrideAcknowledgedChange: (acknowledged: boolean) => void;
  handleDxfReimportRebuildAcknowledgedChange: (acknowledged: boolean) => void;
  handleDxfReimportUnitCandidateChange: (candidateId: string) => void;
  handleImportExternalProgram: (file: File) => Promise<void>;
  handleOpenEditor: () => void;
  handleOpenLatestImportInEditor: () => Promise<void>;
  handleOpenWorkbenchProject: (projectPath: string) => Promise<void>;
  handleDeleteWorkbenchProject: (projectId: string) => Promise<void>;
  handleRenameWorkbenchProject: (projectId: string, name: string) => Promise<void>;
  handleSaveEditorDraft: (draft: EditorSaveDraft) => Promise<void>;
  handleSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => Promise<void>;
  handleAcknowledgeMachineProfile: (profile: MachineProfile) => Promise<boolean>;
  handleCreateBlankMachineProfile: () => Promise<string | null>;
  handleCreateRobofilV2CandidateProfile: () => Promise<string | null>;
  handleDeleteMachineProfile: (profileId: string) => Promise<string | null>;
  handleDuplicateMachineProfile: (profileId: string) => Promise<string | null>;
  handleExportMachineProfile: (profile: MachineProfile) => void;
  handleImportMachineProfileFile: (file: File) => Promise<string | null>;
  handleSaveMachineProfile: (profile: MachineProfile) => Promise<boolean>;
  handleSetDefaultMachineProfile: (profileId: string) => Promise<boolean>;
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
  const [pendingDxfImport, setPendingDxfImport] = useState<PendingDxfImport | null>(null);
  const [pendingDxfReimport, setPendingDxfReimport] = useState<PendingDxfReimport | null>(null);
  const [dxfReimportStatus, setDxfReimportStatus] = useState<ImportStatus>('idle');
  const [dxfReimportErrorMessage, setDxfReimportErrorMessage] = useState<string | null>(null);
  const [editorProgramRevision, setEditorProgramRevision] = useState(0);
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

  async function runMachineProfileMutation(
    action: (workbench: ConnectedWorkbench) => Promise<ConnectedWorkbench>,
    successMessage: string
  ) {
    if (!connectedWorkbench || settingsStatus === 'saving') return null;
    const operationId = beginWorkbenchOperation('machine-profile');
    if (operationId === null) return null;
    const workbench = connectedWorkbench;

    setSettingsStatus('saving');
    setSettingsErrorMessage(null);

    try {
      const updatedWorkbench = await action(workbench);
      if (!isCurrentWorkbenchOperation(operationId)) return null;
      setConnectedWorkbench(updatedWorkbench);
      setSettingsStatus('saved');
      showStatusToast(successMessage, 'success');
      return updatedWorkbench;
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return null;
      setSettingsStatus('error');
      const message =
        error instanceof Error ? error.message : 'Could not update the machine profile library.';
      setSettingsErrorMessage(message);
      showStatusToast(message, 'error');
      return null;
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  async function handleCreateBlankMachineProfile() {
    if (!connectedWorkbench) return null;
    const occupied = new Set(connectedWorkbench.manifest.machineProfiles.map(({ id }) => id));
    let id = 'new-wire-machine';
    let suffix = 2;
    while (occupied.has(id)) id = `new-wire-machine-${suffix++}`;
    const profile = createBlankMachineProfile(id);
    const updated = await runMachineProfileMutation(
      (workbench) => appServices.addMachineProfile(workbench, profile),
      'Blank machine profile created.'
    );
    return updated ? profile.id : null;
  }

  async function handleCreateRobofilV2CandidateProfile() {
    if (!connectedWorkbench) return null;
    const occupied = new Set(connectedWorkbench.manifest.machineProfiles.map(({ id }) => id));
    const baseId = 'charmilles-robofil-100-v2-candidate';
    let id = baseId;
    let suffix = 2;
    while (occupied.has(id)) id = `${baseId}-${suffix++}`;
    const profile = createCharmillesRobofil100V2CandidateProfile(id);
    const updated = await runMachineProfileMutation(
      (workbench) => appServices.addMachineProfile(workbench, profile),
      'Robofil v2 candidate profile created. Review and acknowledge before export.'
    );
    return updated ? profile.id : null;
  }

  async function handleDuplicateMachineProfile(profileId: string) {
    const existingIds = new Set(
      connectedWorkbench?.manifest.machineProfiles.map(({ id }) => id) ?? []
    );
    const updated = await runMachineProfileMutation(
      (workbench) => appServices.duplicateMachineProfile(workbench, profileId),
      'Machine profile duplicated.'
    );
    return updated?.manifest.machineProfiles.find(({ id }) => !existingIds.has(id))?.id ?? null;
  }

  async function handleDeleteMachineProfile(profileId: string) {
    const updated = await runMachineProfileMutation(
      (workbench) => appServices.deleteMachineProfile(workbench, profileId),
      'Machine profile deleted.'
    );
    return updated?.activeMachineProfile.id ?? null;
  }

  async function handleSetDefaultMachineProfile(profileId: string) {
    return Boolean(
      await runMachineProfileMutation(
        (workbench) => appServices.setActiveMachineProfile(workbench, profileId),
        'Default machine profile updated.'
      )
    );
  }

  async function handleSaveMachineProfile(profile: MachineProfile) {
    return Boolean(
      await runMachineProfileMutation(
        (workbench) => appServices.replaceMachineProfile(workbench, profile),
        'Machine profile saved.'
      )
    );
  }

  async function handleAcknowledgeMachineProfile(profile: MachineProfile) {
    return Boolean(
      await runMachineProfileMutation(
        (workbench) => appServices.replaceMachineProfile(workbench, profile),
        'Machine profile verification acknowledged.'
      )
    );
  }

  async function handleImportMachineProfileFile(file: File) {
    if (!connectedWorkbench) return null;
    let selectedId: string | null = null;
    const updated = await runMachineProfileMutation(async (workbench) => {
      const imported = parseMachineProfileFile(await file.text());
      const plan = planMachineProfileImport(workbench.manifest.machineProfiles, imported);
      selectedId = plan.profile.id;
      return appServices.importMachineProfile(workbench, imported);
    }, `Machine profile imported: ${file.name}`);

    return updated ? selectedId : null;
  }

  function handleExportMachineProfile(profile: MachineProfile) {
    try {
      const text = serializeMachineProfileFile(profile);
      appServices.downloadTextFile({
        fileName: `${profile.id}.wireedm-machine.json`,
        mimeType: 'application/json;charset=utf-8',
        text
      });
      setSettingsErrorMessage(null);
      showStatusToast(`Machine profile exported: ${profile.name}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export machine profile.';
      setSettingsStatus('error');
      setSettingsErrorMessage(message);
      showStatusToast(message, 'error');
    }
  }

  async function handleImportDxfFile(file: File) {
    if (!connectedWorkbench || importStatus === 'importing' || pendingDxfImport) return;
    const operationId = beginWorkbenchOperation('dxf-import');
    if (operationId === null) return;

    setImportStatus('importing');
    setImportErrorMessage(null);

    try {
      const text = await file.text();
      const preparation = appServices.prepareDxfProjectImport(connectedWorkbench, {
        fileName: file.name,
        text
      });
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setPendingDxfImport(buildPendingDxfImport(preparation, preparation.defaultSelection));
      setImportStatus('idle');
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

  function buildPendingDxfImport(
    preparation: DxfImportPreparation,
    selection: DxfImportSelection,
    declaredUnitOverrideAcknowledged = false
  ): PendingDxfImport {
    const unitCandidates = appServices.unitCandidatesForDxfImport(
      preparation,
      selection.machineProfileId
    );
    try {
      return {
        declaredUnitOverrideAcknowledged,
        preparation,
        preview: appServices.previewDxfProjectImport(preparation, selection),
        previewErrorMessage: null,
        selection,
        unitCandidates
      };
    } catch (error) {
      return {
        declaredUnitOverrideAcknowledged,
        preparation,
        preview: null,
        previewErrorMessage:
          error instanceof Error ? error.message : 'Could not preview the reviewed DXF units.',
        selection,
        unitCandidates
      };
    }
  }

  function handleDxfImportUnitCandidateChange(candidateId: string) {
    setImportErrorMessage(null);
    setPendingDxfImport((current) => {
      if (!current || !current.unitCandidates.some(({ id }) => id === candidateId)) return current;
      return buildPendingDxfImport(current.preparation, {
        ...current.selection,
        unitCandidateId: candidateId
      });
    });
  }

  function handleDxfImportMachineProfileChange(profileId: string) {
    setImportErrorMessage(null);
    setPendingDxfImport((current) => {
      if (!current) return current;
      try {
        const unitCandidates = appServices.unitCandidatesForDxfImport(
          current.preparation,
          profileId
        );
        const unitCandidateId = unitCandidates.some(
          ({ id }) => id === current.selection.unitCandidateId
        )
          ? current.selection.unitCandidateId
          : unitCandidates[0]?.id;
        if (!unitCandidateId) return current;
        return buildPendingDxfImport(
          current.preparation,
          { machineProfileId: profileId, unitCandidateId },
          unitCandidateId === current.selection.unitCandidateId
            ? current.declaredUnitOverrideAcknowledged
            : false
        );
      } catch (error) {
        return {
          ...current,
          preview: null,
          previewErrorMessage:
            error instanceof Error ? error.message : 'Could not select the machine profile.'
        };
      }
    });
  }

  function handleDxfImportOverrideAcknowledgedChange(acknowledged: boolean) {
    setPendingDxfImport((current) => current
      ? { ...current, declaredUnitOverrideAcknowledged: acknowledged }
      : current
    );
  }

  function handleCancelDxfImport() {
    if (workbenchOperationRef.current !== null) return;
    setPendingDxfImport(null);
    setImportStatus('idle');
    setImportErrorMessage(null);
  }

  async function handleConfirmDxfImport() {
    if (!connectedWorkbench || !pendingDxfImport || importStatus === 'importing') return;
    const operationId = beginWorkbenchOperation('dxf-import');
    if (operationId === null) return;
    const workbench = connectedWorkbench;
    const pending = pendingDxfImport;

    setImportStatus('importing');
    setImportErrorMessage(null);

    try {
      const result = await appServices.commitDxfProjectImport(workbench, pending.preparation, {
        ...pending.selection,
        confirmed: true,
        declaredUnitOverrideAcknowledged: pending.declaredUnitOverrideAcknowledged
      });
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      setLatestImport(result);
      setPendingDxfImport(null);

      try {
        const editorProgram = await appServices.loadEditorProgram(result.workbench, result.project);
        if (!isCurrentWorkbenchOperation(operationId)) return;
        setLoadedEditorProgram(editorProgram);
        resetEditorLoadState();
        setActiveView('editor');
        setImportStatus('idle');
        showStatusToast(`DXF imported and opened: ${pending.preparation.fileName}`, 'success');
      } catch (error) {
        if (!isCurrentWorkbenchOperation(operationId)) return;
        setImportStatus('error');
        const detail = error instanceof Error ? error.message : 'Could not open the imported project.';
        const message = `DXF was imported, but the editor could not open it: ${detail}`;
        setImportErrorMessage(message);
        setActiveView('dashboard');
        showStatusToast(message, 'error');
      }
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

  function buildPendingDxfReimport(
    project: NonNullable<LoadedEditorProgram['project']>,
    preparation: DxfProjectReimportPreparation,
    selection: DxfImportSelection,
    declaredUnitOverrideAcknowledged = false,
    rebuildAcknowledged = false
  ): PendingDxfReimport {
    const unitCandidates = appServices.unitCandidatesForDxfImport(
      preparation,
      selection.machineProfileId
    );
    try {
      const preview = appServices.previewDxfProjectImport(preparation, selection);
      return {
        declaredUnitOverrideAcknowledged,
        preparation,
        preview,
        previewErrorMessage: null,
        project,
        rebuildAcknowledged,
        rebuildRequired: dxfProjectReimportRequiresRebuild(project, preview.unitCandidate),
        selection,
        unitCandidates
      };
    } catch (error) {
      return {
        declaredUnitOverrideAcknowledged,
        preparation,
        preview: null,
        previewErrorMessage:
          error instanceof Error ? error.message : 'Could not preview the revised DXF units.',
        project,
        rebuildAcknowledged,
        rebuildRequired: true,
        selection,
        unitCandidates
      };
    }
  }

  async function handlePrepareDxfReimport() {
    const project = loadedEditorProgram?.project;
    if (
      !connectedWorkbench ||
      !project ||
      loadedEditorProgram.model !== 'upid-document' ||
      pendingDxfReimport
    ) return;
    const operationId = beginWorkbenchOperation('dxf-reimport');
    if (operationId === null) return;
    const workbench = connectedWorkbench;
    setDxfReimportStatus('importing');
    setDxfReimportErrorMessage(null);
    try {
      const preparation = await appServices.prepareDxfProjectReimport(workbench, project);
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setPendingDxfReimport(
        buildPendingDxfReimport(project, preparation, preparation.defaultSelection)
      );
      setDxfReimportStatus('idle');
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      const message = error instanceof Error ? error.message : 'Could not read the persisted raw DXF.';
      setDxfReimportStatus('error');
      setDxfReimportErrorMessage(message);
      showStatusToast(message, 'error');
    } finally {
      finishWorkbenchOperation(operationId);
    }
  }

  function handleDxfReimportUnitCandidateChange(candidateId: string) {
    setDxfReimportErrorMessage(null);
    setPendingDxfReimport((current) => {
      if (!current || !current.unitCandidates.some(({ id }) => id === candidateId)) return current;
      return buildPendingDxfReimport(current.project, current.preparation, {
        ...current.selection,
        unitCandidateId: candidateId
      });
    });
  }

  function handleDxfReimportOverrideAcknowledgedChange(acknowledged: boolean) {
    setPendingDxfReimport((current) => current
      ? { ...current, declaredUnitOverrideAcknowledged: acknowledged }
      : current
    );
  }

  function handleDxfReimportRebuildAcknowledgedChange(acknowledged: boolean) {
    setPendingDxfReimport((current) => current
      ? { ...current, rebuildAcknowledged: acknowledged }
      : current
    );
  }

  function handleCancelDxfReimport() {
    if (workbenchOperationRef.current !== null) return;
    setPendingDxfReimport(null);
    setDxfReimportStatus('idle');
    setDxfReimportErrorMessage(null);
  }

  async function handleConfirmDxfReimport() {
    if (!connectedWorkbench || !pendingDxfReimport || dxfReimportStatus === 'importing') return;
    const operationId = beginWorkbenchOperation('dxf-reimport');
    if (operationId === null) return;
    const workbench = connectedWorkbench;
    const pending = pendingDxfReimport;
    setDxfReimportStatus('importing');
    setDxfReimportErrorMessage(null);
    try {
      const result = await appServices.commitDxfProjectReimport(
        workbench,
        pending.project,
        pending.preparation,
        {
          ...pending.selection,
          confirmed: true,
          declaredUnitOverrideAcknowledged: pending.declaredUnitOverrideAcknowledged,
          rebuildAcknowledged: pending.rebuildAcknowledged
        }
      );
      if (!isCurrentWorkbenchOperation(operationId)) return;
      setConnectedWorkbench(result.workbench);
      setLatestImport((current) => current?.project.id === result.project.id
        ? {
            ...current,
            workbench: result.workbench,
            project: result.project,
            pathDocument: result.pathDocument,
            pathDiagnostics: result.pathDocument.diagnostics
          }
        : current
      );
      setPendingDxfReimport(null);
      setDxfReimportStatus('idle');
      setDxfReimportErrorMessage(null);

      try {
        const editorProgram = await appServices.loadEditorProgram(result.workbench, result.project);
        if (!isCurrentWorkbenchOperation(operationId)) return;
        setLoadedEditorProgram(editorProgram);
        setEditorProgramRevision((current) => current + 1);
        resetEditorLoadState();
        showStatusToast('DXF units revised from the persisted raw source.', 'success');
      } catch (error) {
        if (!isCurrentWorkbenchOperation(operationId)) return;
        const detail = error instanceof Error
          ? error.message
          : 'Could not reload the revised project.';
        const message = `DXF units were saved, but the editor reload failed: ${detail}`;
        setLoadedEditorProgram({
          filePath: upidEditorDocumentPath(result.workbench, result.project),
          model: 'upid-document',
          parseResult: null,
          pathDocument: result.pathDocument,
          project: result.project,
          text: ''
        });
        setEditorProgramRevision((current) => current + 1);
        resetEditorLoadState();
        setDxfReimportStatus('error');
        setDxfReimportErrorMessage(message);
        showStatusToast(message, 'error');
      }
    } catch (error) {
      if (!isCurrentWorkbenchOperation(operationId)) return;
      const message = error instanceof Error ? error.message : 'Could not revise DXF units.';
      setDxfReimportStatus('error');
      setDxfReimportErrorMessage(message);
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
    pendingDxfImport,
    pendingDxfReimport,
    dxfReimportStatus,
    dxfReimportErrorMessage,
    editorProgramRevision,
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
    handleAcknowledgeMachineProfile,
    handleCreateBlankMachineProfile,
    handleCreateRobofilV2CandidateProfile,
    handleDeleteMachineProfile,
    handleDownloadEditorFile,
    handleDuplicateMachineProfile,
    handleExportMachineProfile,
    handleImportMachineProfileFile,
    handleImportDxfFile,
    handleCancelDxfImport,
    handleConfirmDxfImport,
    handleDxfImportMachineProfileChange,
    handleDxfImportOverrideAcknowledgedChange,
    handleDxfImportUnitCandidateChange,
    handlePrepareDxfReimport,
    handleCancelDxfReimport,
    handleConfirmDxfReimport,
    handleDxfReimportOverrideAcknowledgedChange,
    handleDxfReimportRebuildAcknowledgedChange,
    handleDxfReimportUnitCandidateChange,
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
    handleSaveMachineProfile,
    handleSaveWorkbenchSettings,
    handleSetDefaultMachineProfile,
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
