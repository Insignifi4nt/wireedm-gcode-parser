import { Button } from '@/components/ui/button';
import type { WorkbenchProjectIndexEntry } from '@/domain/storage/workbenchStorage';

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
  return (
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
                className="grid grid-cols-[minmax(0,1fr)_84px_130px_auto] items-center gap-3 p-2"
                key={project.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-foreground">{project.name}</p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">{project.path}</p>
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
            ))}
          </div>
        ) : (
          <p className="border border-border bg-background/50 p-2 text-muted-foreground">
            No projects yet. Import a DXF or open an existing program to create a project in the
            active workbench.
          </p>
        )}
      </div>
    </div>
  );
}
