import { SearchField } from '@/components/ui/search-field';
import { Tooltip } from '@/components/ui/tooltip';
import { MenuSurface, MenuItem } from '@/components/ui/menu';
import { Select } from '@/components/ui/select';
import { useRef, useState } from 'react';
import { Box, ChevronDown, Download, FileCode, History, Pencil, Save, Trash2, Waypoints } from '@wire-edm/icons-react';

import { Button } from '@/components/ui/button';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';
import { supportsSaveTextFileAs } from '@/domain/post/saveTextFileAs';
import type { ArchivedCadLibraryEntry, CadLibraryEntry } from '@/domain/cad/cadStorage';
import { dashboardProjectRows, projectSourceLabel, visibleDashboardProjects, type CadDashboardProject, type DashboardProject, type ProjectSourceFilter, type ProjectSortMode, type ProjectStateFilter } from './dashboardProjects';
import { useDashboardMenu } from './useDashboardMenu';
import './dashboard.css';

type WorkbenchProjectIndexEntry = WorkbenchCatalogManifest['projects'][number];

interface ProjectListPanelProps {
  availability: 'loading' | 'unavailable' | 'ready';
  interactionLocked: boolean;
  projects: readonly WorkbenchProjectIndexEntry[];
  onOpenProject: (projectId: string) => void | Promise<void>;
  onDeleteProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
  onExportUpidProject: (projectId: string) => void | Promise<void>;
  onSaveUpidProjectAs: (projectId: string) => void | Promise<void>;
  onShowRevisions: (project: WorkbenchProjectIndexEntry) => void;
  onRenameProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
  cadProjects?: readonly CadLibraryEntry[];
  archivedProjects?: NonNullable<WorkbenchCatalogManifest['deletedProjects']>;
  cadArchivedProjects?: readonly ArchivedCadLibraryEntry[];
  cadLoading?: boolean;
  onOpenCadProject?: (projectId: string) => void | Promise<void>;
  onRenameCadProject?: (project: CadDashboardProject) => void | Promise<void>;
  onArchiveCadProject?: (project: CadDashboardProject) => void | Promise<void>;
  onExportCadProject?: (project: CadDashboardProject) => void | Promise<void>;
  onRestoreProject?: (projectId: string) => Promise<void>;
  onRestoreCadProject?: (archivePath: string) => Promise<void>;
  onPurgeArchivedProject?: (project: WorkbenchProjectIndexEntry) => void;
  onActionError?: (message: string) => void;
}

