export type EditorCommandId = string;

export type EditorCommandScope =
  | 'workbench'
  | 'document'
  | 'operation'
  | 'contour'
  | 'segment'
  | 'point'
  | 'view'
  | 'machine'
  | 'export';

export type EditorCommandPrerequisite =
  | { kind: 'document' }
  | { kind: 'selected-operation' }
  | { kind: 'selected-path-element' }
  | { kind: 'interaction-unlocked' };

export type EditorCommandAvailability =
  | { enabled: true }
  | { enabled: false; reason: string };

export interface EditorCommandDefinition {
  id: EditorCommandId;
  label: string;
  menuPath: readonly [string, ...string[]];
  scope: EditorCommandScope;
  toolWindowId?: string;
  historyLabel?: string;
  prerequisites?: readonly EditorCommandPrerequisite[];
  session?: { kind: string };
}

export interface EditorCommandEvaluationContext {
  documentAvailable: boolean;
  interactionLocked: boolean;
  selectedOperationId: string | null;
  selectedPathElementId: string | null;
  activeTool: { commandId: EditorCommandId; label: string } | null;
  visiblePanelIds: readonly string[];
}

export interface EditorCommandRegistry {
  all(): readonly EditorCommandDefinition[];
  get(id: EditorCommandId): EditorCommandDefinition | undefined;
  commandsForMenu(menu: string): readonly EditorCommandDefinition[];
}

export function createEditorCommandRegistry(
  commands: readonly EditorCommandDefinition[]
): EditorCommandRegistry {
  const ordered = [...commands];
  const byId = new Map<EditorCommandId, EditorCommandDefinition>();
  for (const command of ordered) {
    if (byId.has(command.id)) {
      throw new Error(`Duplicate editor command id: ${command.id}.`);
    }
    byId.set(command.id, command);
  }
  return {
    all: () => ordered,
    get: (id) => byId.get(id),
    commandsForMenu: (menu) => ordered.filter((command) => command.menuPath[0] === menu)
  };
}

export function evaluateEditorCommand(
  command: EditorCommandDefinition,
  context: EditorCommandEvaluationContext
): EditorCommandAvailability {
  if (context.activeTool && context.activeTool.commandId !== command.id && command.session) {
    return {
      enabled: false,
      reason: `Finish or cancel ${context.activeTool.label} before starting ${command.label}.`
    };
  }

  for (const prerequisite of command.prerequisites ?? []) {
    if (prerequisite.kind === 'document' && !context.documentAvailable) {
      return { enabled: false, reason: `Open a document before starting ${command.label}.` };
    }
    if (prerequisite.kind === 'selected-operation' && !context.selectedOperationId) {
      return { enabled: false, reason: `Select an operation before starting ${command.label}.` };
    }
    if (prerequisite.kind === 'selected-path-element' && !context.selectedPathElementId) {
      return { enabled: false, reason: `Select geometry before starting ${command.label}.` };
    }
    if (prerequisite.kind === 'interaction-unlocked' && context.interactionLocked) {
      return { enabled: false, reason: `Wait for the current file action before starting ${command.label}.` };
    }
  }

  return { enabled: true };
}

export function canStartEditorToolSession(availability: EditorCommandAvailability): boolean {
  return availability.enabled;
}
