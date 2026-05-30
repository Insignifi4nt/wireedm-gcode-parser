import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import { DashboardHeader } from './DashboardHeader';
import { LatestDxfImportPanel } from './LatestDxfImportPanel';
import { ProjectListPanel } from './ProjectListPanel';
import { WorkbenchSettingsPanel } from './WorkbenchSettingsPanel';

interface DashboardPageProps {
  workbenchStatus: 'initializing' | 'ready' | 'switching-folder' | 'error';
  connectedWorkbench: ConnectedWorkbench | null;
  directoryAccessAvailable: boolean;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  latestImport: ImportDxfProjectResult | null;
  settingsStatus: 'idle' | 'saving' | 'saved' | 'error';
  settingsErrorMessage: string | null;
  onConnectWorkbench: () => void;
  onDownloadLatestProgram: () => void;
  onOpenEditor: () => void;
  onOpenLatestImportInEditor: () => void;
  onOpenProject: (projectPath: string) => void | Promise<void>;
  onImportDxfFile: (file: File) => void | Promise<void>;
  onSaveWorkbenchSettings: (input: UpdateWorkbenchSettingsInput) => void | Promise<void>;
}

export function DashboardPage({
  workbenchStatus,
  connectedWorkbench,
  directoryAccessAvailable,
  importStatus,
  importErrorMessage,
  latestImport,
  settingsStatus,
  settingsErrorMessage,
  onConnectWorkbench,
  onDownloadLatestProgram,
  onOpenEditor,
  onOpenLatestImportInEditor,
  onOpenProject,
  onImportDxfFile,
  onSaveWorkbenchSettings
}: DashboardPageProps) {
  const projects = connectedWorkbench?.manifest.projects ?? [];

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <DashboardHeader
        connectedWorkbench={connectedWorkbench}
        directoryAccessAvailable={directoryAccessAvailable}
        importErrorMessage={importErrorMessage}
        importStatus={importStatus}
        onConnectWorkbench={onConnectWorkbench}
        onImportDxfFile={onImportDxfFile}
        onOpenEditor={onOpenEditor}
        workbenchStatus={workbenchStatus}
      />

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-3 p-3">
        <ProjectListPanel onOpenProject={onOpenProject} projects={projects} />

        <LatestDxfImportPanel
          latestImport={latestImport}
          onDownloadLatestProgram={onDownloadLatestProgram}
          onOpenLatestImportInEditor={onOpenLatestImportInEditor}
        >
          <WorkbenchSettingsPanel
            connectedWorkbench={connectedWorkbench}
            onSaveWorkbenchSettings={onSaveWorkbenchSettings}
            settingsErrorMessage={settingsErrorMessage}
            settingsStatus={settingsStatus}
          />
        </LatestDxfImportPanel>
      </section>
    </div>
  );
}
