import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, FileCode, FileUp, FolderOpen, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ImportDxfProjectResult } from '@/domain/dxf/importDxfProject';
import type { UpdateWorkbenchSettingsInput } from '@/domain/storage/updateWorkbenchSettings';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';
import type { OutputExtension } from '@/domain/workbench/types';

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

interface SettingsDraft {
  customExtension: string;
  extension: OutputExtension;
  footer: string;
  header: string;
  lineEnding: 'lf' | 'crlf';
  sourceKey: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [settingsDraft, setSettingsDraft] = useState(() =>
    settingsDraftFromWorkbench(connectedWorkbench)
  );
  const isPreparing = workbenchStatus === 'initializing';
  const isSwitchingFolder = workbenchStatus === 'switching-folder';
  const isImporting = importStatus === 'importing';
  const isSavingSettings = settingsStatus === 'saving';
  const projects = connectedWorkbench?.manifest.projects ?? [];
  const latestSettingsDraft = settingsDraftFromWorkbench(connectedWorkbench);
  const activeSettingsDraft =
    settingsDraft.sourceKey === latestSettingsDraft.sourceKey ? settingsDraft : latestSettingsDraft;
  const storageLabel =
    connectedWorkbench?.adapter.kind === 'directory'
      ? 'Directory workbench active'
      : 'Browser cache workbench active';