export function ProjectListPanel({
  availability,
  interactionLocked,
  projects,
  onDeleteProject,
  onExportUpidProject,
  onSaveUpidProjectAs,
  onShowRevisions,
  onOpenProject,
  onRenameProject,
  cadProjects,
  archivedProjects,
  cadArchivedProjects,
  cadLoading,
  onOpenCadProject,
  onRenameCadProject,
  onArchiveCadProject,
  onExportCadProject,
  onRestoreProject,
  onRestoreCadProject,
  onPurgeArchivedProject,
  onActionError
}: ProjectListPanelProps) {
  const [searchText, setSearchText] = useState('');
  const [sourceFilter, setSourceFilter] = useState<ProjectSourceFilter>('all');
  const [stateFilter, setStateFilter] = useState<ProjectStateFilter>('active');
  const [sortMode, setSortMode] = useState<ProjectSortMode>('updated-desc');
  const menu = useDashboardMenu(interactionLocked || availability !== 'ready');
  const exportMenuProjectId = interactionLocked ? null : menu.openId;
  const saveAsAvailable = supportsSaveTextFileAs();

  function runExport(projectId: string, chooseLocation: boolean) {
    menu.close(true);
    if (chooseLocation) void onSaveUpidProjectAs(projectId);
    else void onExportUpidProject(projectId);
  }
  const rows = dashboardProjectRows({ projects, cadProjects, archivedProjects, cadArchivedProjects });
  const visibleProjects = visibleDashboardProjects(rows, searchText, stateFilter, sourceFilter, sortMode);
  const projectCountLabel =
    `${visibleProjects.length} ${visibleProjects.length === 1 ? 'project' : 'projects'}`;
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  async function runAction(action: () => void | Promise<void>, restored = false) {
    if (pendingRef.current || interactionLocked) return;
    pendingRef.current = true;
    setPending(true); setActionError(null);
    try { await action(); if (restored) setStateFilter('active'); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Could not update this project.';
      if (onActionError) onActionError(message); else setActionError(message);
    } finally { pendingRef.current = false; setPending(false); }
  }

  return (
    <section
      aria-labelledby="project-library-title"
      aria-busy={availability === 'loading' || cadLoading || pending}
      className="dashboard-library"
      data-project-library
    >
      <header className="dashboard-library-header">
        <div className="dashboard-library-title">
          <h2 id="project-library-title">Project library</h2>
          {availability === 'ready' && <span className="dashboard-count">{projectCountLabel}</span>}
        </div>
        {availability === 'ready' && rows.length > 0 && <div className="dashboard-library-controls" data-project-list-controls>
              <Select aria-label="Project state filter" density="compact" value={stateFilter}
                onChange={event => {
                  const value = event.currentTarget.value;
                  if (value === 'active' || value === 'archived' || value === 'all') setStateFilter(value);
                }}>
                <option value="active">Active projects</option>
                <option value="archived">Archived</option>
                <option value="all">All projects</option>
              </Select>
              <SearchField label="Search projects" value={searchText} onValueChange={setSearchText} />
              <Select
                aria-label="Project source filter"
                density="compact"
                onChange={(event) =>
                  setSourceFilter(event.currentTarget.value === 'cad' ? 'cad' : event.currentTarget.value === 'dxf' ? 'dxf' : event.currentTarget.value === 'external-gcode' ? 'external-gcode' : 'all')
                }
                value={sourceFilter}
              >
                <option value="all">All sources</option>
                <option value="cad">CAD project</option>
                <option value="dxf">Path project</option>
                <option value="external-gcode">Machine program</option>
              </Select>
              <Select
                aria-label="Project sort"
                density="compact"
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (value === 'updated-desc' || value === 'updated-asc' || value === 'name-asc' || value === 'name-desc' || value === 'type') setSortMode(value);
                }}
                value={sortMode}
              >
                <option value="updated-desc">Newest first</option>
                <option value="updated-asc">Oldest first</option>
                <option value="name-asc">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
                <option value="type">Type</option>
              </Select>
        </div>}
      </header>
      <div className="dashboard-library-content">
        {availability !== 'ready' ? <p role="status" className="text-muted-foreground">
          {availability === 'loading' ? 'Loading projects…' : 'Project library unavailable. Open storage settings to reconnect.'}
        </p> : rows.length > 0 ? (
          <>
            {visibleProjects.length > 0 ? (
              <div
                aria-label="Project list"
                className="dashboard-projects"
                role="list"
              >
                {visibleProjects.map((row) => {
                  const { project } = row;
                  const cad = project.sourceKind === 'cad';
                  const locked = interactionLocked || pending || (cad && cadLoading);
                  return (
                  <div
                    className="dashboard-project-card"
                    data-project-row
                    data-project-source={project.sourceKind}
                    data-project-state={row.state}
                    key={`${row.state}:${project.sourceKind}:${row.state === 'archived' ? row.archiveKey : project.id}`}
                    role="listitem"
                  >
                    <span className="dashboard-project-kind" aria-hidden="true">
                      {cad ? <Box /> : isPathProjectSourceKind(project.sourceKind) ? <Waypoints /> : <FileCode />}
                    </span>
                    <div className="dashboard-project-main">
                      <div className="dashboard-project-name">
                        <Tooltip content={`${project.name}\n${project.path}`}><p className="truncate text-foreground" >{project.name}</p></Tooltip>
                        {row.state === 'active' && <Button
                          aria-label={`Rename project ${project.id}`}
                          className="size-5 shrink-0"
                          disabled={locked || (cad && !onRenameCadProject)}
                          onClick={() => project.sourceKind === 'cad' ? onRenameCadProject?.(project) : onRenameProject(project)}
                          size="icon"
                          title="Rename project"
                          type="button"
                          variant="ghost"
                        ><Pencil className="size-3" /></Button>}
                      </div>
                      <div className="dashboard-project-meta">
                        <span>{projectSourceLabel(project.sourceKind)}</span>
                        {row.state === 'archived' && <span>Archived</span>}
                        <ProjectUpdateTime value={row.state === 'archived' ? row.deletedAt : project.updatedAt} />
                      </div>
                    </div>
                    <div className="dashboard-project-actions">
                      {row.state === 'archived' ? <>
                        <Button aria-label={`Restore ${project.name}`} disabled={locked || (cad ? !onRestoreCadProject : !onRestoreProject)}
                          onClick={() => void runAction(() => cad ? onRestoreCadProject?.(row.archiveKey) : onRestoreProject?.(project.id), true)} size="sm" type="button" variant="outline">Restore</Button>
                        {project.sourceKind !== 'cad' && onPurgeArchivedProject && <Button aria-label={`Permanently delete ${project.name}`} title="Delete permanently"
                          disabled={locked} onClick={() => onPurgeArchivedProject(project)} size="icon" type="button" variant="ghost"><Trash2 /></Button>}
                      </> : <>
                      <Button
                        aria-label={`Open project ${project.id} in ${cad ? 'CAD' : 'editor'}`}
                        disabled={locked || (cad && !onOpenCadProject)}
                        onClick={() => void runAction(() => cad ? onOpenCadProject?.(project.id) : onOpenProject(project.id))}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open
                      </Button>
                      <Button
                        aria-label={`Delete project ${project.id}`}
                        className="size-7"
                        disabled={locked || (cad && !onArchiveCadProject)}
                        onClick={() => project.sourceKind === 'cad' ? onArchiveCadProject?.(project) : onDeleteProject(project)}
                        size="icon"
                        title="Delete project"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                      {project.sourceKind === 'cad' && onExportCadProject && <Button aria-label={`Download CAD project ${project.id}`} title="Download CAD project"
                        disabled={locked} onClick={() => void runAction(() => onExportCadProject(project))} size="icon" type="button" variant="ghost"><Download /></Button>}
                      {project.sourceKind !== 'cad' && isPathProjectSourceKind(project.sourceKind) && (
                        <Button
                          aria-label={`Show revisions for project ${project.id}`}
                          className="size-7"
                          disabled={locked}
                          onClick={() => onShowRevisions(project)}
                          size="icon"
                          title="Saved revisions"
                          type="button"
                          variant="ghost"
                        >
                          <History />
                        </Button>
                      )}
                      {project.sourceKind !== 'cad' && isPathProjectSourceKind(project.sourceKind) && (
                        <div className="relative">
                          <Button
                            aria-expanded={exportMenuProjectId === project.id}
                            aria-controls={exportMenuProjectId === project.id ? menu.menuId : undefined}
                            aria-haspopup="menu"
                            aria-label={`Export UPID project ${project.id}`}
                            className="relative size-7"
                            disabled={locked}
                            onClick={() => menu.toggle(project.id)}
                            onKeyDown={(event) => menu.onTriggerKeyDown(event, project.id)}
                            ref={exportMenuProjectId === project.id ? menu.triggerRef : undefined}
                            size="icon"
                            title="Export UPID"
                            type="button"
                            variant="ghost"
                          ><Save className="size-4" /><ChevronDown className="absolute bottom-0 right-0 size-2.5" /></Button>
                          {exportMenuProjectId === project.id && (
                            <MenuSurface aria-label={`Export options for ${project.name}`}
                              id={menu.menuId} ref={menu.menuRef} onKeyDown={menu.onMenuKeyDown}
                              className="absolute right-0 top-full z-30 mt-1 min-w-32 p-1"
                              role="menu">
                              <MenuItem className="flex h-7 w-full items-center px-2 text-left text-[11px]"
                                onClick={() => runExport(project.id, false)} role="menuitem" tabIndex={-1} type="button">
                                Export
                              </MenuItem>
                              {saveAsAvailable && <MenuItem className="flex h-7 w-full items-center px-2 text-left text-[11px]"
                                onClick={() => runExport(project.id, true)} role="menuitem" tabIndex={-1} type="button">
                                Export as…
                              </MenuItem>}
                            </MenuSurface>
                          )}
                        </div>
                      )}
                      </>}
                    </div>
                  </div>
                ); })}
              </div>
            ) : (
              <div
                aria-label="Project list"
                className="dashboard-library-empty"
                role="status"
              >
                No projects match the active filters.
                <Button className="ml-2 h-7 text-[11px]" variant="outline" type="button"
                  onClick={() => { setSearchText(''); setSourceFilter('all'); setStateFilter('active'); }} size="md">Clear filters</Button>
              </div>
            )}
          </>
        ) : (
          <div
            aria-label="Project list"
            className="dashboard-library-empty"
            role="region"
          >
            <p>
              {cadLoading ? 'Loading CAD projects…' : 'No projects yet. Save a CAD design, import a DXF or open a machine program to add a project.'}
            </p>
          </div>
        )}
      </div>
      {cadLoading && rows.length > 0 && <span role="status" className="text-muted-foreground">Loading CAD projects…</span>}
      {actionError && <p role="alert" className="text-destructive">{actionError}</p>}
    </section>
  );
}

const projectDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const projectTimeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

function ProjectUpdateTime({ value }: { value: string }) {
  const date = new Date(value);
  const valid = Number.isFinite(date.getTime());
  return (
    <Tooltip content={value}><time
      aria-label={`Updated ${valid ? date.toLocaleString() : value}`}
      className="dashboard-project-time"
      dateTime={valid ? value : undefined}

    >
      <span>{valid ? projectDateFormatter.format(date) : value}</span>
      {valid && <span>{projectTimeFormatter.format(date)}</span>}
    </time></Tooltip>
  );
}

function isPathProjectSourceKind(
  sourceKind: DashboardProject['sourceKind']
): sourceKind is 'dxf' | 'upid' {
  return sourceKind === 'dxf' || sourceKind === 'upid';
}
