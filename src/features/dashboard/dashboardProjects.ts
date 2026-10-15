import { cadDocumentPath, type ArchivedCadLibraryEntry, type CadLibraryEntry } from '@/domain/cad/cadStorage';
import type { WorkbenchCatalogManifest } from '@/domain/workbench-catalog/workbenchCatalog';

export type WorkbenchProjectEntry = WorkbenchCatalogManifest['projects'][number];
export type CadDashboardProject = CadLibraryEntry & { readonly sourceKind: 'cad'; readonly path: string };
export type DashboardProject = WorkbenchProjectEntry | CadDashboardProject;
export type DashboardProjectRow =
  | { readonly state: 'active'; readonly project: DashboardProject }
  | { readonly state: 'archived'; readonly project: DashboardProject; readonly deletedAt: string; readonly archiveKey: string };
export type ProjectStateFilter = 'active' | 'archived' | 'all';
export type ProjectSourceFilter = 'all' | 'cad' | 'dxf' | 'external-gcode';
export type ProjectSortMode = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'type';

export function dashboardProjectRows({ projects, cadProjects = [], archivedProjects = [], cadArchivedProjects = [] }: {
  projects: readonly WorkbenchProjectEntry[];
  cadProjects?: readonly CadLibraryEntry[];
  archivedProjects?: NonNullable<WorkbenchCatalogManifest['deletedProjects']>;
  cadArchivedProjects?: readonly ArchivedCadLibraryEntry[];
}): DashboardProjectRow[] {
  const cadProject = (entry: CadLibraryEntry): CadDashboardProject => ({ ...entry, sourceKind: 'cad', path: cadDocumentPath(entry.id) });
  return [
    ...projects.map((project): DashboardProjectRow => ({ state: 'active', project })),
    ...cadProjects.map((entry): DashboardProjectRow => ({ state: 'active', project: cadProject(entry) })),
    ...archivedProjects.map(({ project, deletedAt }): DashboardProjectRow => ({ state: 'archived', project, deletedAt, archiveKey: project.id })),
    ...cadArchivedProjects.map((entry): DashboardProjectRow => ({ state: 'archived', project: cadProject(entry), deletedAt: entry.archivedAt, archiveKey: entry.archivePath }))
  ];
}

export function projectSourceLabel(sourceKind: DashboardProject['sourceKind']) {
  return sourceKind === 'cad' ? 'CAD project' : sourceKind === 'external-gcode' ? 'Machine program' : 'Path project';
}

export function visibleDashboardProjects(rows: readonly DashboardProjectRow[], searchText: string, stateFilter: ProjectStateFilter,
  sourceFilter: ProjectSourceFilter, sortMode: ProjectSortMode) {
  const query = searchText.trim().toLowerCase();
  const timestamp = (row: DashboardProjectRow) => Date.parse(row.state === 'archived' ? row.deletedAt : row.project.updatedAt);
  return rows.filter(({ project, state }) => (stateFilter === 'all' || state === stateFilter)
    && (sourceFilter === 'all' || (sourceFilter === 'dxf' ? project.sourceKind === 'dxf' || project.sourceKind === 'upid' : project.sourceKind === sourceFilter))
    && (!query || [project.name, project.path, projectSourceLabel(project.sourceKind), project.sourceKind].some(value => value.toLowerCase().includes(query))))
    .sort((left, right) => {
      if (sortMode === 'updated-desc') return timestamp(right) - timestamp(left);
      if (sortMode === 'updated-asc') return timestamp(left) - timestamp(right);
      if (sortMode === 'name-desc') return right.project.name.localeCompare(left.project.name);
      if (sortMode === 'type') return projectSourceLabel(left.project.sourceKind).localeCompare(projectSourceLabel(right.project.sourceKind))
        || left.project.name.localeCompare(right.project.name);
      return left.project.name.localeCompare(right.project.name);
    });
}
