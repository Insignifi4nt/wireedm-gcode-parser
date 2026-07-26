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
  const [compactOpen, setCompactOpen] = useState(false);
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const [menuAlignment, setMenuAlignment] = useState<MenuAlignment>('left');
  const [compactMenuPosition, setCompactMenuPosition] = useState({ left: 4, top: 36 });
  const navRef = useRef<HTMLElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const commandRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusFirstCommandFor = useRef<string | null>(null);
  const visibleGroups = groups.filter((group) => group.commands.length > 0);

  useEffect(() => {
    if (!openMenu) return;

    if (!compactOpen) {
      const trigger = triggerRefs.current.get(openMenu);
      if (trigger) {
        const triggerBounds = trigger.getBoundingClientRect();
        setMenuAlignment(triggerBounds.left + 300 > window.innerWidth ? 'right' : 'left');
      }
    }

    if (focusFirstCommandFor.current === openMenu) {
      const group = visibleGroups.find((candidate) => candidate.title === openMenu);
      const firstEnabled = group?.commands.find((command) => command.enabled);
      if (firstEnabled) commandRefs.current.get(firstEnabled.id)?.focus();
      focusFirstCommandFor.current = null;
    }
  }, [compactOpen, openMenu, visibleGroups]);

  useEffect(() => {
    if (!openMenu && !compactOpen) return;

    const handleOutsidePointer = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
      setCompactOpen(false);
      setActiveCommandId(null);
    };

    document.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [compactOpen, openMenu]);

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
    if (compactOpen) {
      setCompactOpen(false);
      compactTriggerRef.current?.focus();
    } else if (returnFocusTo) {
      triggerRefs.current.get(returnFocusTo)?.focus();
    }
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

  function positionCompactMenu(trigger: HTMLButtonElement) {
    const bounds = trigger.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 8);
    setCompactMenuPosition({
      left: Math.min(Math.max(4, bounds.left), Math.max(4, window.innerWidth - width - 4)),
      top: bounds.bottom
    });
  }

  function renderCommandMenu(group: EditorWorkflowMenuGroup, compact: boolean) {
    const menuId = `editor-workflow-menu-${compact ? 'compact-' : ''}${group.title.toLowerCase()}`;
    const activeCommand = group.commands.find((command) => command.id === activeCommandId)
      ?? group.commands.find((command) => command.enabled)
      ?? null;
    const description = activeCommand?.enabled
      ? activeCommand.description
      : activeCommand?.disabledReason;

    return (
      <div
        className={`z-[60] min-w-[220px] max-w-[300px] overflow-hidden border border-border bg-card ${
          compact
            ? 'fixed w-[min(260px,calc(100vw-8px))]'
            : `absolute top-7 ${menuAlignment === 'right' ? 'right-0' : 'left-0'}`
        }`}
        data-editor-workflow-compact-menu={compact ? '' : undefined}
        data-editor-workflow-menu={group.title}
        id={menuId}
        key={`${compact ? 'compact' : 'direct'}-${group.title}`}
        role="menu"
        style={compact ? compactMenuPosition : undefined}
        onKeyDown={(event) => {
          const commandId = (event.target as HTMLElement).dataset.editorWorkflowCommand;
          if (event.key === 'Escape') {
            event.preventDefault();
            closeMenu(group.title);
            return;
          }
          if (!commandId) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(group, commandId, 1);
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(group, commandId, -1);
          }
        }}
      >
        {compact && (
          <div className="flex h-7 items-center gap-1 border-b border-border px-1">
            <button
              aria-label="Back to workflow categories"
              className="h-6 px-1.5 text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
              data-editor-workflow-compact-back
              onClick={() => {
                setOpenMenu(null);
                setActiveCommandId(null);
              }}
              role="menuitem"
              type="button"
            >
              ‹ Categories
            </button>
            <span className="truncate text-[11px] font-semibold">{group.title}</span>
          </div>
        )}
        <div className="divide-y divide-border px-1 py-1">
          {group.commands.map((command) => {
            const disabledReasonId = `editor-workflow-command-${compact ? 'compact-' : ''}${command.id}-reason`;
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
    );
  }

  return (
    <nav
      ref={navRef}
      className="relative flex items-center gap-px"
      aria-label="Editor workflows"
      data-editor-workflow-menus
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpenMenu(null);
          setCompactOpen(false);
          setActiveCommandId(null);
        }
      }}
    >
      <div className="flex items-center gap-px" data-editor-workflow-direct>
        {visibleGroups.map((group) => {
          const isOpen = !compactOpen && openMenu === group.title;
          const menuId = `editor-workflow-menu-${group.title.toLowerCase()}`;

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
                  setCompactOpen(false);
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
              {isOpen && renderCommandMenu(group, false)}
            </div>
          );
        })}
      </div>

      <div className="hidden" data-editor-workflow-compact>
        <button
          ref={compactTriggerRef}
          aria-controls={compactOpen ? 'editor-workflow-compact-popover' : undefined}
          aria-expanded={compactOpen}
          aria-haspopup="menu"
          aria-label="Open Workflows"
          className="h-7 border border-border px-2 text-[11px] text-foreground outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={(event) => {
            positionCompactMenu(event.currentTarget);
            setOpenMenu(null);
            setActiveCommandId(null);
            setCompactOpen((current) => !current);
          }}
          type="button"
        >
          Workflows
        </button>
        {compactOpen && openMenu === null && (
          <div
            className="fixed z-[60] w-[min(260px,calc(100vw-8px))] overflow-hidden border border-border bg-card p-1"
            data-editor-workflow-category-menu
            id="editor-workflow-compact-popover"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              setCompactOpen(false);
              compactTriggerRef.current?.focus();
            }}
            role="menu"
            style={compactMenuPosition}
          >
            {visibleGroups.map((group) => (
              <button
                aria-label={`Open ${group.title} workflows`}
                className="flex min-h-8 w-full items-center border-b border-border px-2 text-left text-[11px] text-foreground outline-none last:border-b-0 hover:bg-accent"
                key={group.title}
                onClick={() => openMenuFor(group.title, true)}
                role="menuitem"
                type="button"
              >
                {group.title}
              </button>
            ))}
          </div>
        )}
        {compactOpen && openMenu !== null && (() => {
          const group = visibleGroups.find((candidate) => candidate.title === openMenu);
          return group ? renderCommandMenu(group, true) : null;
        })()}
      </div>
    </nav>
  );
}
