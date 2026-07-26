import { useState } from 'react';
import { Forward, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkbenchProjectIndexEntry } from '@/domain/storage/workbenchStorage';
import { isPathProjectSourceKind } from '@/domain/workbench/types';

type ProjectSourceFilter = 'all' | 'dxf' | 'external-gcode';
type ProjectSortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'type';

interface ProjectListPanelProps {
  interactionLocked: boolean;
  projects: WorkbenchProjectIndexEntry[];
  onOpenProject: (projectPath: string) => void | Promise<void>;
  onDeleteProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
  onExportUpidProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
  onRenameProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
}

export function ProjectListPanel({
  interactionLocked,
  projects,
  onDeleteProject,
  onExportUpidProject,
  onOpenProject,
  onRenameProject
}: ProjectListPanelProps) {
  const [searchText, setSearchText] = useState('');
  const [sourceFilter, setSourceFilter] = useState<ProjectSourceFilter>('all');
  const [sortMode, setSortMode] = useState<ProjectSortMode>('updated-desc');
  const visibleProjects = getVisibleProjects(projects, searchText, sourceFilter, sortMode);
  const projectCountLabel =
    visibleProjects.length === projects.length
      ? `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`
      : `${visibleProjects.length} / ${projects.length} projects`;

  return (
    <section
      aria-labelledby="project-library-title"
      className="technical-panel min-w-0 min-h-[260px] min-[1180px]:min-h-[420px]"
      data-project-library
    >
      <div className="technical-panel-header justify-between">
        <h2 className="text-xs font-semibold" id="project-library-title">
          Project Library
        </h2>
        <span className="technical-value text-[10px] text-muted-foreground">{projectCountLabel}</span>
      </div>
      <div className="p-3 text-[11px]">
        {projects.length > 0 ? (
          <div className="grid gap-2">
            <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(120px,150px)_minmax(120px,150px)]" data-project-list-controls>
              <input
                aria-label="Search projects"
                className="technical-input px-2 text-[11px] outline-none"
                onChange={(event) => setSearchText(event.currentTarget.value)}
                placeholder="Search projects"
                value={searchText}
              />
              <select
                aria-label="Project source filter"
                className="technical-input px-2 text-[11px] outline-none"
                onChange={(event) =>
                  setSourceFilter(event.currentTarget.value as ProjectSourceFilter)
                }
                value={sourceFilter}
              >
                <option value="all">All sources</option>
                <option value="dxf">Path Project</option>
                <option value="external-gcode">Machine Program</option>
              </select>
              <select
                aria-label="Project sort"
                className="technical-input px-2 text-[11px] outline-none"
                onChange={(event) => setSortMode(event.currentTarget.value as ProjectSortMode)}
                value={sortMode}
              >
                <option value="updated-desc">Updated newest</option>
                <option value="updated-asc">Updated oldest</option>
                <option value="name-asc">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
                <option value="type">Type</option>
              </select>
            </div>

            {visibleProjects.length > 0 ? (
              <div
                aria-label="Project list"
                className="divide-y divide-border border border-border"
                role="list"
              >
                {visibleProjects.map((project) => (
                  <div
                    className="grid min-w-0 gap-x-3 gap-y-1 p-2 lg:grid-cols-[minmax(0,1fr)_110px_minmax(120px,150px)_auto] lg:items-center"
                    data-project-row
                    data-project-source={project.sourceKind}
                    key={project.id}
                    role="listitem"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-foreground" title={project.name}>{project.name}</p>
                      <p className="technical-value mt-1 truncate text-[10px] text-muted-foreground" title={project.path}>
                        {project.path}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground lg:text-[11px]">
                      {getProjectSourceLabel(project.sourceKind)}
                    </span>
                    <span className="technical-value truncate text-[10px] text-muted-foreground" title={project.updatedAt}>{project.updatedAt}</span>
                    <div className="flex min-w-0 items-center gap-1 lg:justify-end">
                      <Button
                        aria-label={`Open project ${project.id} in editor`}
                        disabled={interactionLocked}
                        onClick={() => onOpenProject(project.path)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open
                      </Button>
                      <Button
                        aria-label={`Rename project ${project.id}`}
                        className="size-7 text-muted-foreground hover:text-foreground"
                        disabled={interactionLocked}
                        onClick={() => onRenameProject(project)}
                        size="icon"
                        title="Rename project"
                        type="button"
                        variant="ghost"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        aria-label={`Delete project ${project.id}`}
                        className="size-7 text-muted-foreground hover:text-destructive"
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
                          aria-label={`Export UPID project ${project.id}`}
                          className="size-7 text-muted-foreground hover:text-foreground"
                          disabled={interactionLocked}
                          onClick={() => onExportUpidProject(project)}
                          size="icon"
                          title="Export UPID"
                          type="button"
                          variant="ghost"
                        >
                          <Forward />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div
                aria-label="Project list"
                className="border border-border bg-background/50 p-2 text-muted-foreground"
                role="status"
              >
                No projects match the active filters.
              </div>
            )}
          </div>
        ) : (
          <div
            aria-label="Project list"
            className="border border-border bg-background/50 p-2 text-muted-foreground"
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
  return isPathProjectSourceKind(sourceKind) ? 'Path Project' : 'Machine Program';
}

function getVisibleProjects(
  projects: WorkbenchProjectIndexEntry[],
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
    return left.sourceKind.localeCompare(right.sourceKind) || left.name.localeCompare(right.name);
  }
  return left.name.localeCompare(right.name);
}
