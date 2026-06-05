import { useState } from 'react';

import { Button } from '@/components/ui/button';
import type { WorkbenchProjectIndexEntry } from '@/domain/storage/workbenchStorage';

type ProjectSourceFilter = 'all' | WorkbenchProjectIndexEntry['sourceKind'];
type ProjectSortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'type';

interface ProjectListPanelProps {
  projects: WorkbenchProjectIndexEntry[];
  onOpenProject: (projectPath: string) => void | Promise<void>;
  onDeleteProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
  onRenameProject: (project: WorkbenchProjectIndexEntry) => void | Promise<void>;
}

export function ProjectListPanel({
  projects,
  onDeleteProject,
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
    <div className="min-h-0 border border-border bg-card">
      <div className="flex h-8 items-center justify-between border-b border-border px-3">
        <h3 className="font-mono text-xs font-semibold">Projects</h3>
        <span className="font-mono text-[10px] text-muted-foreground">{projectCountLabel}</span>
      </div>
      <div className="p-3 font-mono text-[11px]">
        {projects.length > 0 ? (
          <div className="grid gap-2">
            <div className="grid grid-cols-[minmax(0,1fr)_150px_150px] gap-2">
              <input
                aria-label="Search projects"
                className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                onChange={(event) => setSearchText(event.currentTarget.value)}
                placeholder="Search projects"
                value={searchText}
              />
              <select
                aria-label="Project source filter"
                className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
                onChange={(event) =>
                  setSourceFilter(event.currentTarget.value as ProjectSourceFilter)
                }
                value={sourceFilter}
              >
                <option value="all">All sources</option>
                <option value="dxf">DXF</option>
                <option value="external-gcode">External G-code</option>
              </select>
              <select
                aria-label="Project sort"
                className="h-8 border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none focus:border-ring"
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

            <div aria-label="Project list" className="divide-y divide-border border border-border">
              {visibleProjects.length > 0 ? (
                visibleProjects.map((project) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_84px_130px_auto] items-center gap-3 p-2"
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
                    <div className="flex items-center gap-1">
                      <Button
                        aria-label={`Open project ${project.id} in editor`}
                        onClick={() => onOpenProject(project.path)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open
                      </Button>
                      <Button
                        aria-label={`Rename project ${project.id}`}
                        onClick={() => onRenameProject(project)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Rename
                      </Button>
                      <Button
                        aria-label={`Delete project ${project.id}`}
                        onClick={() => onDeleteProject(project)}
                        size="sm"
                        type="button"
                        variant="danger"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-background/50 p-2 text-muted-foreground">
                  No projects match the active filters.
                </div>
              )}
            </div>
          </div>
        ) : (
          <p
            aria-label="Project list"
            className="border border-border bg-background/50 p-2 text-muted-foreground"
          >
            No projects yet. Import a DXF or open an existing program to create a project in the
            active workbench.
          </p>
        )}
      </div>
    </div>
  );
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
      const matchesSource = sourceFilter === 'all' || project.sourceKind === sourceFilter;
      const matchesSearch =
        !query ||
        project.name.toLowerCase().includes(query) ||
        project.path.toLowerCase().includes(query) ||
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
