import { useEffect, useRef, useState } from 'react';

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

type MenuAlignment = 'left' | 'right';

export function EditorWorkflowMenuBar({ groups }: { groups: EditorWorkflowMenuGroup[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [menuAlignment, setMenuAlignment] = useState<MenuAlignment>('left');
  const navRef = useRef<HTMLElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const commandRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusFirstCommandFor = useRef<string | null>(null);
  const visibleGroups = groups.filter((group) => group.commands.length > 0);

  useEffect(() => {
    if (!openMenu) return;

    const trigger = triggerRefs.current.get(openMenu);
    if (trigger) {
      const triggerBounds = trigger.getBoundingClientRect();
      setMenuAlignment(triggerBounds.left + 300 > window.innerWidth ? 'right' : 'left');
    }

    if (focusFirstCommandFor.current === openMenu) {
      const group = visibleGroups.find((candidate) => candidate.title === openMenu);
      const firstEnabled = group?.commands.find((command) => command.enabled);
      if (firstEnabled) commandRefs.current.get(firstEnabled.id)?.focus();
      focusFirstCommandFor.current = null;
    }
  }, [openMenu, visibleGroups]);

  useEffect(() => {
    if (!openMenu) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
      setActiveCommandId(null);
    };

    document.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [openMenu]);

  function openMenuFor(title: string, focusFirstCommand = false) {
    const group = visibleGroups.find((candidate) => candidate.title === title);
    const firstEnabled = group?.commands.find((command) => command.enabled);
    focusFirstCommandFor.current = focusFirstCommand ? title : null;
    setOpenMenu(title);
    setActiveCommandId(firstEnabled?.id ?? null);
    if (focusFirstCommand && firstEnabled) {
      queueMicrotask(() => commandRefs.current.get(firstEnabled.id)?.focus());
    }
  }

  function closeMenu(returnFocusTo?: string) {
    setOpenMenu(null);
    setActiveCommandId(null);
    if (returnFocusTo) triggerRefs.current.get(returnFocusTo)?.focus();
  }

  function moveFocus(group: EditorWorkflowMenuGroup, commandId: string, direction: 1 | -1) {
    const enabledCommands = group.commands.filter((command) => command.enabled);
    if (enabledCommands.length === 0) return;
    const currentIndex = enabledCommands.findIndex((command) => command.id === commandId);
    const nextIndex = currentIndex === -1
      ? (direction === 1 ? 0 : enabledCommands.length - 1)
      : (currentIndex + direction + enabledCommands.length) % enabledCommands.length;
    const next = enabledCommands[nextIndex];
    setActiveCommandId(next.id);
    commandRefs.current.get(next.id)?.focus();
  }

  return (
    <nav
      ref={navRef}
      className="flex items-center gap-px"
      aria-label="Editor workflows"
      data-editor-workflow-menus
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu();
      }}
    >
      {visibleGroups.map((group) => {
        const isOpen = openMenu === group.title;
        const menuId = `editor-workflow-menu-${group.title.toLowerCase()}`;
        const activeCommand = group.commands.find((command) => command.id === activeCommandId)
          ?? group.commands.find((command) => command.enabled)
          ?? null;
        const description = activeCommand?.enabled
          ? activeCommand.description
          : activeCommand?.disabledReason;

        return (
          <div className="relative" key={group.title}>
            <button
              ref={(element) => {
                if (element) triggerRefs.current.set(group.title, element);
                else triggerRefs.current.delete(group.title);
              }}
              aria-controls={isOpen ? menuId : undefined}
              aria-expanded={isOpen}
              aria-haspopup="menu"
              aria-label={`${group.title} menu`}
              className="px-1.5 py-1 text-[11px] leading-4 text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
              onClick={() => {
                if (isOpen) closeMenu();
                else openMenuFor(group.title);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  openMenuFor(group.title, true);
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  const lastEnabled = [...group.commands].reverse().find((command) => command.enabled);
                  if (!lastEnabled) return;
                  focusFirstCommandFor.current = null;
                  setOpenMenu(group.title);
                  setActiveCommandId(lastEnabled.id);
                  queueMicrotask(() => commandRefs.current.get(lastEnabled.id)?.focus());
                }
              }}
              type="button"
            >
              {group.title}
            </button>
            {isOpen && (
              <div
                className={`absolute top-7 z-[60] min-w-[220px] max-w-[300px] overflow-hidden border border-border bg-card ${
                  menuAlignment === 'right' ? 'right-0' : 'left-0'
                }`}
                data-editor-workflow-menu={group.title}
                id={menuId}
                role="menu"
                onKeyDown={(event) => {
                  const commandId = (event.target as HTMLElement).dataset.editorWorkflowCommand;
                  if (!commandId) return;
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    moveFocus(group, commandId, 1);
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    moveFocus(group, commandId, -1);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeMenu(group.title);
                  }
                }}
              >
                <div className="divide-y divide-border px-1 py-1">
                  {group.commands.map((command) => {
                    const disabledReasonId = `editor-workflow-command-${command.id}-reason`;
                    return (
                      <button
                        ref={(element) => {
                          if (element) commandRefs.current.set(command.id, element);
                          else commandRefs.current.delete(command.id);
                        }}
                        aria-describedby={!command.enabled && command.disabledReason ? disabledReasonId : undefined}
                        aria-disabled={!command.enabled || undefined}
                        aria-label={command.ariaLabel ?? command.label}
                        className="flex min-h-[32px] w-full items-center px-2 text-left text-[11px] leading-4 text-foreground enabled:hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-55"
                        data-editor-workflow-command={command.id}
                        disabled={!command.enabled}
                        key={command.id}
                        onFocus={() => setActiveCommandId(command.id)}
                        onMouseEnter={() => command.enabled && setActiveCommandId(command.id)}
                        onClick={() => {
                          if (!command.enabled) return;
                          command.onExecute();
                          closeMenu();
                        }}
                        role="menuitem"
                        title={command.enabled ? command.description : command.disabledReason}
                        type="button"
                      >
                        <span className="truncate whitespace-nowrap">{command.label}</span>
                        {!command.enabled && command.disabledReason && (
                          <span className="sr-only" id={disabledReasonId}>{command.disabledReason}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {description && (
                  <p
                    className="border-t border-border px-2 py-1 text-[10px] leading-4 text-muted-foreground"
                    data-editor-workflow-description
                  >
                    {description}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