  if (settingsDraft.sourceKey !== latestSettingsDraft.sourceKey) {
    setSettingsDraft(latestSettingsDraft);
  }

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportDxfFile(file);
    input.value = '';
  }

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onSaveWorkbenchSettings({
      header: activeSettingsDraft.header,
      footer: activeSettingsDraft.footer,
      output: {
        extension: activeSettingsDraft.extension,
        customExtension:
          activeSettingsDraft.extension === 'custom'
            ? activeSettingsDraft.customExtension
            : undefined,
        lineEnding: activeSettingsDraft.lineEnding
      }
    });
  }

  function updateSettingsDraft(patch: Partial<Omit<SettingsDraft, 'sourceKey'>>) {
    setSettingsDraft((current) => ({ ...current, ...patch }));
  }

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)]">
      <section className="border-b border-border bg-background/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase text-muted-foreground">Dashboard</p>
            <h2 className="mt-1 font-mono text-base font-semibold">
              {isPreparing ? 'Preparing browser cache workbench' : storageLabel}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              accept=".dxf,application/dxf"
              aria-label="DXF file"
              className="hidden"
              disabled={!connectedWorkbench || isPreparing || isImporting}
              onChange={handleFileInputChange}
              type="file"
            />
            <Button
              disabled={!connectedWorkbench || isPreparing || isImporting}
              onClick={() => fileInputRef.current?.click()}
              variant="default"
            >
              <FileUp />
              {isImporting ? 'Importing...' : 'Import DXF'}
            </Button>
            <Button
              disabled={!connectedWorkbench || isPreparing}
              onClick={onOpenEditor}
              variant="outline"
            >
              <FileCode />
              Open Editor
            </Button>
            {directoryAccessAvailable ? (
              <Button
                disabled={isPreparing || isSwitchingFolder}
                onClick={onConnectWorkbench}
                variant="outline"
              >
                <FolderOpen />
                {isSwitchingFolder ? 'Opening...' : 'Use Workbench Folder'}
              </Button>
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground">
                Folder picker unavailable
              </span>
            )}
          </div>
        </div>

        {importErrorMessage && (
          <p className="mt-3 border border-destructive bg-destructive/10 p-2 font-mono text-[10px] text-destructive">
            {importErrorMessage}
          </p>
        )}
      </section>

      <section className="grid min-h-0 grid-cols-[minmax(0,1fr)_340px] gap-3 p-3">
        <div className="min-h-0 border border-border bg-card">
          <div className="flex h-8 items-center justify-between border-b border-border px-3">
            <h3 className="font-mono text-xs font-semibold">Projects</h3>
            <span className="font-mono text-[10px] text-muted-foreground">
              {projects.length} {projects.length === 1 ? 'project' : 'projects'}
            </span>
          </div>
          <div className="p-3 font-mono text-[11px]">
            {projects.length > 0 ? (
              <div className="divide-y divide-border border border-border">
                {projects.map((project) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_84px_130px_72px] items-center gap-3 p-2"
                    key={project.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-foreground">{project.name}</p>
                      <p className="mt-1 truncate text-[10px] text-muted-foreground">
                        {project.path}
                      </p>
                    </div>
                    <span className="text-muted-foreground">{project.sourceKind.toUpperCase()}</span>
                    <span className="truncate text-muted-foreground">{project.updatedAt}</span>
                    <Button
                      aria-label={`Open project ${project.id} in editor`}
                      onClick={() => onOpenProject(project.path)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="border border-border bg-background/50 p-2 text-muted-foreground">
                No imported projects yet. Import a DXF to create a project in the active
                workbench.
              </p>
            )}
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] border border-border bg-card">
          <div className="h-8 border-b border-border px-3 py-2">
            <h3 className="font-mono text-xs font-semibold">Latest DXF Import</h3>
          </div>
          <div className="min-h-0 overflow-auto p-3 font-mono text-[11px]">
            {latestImport ? (
              <div className="space-y-3">
                <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2">
                  <dt className="text-muted-foreground">Project</dt>
                  <dd className="truncate">{latestImport.project.name}</dd>
                  <dt className="text-muted-foreground">Entities</dt>
                  <dd>{latestImport.entityCount}</dd>
                  <dt className="text-muted-foreground">Warnings</dt>
                  <dd>{latestImport.parseResult.warnings.length}</dd>
                  <dt className="text-muted-foreground">Program</dt>
                  <dd className="truncate">
                    {latestImport.project.generated.files.at(-1)?.path ?? 'generated'}
                  </dd>
                </dl>
                {latestImport.parseResult.warnings.length > 0 && (
                  <div className="border border-amber-500/50 bg-amber-500/10 p-2 text-amber-200">
                    {latestImport.parseResult.warnings.join('\n')}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button onClick={onOpenLatestImportInEditor} variant="default">
                    Open in Editor
                  </Button>
                  <Button onClick={onDownloadLatestProgram} variant="outline">
                    <Download />
                    Download Program
                  </Button>
                </div>
                <pre className="max-h-[360px] overflow-auto border border-border bg-background/70 p-2 text-[10px] leading-5 text-foreground">
                  {latestImport.generatedBody}
                </pre>
              </div>
            ) : (
              <dl className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-2">
                <dt className="text-muted-foreground">Manifest</dt>
                <dd>workbench.json</dd>
                <dt className="text-muted-foreground">Header</dt>
                <dd>templates/header.gcode</dd>
                <dt className="text-muted-foreground">Footer</dt>
                <dd>templates/footer.gcode</dd>
                <dt className="text-muted-foreground">Folders</dt>
                <dd>imports, generated, exports, templates, machines, editor, projects</dd>
                <dt className="text-muted-foreground">Feeds</dt>
                <dd>Not generated by default</dd>
              </dl>
            )}
            {connectedWorkbench && (
              <form className="mt-4 border-t border-border pt-3" onSubmit={handleSettingsSubmit}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="font-mono text-xs font-semibold">Workbench Settings</h3>
                  <Button disabled={isSavingSettings} size="sm" type="submit" variant="outline">
                    <Save />
                    {isSavingSettings ? 'Saving...' : 'Save Settings'}
                  </Button>
                </div>
                <div className="grid gap-2">
                  <label className="grid gap-1 text-muted-foreground">
                    Header
	                    <textarea
	                      aria-label="Header template"
	                      className="min-h-20 resize-y border border-border bg-background/70 p-2 font-mono text-[10px] leading-4 text-foreground outline-none focus:border-ring"
	                      disabled={isSavingSettings}
	                      onChange={(event) => updateSettingsDraft({ header: event.currentTarget.value })}
	                      spellCheck={false}
	                      value={activeSettingsDraft.header}
	                    />
                  </label>
                  <label className="grid gap-1 text-muted-foreground">
                    Footer
	                    <textarea
	                      aria-label="Footer template"
	                      className="min-h-20 resize-y border border-border bg-background/70 p-2 font-mono text-[10px] leading-4 text-foreground outline-none focus:border-ring"
	                      disabled={isSavingSettings}
	                      onChange={(event) => updateSettingsDraft({ footer: event.currentTarget.value })}
	                      spellCheck={false}
	                      value={activeSettingsDraft.footer}
	                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1 text-muted-foreground">
                      Extension
                      <select
                        aria-label="Output extension"
	                        className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
	                        disabled={isSavingSettings}
	                        onChange={(event) =>
	                          updateSettingsDraft({
	                            extension: event.currentTarget.value as OutputExtension
	                          })
	                        }
	                        value={activeSettingsDraft.extension}
                      >
                        <option value="iso">.iso</option>
                        <option value="nc">.nc</option>
                        <option value="gcode">.gcode</option>
                        <option value="custom">custom</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-muted-foreground">
                      Line Ending
                      <select
                        aria-label="Line ending"
	                        className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
	                        disabled={isSavingSettings}
	                        onChange={(event) =>
	                          updateSettingsDraft({
	                            lineEnding: event.currentTarget.value as 'lf' | 'crlf'
	                          })
	                        }
	                        value={activeSettingsDraft.lineEnding}
                      >
                        <option value="crlf">CRLF</option>
                        <option value="lf">LF</option>
                      </select>
                    </label>
                  </div>
	                  {activeSettingsDraft.extension === 'custom' && (
	                    <label className="grid gap-1 text-muted-foreground">
	                      Custom Extension
	                      <input
	                        aria-label="Custom output extension"
	                        className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
	                        disabled={isSavingSettings}
	                        onChange={(event) =>
	                          updateSettingsDraft({ customExtension: event.currentTarget.value })
	                        }
	                        value={activeSettingsDraft.customExtension}
	                      />
	                    </label>
	                  )}
                  {settingsStatus === 'saved' && (
                    <p className="border border-emerald-500/50 bg-emerald-500/10 p-2 text-emerald-200">
                      Settings saved
                    </p>
                  )}
                  {settingsErrorMessage && (
                    <p className="border border-destructive bg-destructive/10 p-2 text-destructive">
                      {settingsErrorMessage}
                    </p>
                  )}
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function settingsDraftFromWorkbench(workbench: ConnectedWorkbench | null): SettingsDraft {
  if (!workbench) {
    return {
      customExtension: '',
      extension: 'iso',
      footer: '',
      header: '',
      lineEnding: 'crlf',
      sourceKey: 'none'
    };
  }

  const output = workbench.manifest.output;

  return {
    customExtension: output.customExtension ?? '',
    extension: output.extension,
    footer: workbench.footer,
    header: workbench.header,
    lineEnding: output.lineEnding,
    sourceKey: [
      workbench.adapter.kind,
      workbench.manifest.updatedAt,
      workbench.header,
      workbench.footer,
      output.extension,
      output.customExtension ?? '',
      output.lineEnding
    ].join('\u0000')
  };
}
