import { useState } from 'react';

import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { DashboardHeader } from './DashboardHeader';
import { LatestDxfImportPanel } from './LatestDxfImportPanel';
import { ProjectActionDialog, type ProjectAction } from './ProjectActionDialog';
import { ProjectListPanel } from './ProjectListPanel';
import { StartWorkPanel } from './StartWorkPanel';
import { WorkbenchSettingsPanel } from './WorkbenchSettingsPanel';

interface DashboardPageProps {
  workbenchStatus: 'initializing' | 'ready' | 'connecting-storage' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  programImportStatus: 'idle' | 'importing' | 'error';
  programImportErrorMessage: string | null;
  latestImport: ImportDxfProjectResult | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  settingsErrorMessage: string | null;
  onOpenEditor: () => void;
  onOpenLatestImportInEditor: () => void;
  onOpenProject: (projectPath: string) => void | Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onRenameProject: (projectId: string, name: string) => Promise<void>;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
}

export function DashboardPage({
  workbenchStatus,
  connectedWorkbench,
  importStatus,
  importErrorMessage,
  programImportStatus,
  programImportErrorMessage,
  latestImport,
  settingsStatus,
  settingsErrorMessage,
  onOpenEditor,
  onOpenLatestImportInEditor,
  onOpenProject,
  onDeleteProject,
  onRenameProject,
  onImportDxfFile,
  onImportProgramFile,
  onSaveWorkbenchSettings
}: DashboardPageProps) {
  const projects = connectedWorkbench?.manifest.projects ?? [];
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);

  function closeProjectAction() {
    setProjectAction(null);
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <DashboardHeader
        connectedWorkbench={connectedWorkbench}
        workbenchStatus={workbenchStatus}
      />

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-3 p-3">
        <ProjectListPanel
          onDeleteProject={(project) => setProjectAction({ kind: 'delete', project })}
          onOpenProject={onOpenProject}
          onRenameProject={(project) => setProjectAction({ kind: 'rename', project })}
          projects={projects}
        />

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
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

          {latestImport ? (
            <LatestDxfImportPanel
              latestImport={latestImport}
              onOpenLatestImportInEditor={onOpenLatestImportInEditor}
            >
              <WorkbenchSettingsPanel
                connectedWorkbench={connectedWorkbench}
                onSaveWorkbenchSettings={onSaveWorkbenchSettings}
                settingsErrorMessage={settingsErrorMessage}
                settingsStatus={settingsStatus}
              />
            </LatestDxfImportPanel>
          ) : (
            <div className="min-h-0 overflow-auto border border-border bg-card p-3">
              <WorkbenchSettingsPanel
                connectedWorkbench={connectedWorkbench}
                onSaveWorkbenchSettings={onSaveWorkbenchSettings}
                settingsErrorMessage={settingsErrorMessage}
                settingsStatus={settingsStatus}
              />
            </div>
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
