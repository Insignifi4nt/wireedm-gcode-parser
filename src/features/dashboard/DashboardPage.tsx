import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import type { ImportedDxfProject } from '@/domain/dxf/importDxfProject';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { archiveCadDocument, CadStorageError, loadCadDocument, renameCadDocument, restoreCadDocument } from '@/domain/cad/cadStorage';
import { downloadProgramFile } from '@/domain/post/downloadProgramFile';
import type { StatusToastType } from '@/components/StatusToasts';
import { useCadProjectLibrary } from './useCadProjectLibrary';

import { DxfImportConfirmationDialog } from './DxfImportConfirmationDialog';
import { LatestDxfImportPanel } from './LatestDxfImportPanel';
import { ProjectActionDialog, type ProjectAction } from './ProjectActionDialog';
import { ProjectListPanel } from './ProjectListPanel';
import { ProjectRevisionsDialog } from './ProjectRevisionsDialog';
import { StartWorkPanel } from './StartWorkPanel';
import type { PendingDashboardDxfImport } from './dashboardTypes';

const GCodeInspectionDialog = lazy(() => import('@/features/editor/GCodeInspectionDialog')
  .then((module) => ({ default: module.GCodeInspectionDialog })));

interface DashboardPageProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbenchCatalog | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  dxfWriting?: boolean;
  dxfImportCancellable?: boolean;
  interactionLocked: boolean;
  programImportStatus: 'idle' | 'importing' | 'error';
  programImportErrorMessage: string | null;
  latestImport: ImportedDxfProject | null;
  pendingDxfImport: PendingDashboardDxfImport | null;
  onOpenEditor: () => void;
  onOpenCad?: () => void;
  onOpenCadProject?: (projectId: string) => void | Promise<void>;
  cadLibraryVersion?: string | number;
  onStatusMessage?: (message: string, type?: StatusToastType) => void;
  cadProjectActions?: {
    rename: typeof renameCadDocument;
    archive: typeof archiveCadDocument;
    restore: typeof restoreCadDocument;
  };
  onOpenLatestImportInEditor: () => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onDeleteSavedRevisions: (projectId: string, revisionIds: readonly string[]) => Promise<void>;
  onRestoreProject: (projectId: string) => Promise<void>;
  onPurgeArchivedProject: (projectId: string) => Promise<void>;
  onExportUpidProject: (projectId: string) => Promise<void>;
  onSaveUpidProjectAs: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportUpidFile: (file: File) => void | Promise<void>;
  onCancelDxfImport: () => void;
  onConfirmDxfImport: () => void | Promise<void>;
  onDxfImportOverrideAcknowledgedChange: (acknowledged: boolean) => void;
  onDxfImportUnitCandidateChange: (candidateId: string) => void;
  onImportProgramFile: (file: File) => void | Promise<void>;
}

