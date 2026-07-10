import { useState } from 'react';

import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { DashboardHeader } from './DashboardHeader';
import { LatestDxfImportPanel } from './LatestDxfImportPanel';
import { ProjectActionDialog, type ProjectAction } from './ProjectActionDialog';
import { ProjectListPanel } from './ProjectListPanel';
import { StartWorkPanel } from './StartWorkPanel';

interface DashboardPageProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  programImportStatus: 'idle' | 'importing' | 'error';
  programImportErrorMessage: string | null;
  latestImport: ImportDxfProjectResult | null;
  onOpenEditor: () => void;
  onOpenLatestImportInEditor: () => void;
  onOpenProject: (projectPath: string) => void | Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportProgramFile: (file: File) => void | Promise<void>;
}

export function DashboardPage({
  workbenchStatus,
  connectedWorkbench,
  importStatus,
  importErrorMessage,
  programImportStatus,
  programImportErrorMessage,
  latestImport,
  onOpenEditor,
  onOpenLatestImportInEditor,
  onOpenProject,
  onDeleteProject,
  onRenameProject,
  onImportDxfFile,
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

      <section className="grid min-h-0 content-start gap-3 overflow-auto p-3 min-[1180px]:grid-cols-[minmax(0,1fr)_340px] min-[1180px]:items-start">
        <ProjectListPanel
          onDeleteProject={(project) => setProjectAction({ kind: 'delete', project })}
          onOpenProject={onOpenProject}
          onRenameProject={(project) => setProjectAction({ kind: 'rename', project })}
          projects={projects}
        />

        <div className="grid content-start gap-3">
          <StartWorkPanel
            connected={Boolean(connectedWorkbench)}
            dxfErrorMessage={importErrorMessage}
            dxfImporting={importStatus === 'importing'}
            onImportDxfFile={onImportDxfFile}
            onImportProgramFile={onImportProgramFile}
            onOpenEditor={onOpenEditor}
            programErrorMessage={programImportErrorMessage}
            programImporting={programImportStatus === 'importing'}
          />

          {latestImport && (
            <LatestDxfImportPanel
              latestImport={latestImport}
              onOpenLatestImportInEditor={onOpenLatestImportInEditor}
            />
          )}
        </div>
      </section>

      <ProjectActionDialog
        action={projectAction}
        onClose={closeProjectAction}
        onDeleteProject={onDeleteProject}
        onRenameProject={onRenameProject}
      />
    </div>
  );
}
