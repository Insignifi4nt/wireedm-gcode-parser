import { useState } from 'react';

export interface EditorWorkflowMenuCommand {
  ariaLabel?: string;
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  disabledReason?: string;
  onExecute: () => void;
}

export interface EditorWorkflowMenuGroup {
  title: 'Project' | 'Geometry' | 'Machining' | 'Construction' | 'View' | 'Machine' | 'Export';
  commands: EditorWorkflowMenuCommand[];
}

export function EditorWorkflowMenuBar({ groups }: { groups: EditorWorkflowMenuGroup[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const visibleGroups = groups.filter((group) => group.commands.length > 0);

  return (
    <nav className="flex items-center gap-px" aria-label="Editor workflows" data-editor-workflow-menus>
      {visibleGroups.map((group) => (
        <details
          className="relative"
          key={group.title}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenMenu(null);
          }}
          open={openMenu === group.title}
        >
          <summary
            aria-label={`${group.title} menu`}
            className="cursor-pointer select-none px-1.5 py-1 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              setOpenMenu((current) => current === group.title ? null : group.title);
            }}
          >
            {group.title}
          </summary>
          <div className="absolute left-0 top-7 z-[60] grid min-w-64 gap-1 border border-border bg-card p-1.5 shadow-2xl">
            {group.commands.map((command) => (
              <button
                aria-label={command.ariaLabel ?? command.label}
                className="grid min-h-8 gap-0.5 border border-border px-2 py-1 text-left text-[10px] text-muted-foreground enabled:hover:bg-accent enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-55"
                data-editor-workflow-command={command.id}
                disabled={!command.enabled}
                key={command.id}
                onClick={() => {
                  command.onExecute();
                  setOpenMenu(null);
                }}
                title={command.enabled ? command.description : command.disabledReason}
                type="button"
              >
                <span className="text-foreground">{command.label}</span>
                <span>{command.enabled ? command.description : command.disabledReason}</span>
              </button>
            ))}
          </div>
        </details>
      ))}
    </nav>
  );
}
