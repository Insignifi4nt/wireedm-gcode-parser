import { useEffect, useRef, useState } from 'react';
import { ChevronDown, History, Pencil, Save, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';
import { supportsSaveTextFileAs } from '@/domain/post/saveTextFileAs';

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
  const [exportMenuProjectId, setExportMenuProjectId] = useState<string | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const firstExportItemRef = useRef<HTMLButtonElement>(null);
  const saveAsAvailable = supportsSaveTextFileAs();

  useEffect(() => {
    if (exportMenuProjectId === null) return;
    firstExportItemRef.current?.focus();
    function handleOutsideClick(event: MouseEvent) {
      if (event.target instanceof Node && !exportMenuRef.current?.contains(event.target)) {
        setExportMenuProjectId(null);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setExportMenuProjectId(null);
      exportTriggerRef.current?.focus();
    }
    document.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [exportMenuProjectId]);

  function runExport(projectId: string, chooseLocation: boolean) {
    setExportMenuProjectId(null);
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
      className="technical-panel min-w-0 min-h-[260px] min-[1180px]:min-h-[420px]"
      data-project-library
    >
      <div className="technical-panel-header justify-between">
        <h2 className="text-xs font-semibold" id="project-library-title">
          Project Library
        </h2>
        {availability === 'ready' && <span className="technical-value text-[10px] text-muted-foreground">{projectCountLabel}</span>}
      </div>
      <div className="p-3 text-[11px]">
        {availability !== 'ready' ? <p role="status" className="text-muted-foreground">
          {availability === 'loading' ? 'Loading projects…' : 'Project library unavailable. Open storage settings to reconnect.'}
        </p> : projects.length > 0 ? (
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
                      <div className="flex min-w-0 items-center gap-1">
                        <p className="truncate text-foreground" title={project.name}>{project.name}</p>
                        <Button
                          aria-label={`Rename project ${project.id}`}
                          className="size-5 shrink-0 text-muted-foreground hover:text-foreground"
                          disabled={interactionLocked}
                          onClick={() => onRenameProject(project)}
                          size="icon"
                          title="Rename project"
                          type="button"
                          variant="ghost"
                        ><Pencil className="size-3" /></Button>
                      </div>
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
                        onClick={() => onOpenProject(project.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Open
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
                          aria-label={`Show revisions for project ${project.id}`}
                          className="size-7 text-muted-foreground hover:text-foreground"
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
                        <div className="relative" ref={exportMenuProjectId === project.id ? exportMenuRef : undefined}>
                          <Button
                            aria-expanded={exportMenuProjectId === project.id}
                            aria-haspopup="menu"
                            aria-label={`Export UPID project ${project.id}`}
                            className="relative size-7 text-muted-foreground hover:text-foreground"
                            disabled={interactionLocked}
                            onClick={() => setExportMenuProjectId((current) => current === project.id ? null : project.id)}
                            ref={exportMenuProjectId === project.id ? exportTriggerRef : undefined}
                            size="icon"
                            title="Export UPID"
                            type="button"
                            variant="ghost"
                          ><Save className="size-4" /><ChevronDown className="absolute bottom-0 right-0 size-2.5" /></Button>
                          {exportMenuProjectId === project.id && (
                            <div aria-label={`Export options for ${project.name}`}
                              className="absolute right-0 top-full z-30 mt-1 min-w-32 border border-border bg-popover p-1 shadow-xl"
                              role="menu">
                              <button className="flex h-7 w-full items-center px-2 text-left text-[11px] text-popover-foreground outline-none hover:bg-accent focus:bg-accent"
                                onClick={() => runExport(project.id, false)} ref={firstExportItemRef} role="menuitem" type="button">
                                Export
                              </button>
                              {saveAsAvailable && <button className="flex h-7 w-full items-center px-2 text-left text-[11px] text-popover-foreground outline-none hover:bg-accent focus:bg-accent"
                                onClick={() => runExport(project.id, true)} role="menuitem" type="button">
                                Export as…
                              </button>}
                            </div>
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
                className="border border-border bg-background/50 p-2 text-muted-foreground"
                role="status"
              >
                No projects match the active filters.
                <Button className="ml-2 h-7 text-[11px]" variant="outline" type="button"
                  onClick={() => { setSearchText(''); setSourceFilter('all'); }}>Clear filters</Button>
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
