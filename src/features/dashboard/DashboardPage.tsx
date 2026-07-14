import { useState } from 'react';

import type { PendingDxfImport } from '@/app/useWorkbenchAppController';
import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { DashboardHeader } from './DashboardHeader';
import { DxfImportConfirmationDialog } from './DxfImportConfirmationDialog';
import { LatestDxfImportPanel } from './LatestDxfImportPanel';
import { ProjectActionDialog, type ProjectAction } from './ProjectActionDialog';
import { ProjectListPanel } from './ProjectListPanel';
import { StartWorkPanel } from './StartWorkPanel';

interface DashboardPageProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  interactionLocked: boolean;
  programImportStatus: 'idle' | 'importing' | 'error';
  programImportErrorMessage: string | null;
  latestImport: ImportDxfProjectResult | null;
  pendingDxfImport: PendingDxfImport | null;
  onOpenEditor: () => void;
  onOpenLatestImportInEditor: () => void;
  onOpenProject: (projectPath: string) => void | Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onExportUpidProject: (projectPath: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportUpidFile: (file: File) => void | Promise<void>;
  onCancelDxfImport: () => void;
  onConfirmDxfImport: () => void | Promise<void>;
  onDxfImportMachineProfileChange: (profileId: string) => void;
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
  onExportUpidProject,
  onRenameProject,
  onImportDxfFile,
  onImportUpidFile,
  onCancelDxfImport,
  onConfirmDxfImport,
  onDxfImportMachineProfileChange,
  onDxfImportOverrideAcknowledgedChange,
  onDxfImportUnitCandidateChange,
  onImportProgramFile
}: DashboardPageProps) {
  const projects = connectedWorkbench?.manifest.projects ?? [];
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);

  function closeProjectAction() {
    setProjectAction(null);
  }

  return (
    <div
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
          interactionLocked={interactionLocked}
          onDeleteProject={(project) => setProjectAction({ kind: 'delete', project })}
          onExportUpidProject={(project) => onExportUpidProject(project.path)}
          onOpenProject={onOpenProject}
          onRenameProject={(project) => setProjectAction({ kind: 'rename', project })}
          projects={projects}
        />

        <div className="grid content-start gap-3">
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
          onMachineProfileChange={onDxfImportMachineProfileChange}
          onOverrideAcknowledgedChange={onDxfImportOverrideAcknowledgedChange}
          onUnitCandidateChange={onDxfImportUnitCandidateChange}
          preparation={pendingDxfImport.preparation}
          preview={pendingDxfImport.preview}
          previewErrorMessage={pendingDxfImport.previewErrorMessage}
          selection={pendingDxfImport.selection}
          submitting={importStatus === 'importing'}
          unitCandidates={pendingDxfImport.unitCandidates}
        />
      )}
    </div>
  );
}
