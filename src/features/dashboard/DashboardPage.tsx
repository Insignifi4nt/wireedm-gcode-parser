import { useEffect, useRef, useState } from 'react';

import type { ImportedDxfProject } from '@/domain/dxf/importDxfProject';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import { DashboardHeader } from './DashboardHeader';
import { DeletedProjectsPanel } from './DeletedProjectsPanel';
import { DxfImportConfirmationDialog } from './DxfImportConfirmationDialog';
import { LatestDxfImportPanel } from './LatestDxfImportPanel';
import { ProjectActionDialog, type ProjectAction } from './ProjectActionDialog';
import { ProjectListPanel } from './ProjectListPanel';
import { StartWorkPanel } from './StartWorkPanel';
import type { PendingDashboardDxfImport } from './dashboardTypes';

interface DashboardPageProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbenchCatalog | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  interactionLocked: boolean;
  programImportStatus: 'idle' | 'importing' | 'error';
  programImportErrorMessage: string | null;
  latestImport: ImportedDxfProject | null;
  pendingDxfImport: PendingDashboardDxfImport | null;
  onOpenEditor: () => void;
  onOpenLatestImportInEditor: () => void;
  onOpenProject: (projectId: string) => void | Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onRestoreProject: (projectId: string) => Promise<void>;
  onExportUpidProject: (projectId: string) => Promise<void>;
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
  interactionLocked,
  programImportStatus,
  programImportErrorMessage,
  latestImport,
  pendingDxfImport,
  onOpenEditor,
  onOpenLatestImportInEditor,
  onOpenProject,
  onDeleteProject,
  onRestoreProject,
  onExportUpidProject,
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
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
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

  return (
    <div
      ref={pageRef}
      className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]"
      data-workbench-page
    >
      <DashboardHeader
        connectedWorkbench={connectedWorkbench}
        workbenchStatus={workbenchStatus}
      />

      <section
        className="work-region-scrollbar grid min-h-0 content-start gap-3 overflow-auto p-3 min-[1180px]:grid-cols-[minmax(0,1fr)_332px] min-[1180px]:items-start"
        data-workbench-scroll-region
      >
        <ProjectListPanel
          availability={connectedWorkbench ? 'ready' : workbenchStatus === 'initializing' || workbenchStatus === 'connecting-storage' ? 'loading' : 'unavailable'}
          interactionLocked={interactionLocked}
          onDeleteProject={(project) => setProjectAction({ kind: 'delete', project })}
          onExportUpidProject={onExportUpidProject}
          onOpenProject={onOpenProject}
          onRenameProject={(project) => setProjectAction({ kind: 'rename', project })}
          projects={projects}
        />

        <div className="grid content-start gap-3">
          <DeletedProjectsPanel
            entries={connectedWorkbench?.manifest.deletedProjects ?? []}
            interactionLocked={interactionLocked}
            onRestoreProject={restoreProject}
          />
          <StartWorkPanel
            connected={Boolean(connectedWorkbench)}
            dxfErrorMessage={importErrorMessage}
            dxfImporting={importStatus === 'importing'}
            interactionLocked={interactionLocked}
            onImportDxfFile={onImportDxfFile}
            onImportUpidFile={onImportUpidFile}
            onImportProgramFile={onImportProgramFile}
            onOpenEditor={onOpenEditor}
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
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
      />

      {pendingDxfImport && (
        <DxfImportConfirmationDialog
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
