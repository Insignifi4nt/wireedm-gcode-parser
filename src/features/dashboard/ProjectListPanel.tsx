import { SearchField } from '@/components/ui/search-field';
import { Tooltip } from '@/components/ui/tooltip';
import { MenuSurface, MenuItem } from '@/components/ui/menu';
import { Select } from '@/components/ui/select';
import { useState } from 'react';
import { ChevronDown, FileCode, History, Pencil, Save, Trash2, Waypoints } from '@wire-edm/icons-react';

import { Button } from '@/components/ui/button';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';
import { supportsSaveTextFileAs } from '@/domain/post/saveTextFileAs';
import { useDashboardMenu } from './useDashboardMenu';
import './dashboard.css';

type WorkbenchProjectIndexEntry = WorkbenchCatalogManifest['projects'][number];

type ProjectSourceFilter = 'all' | 'dxf' | 'external-gcode';
type ProjectSortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'type';

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
  onRenameProject
}: ProjectListPanelProps) {
  const [searchText, setSearchText] = useState('');
  const [sourceFilter, setSourceFilter] = useState<ProjectSourceFilter>('all');
  const [sortMode, setSortMode] = useState<ProjectSortMode>('updated-desc');
  const menu = useDashboardMenu(interactionLocked || availability !== 'ready');
  const exportMenuProjectId = interactionLocked ? null : menu.openId;
  const saveAsAvailable = supportsSaveTextFileAs();

  function runExport(projectId: string, chooseLocation: boolean) {
    menu.close(true);
    if (chooseLocation) void onSaveUpidProjectAs(projectId);
    else void onExportUpidProject(projectId);
  }
  const visibleProjects = getVisibleProjects(projects, searchText, sourceFilter, sortMode);
  const projectCountLabel =
    visibleProjects.length === projects.length
      ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`
      : `${visibleProjects.length} / ${projects.length} projects`;

  return (
    <section
      aria-labelledby="project-library-title"
      aria-busy={availability === 'loading'}
      className="dashboard-library"
      data-project-library
    >
      <header className="dashboard-library-header">
        <div className="dashboard-library-title">
          <h2 id="project-library-title">Project library</h2>
          {availability === 'ready' && <span className="dashboard-count">{projectCountLabel}</span>}
        </div>
        {availability === 'ready' && projects.length > 0 && <div className="dashboard-library-controls" data-project-list-controls>
              <SearchField label="Search projects" value={searchText} onValueChange={setSearchText} />
              <Select
                aria-label="Project source filter"
                density="compact"
                onChange={(event) =>
                  setSourceFilter(event.currentTarget.value as ProjectSourceFilter)
                }
                value={sourceFilter}
              >
                <option value="all">All sources</option>
                <option value="dxf">Path project</option>
                <option value="external-gcode">Machine program</option>
              </Select>
              <Select
                aria-label="Project sort"
                density="compact"
                onChange={(event) => setSortMode(event.currentTarget.value as ProjectSortMode)}
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
        </p> : projects.length > 0 ? (
          <>
            {visibleProjects.length > 0 ? (
              <div
                aria-label="Project list"
                className="dashboard-projects"
                role="list"
              >
                {visibleProjects.map((project) => (
                  <div
                    className="dashboard-project-card"
                    data-project-row
                    data-project-source={project.sourceKind}
                    key={project.id}
                    role="listitem"
                  >
                    <span className="dashboard-project-kind" aria-hidden="true">
                      {isPathProjectSourceKind(project.sourceKind) ? <Waypoints /> : <FileCode />}
                    </span>
                    <div className="dashboard-project-main">
                      <div className="dashboard-project-name">
                        <Tooltip content={`${project.name}\n${project.path}`}><p className="truncate text-foreground" >{project.name}</p></Tooltip>
                        <Button
                          aria-label={`Rename project ${project.id}`}
                          className="size-5 shrink-0"
                          disabled={interactionLocked}
                          onClick={() => onRenameProject(project)}
                          size="icon"
                          title="Rename project"
                          type="button"
                          variant="ghost"
                        ><Pencil className="size-3" /></Button>
                      </div>
                      <div className="dashboard-project-meta">
                        <span>{getProjectSourceLabel(project.sourceKind)}</span>
                        <ProjectUpdateTime value={project.updatedAt} />
                      </div>
                    </div>
                    <div className="dashboard-project-actions">
                      <Button
                        aria-label={`Open project ${project.id} in editor`}
                        disabled={interactionLocked}
                        onClick={() => onOpenProject(project.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open
                      </Button>
                      <Button
                        aria-label={`Delete project ${project.id}`}
                        className="size-7"
                        disabled={interactionLocked}
                        onClick={() => onDeleteProject(project)}
                        size="icon"
                        title="Delete project"
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                      {isPathProjectSourceKind(project.sourceKind) && (
                        <Button
                          aria-label={`Show revisions for project ${project.id}`}
                          className="size-7"
                          disabled={interactionLocked}
                          onClick={() => onShowRevisions(project)}
                          size="icon"
                          title="Saved revisions"
                          type="button"
                          variant="ghost"
                        >
                          <History />
                        </Button>
                      )}
                      {isPathProjectSourceKind(project.sourceKind) && (
                        <div className="relative">
                          <Button
                            aria-expanded={exportMenuProjectId === project.id}
                            aria-controls={exportMenuProjectId === project.id ? menu.menuId : undefined}
                            aria-haspopup="menu"
                            aria-label={`Export UPID project ${project.id}`}
                            className="relative size-7"
                            disabled={interactionLocked}
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
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                aria-label="Project list"
                className="dashboard-library-empty"
                role="status"
              >
                No projects match the active filters.
                <Button className="ml-2 h-7 text-[11px]" variant="outline" type="button"
                  onClick={() => { setSearchText(''); setSourceFilter('all'); }} size="md">Clear filters</Button>
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
              No projects yet. Import a DXF as a Path Project or open a Machine Program to add it to
              the active workbench.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function getProjectSourceLabel(sourceKind: WorkbenchProjectIndexEntry['sourceKind']) {
  return isPathProjectSourceKind(sourceKind) ? 'Path project' : 'Machine program';
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
  sourceKind: WorkbenchProjectIndexEntry['sourceKind']
): sourceKind is 'dxf' | 'upid' {
  return sourceKind === 'dxf' || sourceKind === 'upid';
}

function getVisibleProjects(
  projects: readonly WorkbenchProjectIndexEntry[],
  searchText: string,
  sourceFilter: ProjectSourceFilter,
  sortMode: ProjectSortMode
) {
  const query = searchText.trim().toLowerCase();

  return projects
    .filter((project) => {
      const matchesSource =
        sourceFilter === 'all' ||
        (sourceFilter === 'dxf'
          ? isPathProjectSourceKind(project.sourceKind)
          : project.sourceKind === sourceFilter);
      const matchesSearch =
        !query ||
        project.name.toLowerCase().includes(query) ||
        project.path.toLowerCase().includes(query) ||
        getProjectSourceLabel(project.sourceKind).toLowerCase().includes(query) ||
        project.sourceKind.toLowerCase().includes(query);
      return matchesSource && matchesSearch;
    })
    .sort((left, right) => compareProjects(left, right, sortMode));
}

function compareProjects(
  left: WorkbenchProjectIndexEntry,
  right: WorkbenchProjectIndexEntry,
  sortMode: ProjectSortMode
) {
  if (sortMode === 'updated-desc') return right.updatedAt.localeCompare(left.updatedAt);
  if (sortMode === 'updated-asc') return left.updatedAt.localeCompare(right.updatedAt);
  if (sortMode === 'name-desc') return right.name.localeCompare(left.name);
  if (sortMode === 'type') {
    return getProjectSourceLabel(left.sourceKind).localeCompare(getProjectSourceLabel(right.sourceKind)) || left.name.localeCompare(right.name);
  }
  return left.name.localeCompare(right.name);
}