export function DashboardPage({
  workbenchStatus,
  connectedWorkbench,
  importStatus,
  importErrorMessage,
  dxfWriting,
  dxfImportCancellable,
  interactionLocked,
  programImportStatus,
  programImportErrorMessage,
  latestImport,
  pendingDxfImport,
  onOpenEditor,
  onOpenCad,
  onOpenCadProject,
  cadLibraryVersion,
  onStatusMessage,
  cadProjectActions,
  onOpenLatestImportInEditor,
  onOpenProject,
  onDeleteProject,
  onDeleteSavedRevisions,
  onRestoreProject,
  onPurgeArchivedProject,
  onExportUpidProject,
  onSaveUpidProjectAs,
  onRenameProject,
  onImportDxfFile,
  onImportUpidFile,
  onCancelDxfImport,
  onConfirmDxfImport,
  onDxfImportOverrideAcknowledgedChange,
  onDxfImportUnitCandidateChange,
  onImportProgramFile
}: DashboardPageProps) {
  const projects = connectedWorkbench?.manifest.projects ?? [];
  const adapter = connectedWorkbench?.adapter ?? null;
  const cadLibrary = useCadProjectLibrary(adapter, cadLibraryVersion);
  const [cadBusy, setCadBusy] = useState(false);
  const cadActionAbort = useRef<AbortController | null>(null);
  const statusRef = useRef(onStatusMessage);
  statusRef.current = onStatusMessage;
  const locked = interactionLocked || cadBusy;
  useEffect(() => {
    setProjectAction(null); setRevisionProject(null);
    return () => cadActionAbort.current?.abort();
  }, [adapter]);
  useEffect(() => {
    const snapshot = cadLibrary.snapshot;
    if (snapshot.kind === 'error') statusRef.current?.(snapshot.message, 'error');
    else if (snapshot.kind === 'ready' && !snapshot.refreshing && (snapshot.library.diagnostics.length || snapshot.library.truncated)) {
      statusRef.current?.([
        snapshot.library.truncated ? 'The CAD project inventory is incomplete.' : '',
        ...snapshot.library.diagnostics.map(diagnostic => `${diagnostic.path}: ${diagnostic.message}`)
      ].filter(Boolean).join('\n'), 'warning');
    }
  }, [cadLibrary.snapshot]);
  const [inspectingGCode, setInspectingGCode] = useState(false);
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
  const [revisionProject, setRevisionProject] = useState<(typeof projects)[number] | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [restoredProjectId, setRestoredProjectId] = useState<string | null>(null);
  useEffect(() => {
    if (restoredProjectId === null) return;
    const openButton = [...(pageRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
      .find((button) => button.getAttribute('aria-label') === `Open project ${restoredProjectId} in editor`);
    if (!openButton || openButton.disabled) return;
    openButton.focus();
    setRestoredProjectId(null);
  }, [restoredProjectId, connectedWorkbench, interactionLocked]);

  async function restoreProject(projectId: string) {
    await onRestoreProject(projectId);
    setRestoredProjectId(projectId);
  }

  function closeProjectAction() {
    setProjectAction(null);
  }

  async function changeCadProject<Result>(action: (storage: NonNullable<typeof adapter>, signal: AbortSignal) => Promise<Result>, refresh = true) {
    if (!adapter || interactionLocked || cadActionAbort.current) throw new Error('Wait for the current workbench operation to finish.');
    const controller = new AbortController();
    cadActionAbort.current = controller; setCadBusy(true);
    try {
      const result = await action(adapter, controller.signal);
      if (refresh && !controller.signal.aborted) cadLibrary.refresh();
      return result;
    } finally {
      if (cadActionAbort.current === controller) { cadActionAbort.current = null; setCadBusy(false); }
    }
  }

  return (
    <div
      ref={pageRef}
      className="h-full min-h-0"
      data-workbench-page
    >
      <section
        className="work-region-scrollbar dashboard-layout"
        data-workbench-scroll-region
      >
        <ProjectListPanel
          availability={connectedWorkbench ? 'ready' : workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage' ? 'loading' : 'unavailable'}
          interactionLocked={locked}
          onDeleteProject={(project) => setProjectAction({ kind: 'delete', project })}
          onExportUpidProject={onExportUpidProject}
          onSaveUpidProjectAs={onSaveUpidProjectAs}
          onOpenProject={onOpenProject}
          onShowRevisions={setRevisionProject}
          onRenameProject={(project) => setProjectAction({ kind: 'rename', project })}
          projects={projects}
          archivedProjects={connectedWorkbench?.manifest.deletedProjects}
          cadProjects={cadLibrary.snapshot.kind === 'ready' ? cadLibrary.snapshot.library.entries : []}
          cadArchivedProjects={cadLibrary.snapshot.kind === 'ready' ? cadLibrary.snapshot.library.archivedEntries : []}
          cadLoading={cadLibrary.snapshot.kind === 'loading' || (cadLibrary.snapshot.kind === 'ready' && cadLibrary.snapshot.refreshing)}
          cadUnavailable={cadLibrary.snapshot.kind === 'error' || (cadLibrary.snapshot.kind === 'ready' &&
            (cadLibrary.snapshot.library.diagnostics.length > 0 || cadLibrary.snapshot.library.truncated))}
          onOpenCadProject={onOpenCadProject}
          onRenameCadProject={project => setProjectAction({ kind: 'rename', project })}
          onArchiveCadProject={project => setProjectAction({ kind: 'delete', project })}
          onExportCadProject={project => changeCadProject(async (storage, signal) => {
            const saved = await loadCadDocument(storage, project.id, signal);
            signal.throwIfAborted();
            if (saved.savedVersion !== project.savedVersion) throw new CadStorageError('SAVED_DOCUMENT_CHANGED', 'This CAD project changed in storage. Refresh the project library before downloading.');
            downloadProgramFile({ fileName: `${project.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100) || 'part'}.cad.json`,
              mimeType: 'application/json', text: JSON.stringify(saved.document) });
          }, false)}
          onRestoreProject={restoreProject}
          onRestoreCadProject={path => changeCadProject(async (storage, signal) => {
            await (cadProjectActions?.restore ?? restoreCadDocument)(storage, path, signal);
            statusRef.current?.('CAD project restored.', 'success');
          })}
          onPurgeArchivedProject={project => setProjectAction({ kind: 'purge', project })}
          onActionError={message => statusRef.current?.(message, 'error')}
        />

        <div className="grid content-start gap-3">
          <StartWorkPanel
            connected={Boolean(connectedWorkbench)}
            dxfErrorMessage={importErrorMessage}
            dxfImporting={importStatus === 'importing'}
            interactionLocked={locked}
            onImportDxfFile={onImportDxfFile}
            onCancelDxfImport={dxfImportCancellable ? onCancelDxfImport : undefined}
            onImportUpidFile={onImportUpidFile}
            onImportProgramFile={onImportProgramFile}
            onOpenEditor={onOpenEditor}
            onOpenCad={onOpenCad}
            onInspectGCode={() => setInspectingGCode(true)}
            programErrorMessage={programImportErrorMessage}
            programImporting={programImportStatus === 'importing'}
          />
          {latestImport && (
            <LatestDxfImportPanel
              interactionLocked={interactionLocked}
              latestImport={latestImport}
              onOpenLatestImportInEditor={onOpenLatestImportInEditor}
            />
          )}
        </div>
      </section>

      <ProjectActionDialog
        action={projectAction}
        interactionLocked={interactionLocked}
        onClose={closeProjectAction}
        onDeleteProject={id => {
          const project = projectAction?.project;
          return project?.sourceKind === 'cad' ? changeCadProject(async (storage, signal) => {
            await (cadProjectActions?.archive ?? archiveCadDocument)(storage, id, { expectedSavedVersion: project.savedVersion, signal });
            statusRef.current?.('CAD project moved to Archive.', 'success');
          }) : onDeleteProject(id);
        }}
        onRenameProject={(id, name) => {
          const project = projectAction?.project;
          return project?.sourceKind === 'cad' ? changeCadProject(async (storage, signal) => {
            await (cadProjectActions?.rename ?? renameCadDocument)(storage, id, name, { expectedSavedVersion: project.savedVersion, signal });
            statusRef.current?.('CAD project renamed.', 'success');
          }) : onRenameProject(id, name);
        }}
        onPurgeProject={onPurgeArchivedProject}
      />
      {inspectingGCode && <Suspense fallback={<p role="status">Opening G-code inspection…</p>}>
        <GCodeInspectionDialog onClose={() => setInspectingGCode(false)} />
      </Suspense>}

      {revisionProject && connectedWorkbench && (
        <ProjectRevisionsDialog
          workbench={connectedWorkbench}
          projectId={revisionProject.id}
          projectName={revisionProject.name}
          onClose={() => setRevisionProject(null)}
          onDeleteRevisions={onDeleteSavedRevisions}
        />
      )}

      {pendingDxfImport && (
        <DxfImportConfirmationDialog
          cancellationBlocked={dxfWriting}
          declaredUnitOverrideAcknowledged={pendingDxfImport.declaredUnitOverrideAcknowledged}
          errorMessage={importErrorMessage}
          onCancel={onCancelDxfImport}
          onConfirm={onConfirmDxfImport}
          onOverrideAcknowledgedChange={onDxfImportOverrideAcknowledgedChange}
          onUnitCandidateChange={onDxfImportUnitCandidateChange}
          planningMachineFit={pendingDxfImport.planningMachineFit}
          preparationResult={pendingDxfImport.preparationResult}
          previewResult={pendingDxfImport.previewResult}
          selectedUnitCandidateId={pendingDxfImport.selectedUnitCandidateId}
          submitting={importStatus === 'importing'}
        />
      )}
    </div>
  );
}
