import { describe, expect, it } from 'vitest';

import {
  canStartEditorToolSession,
  createEditorCommandRegistry,
  evaluateEditorCommand,
  type EditorCommandDefinition,
  type EditorCommandEvaluationContext
} from './editorCommands';

const selectedOperationCommand: EditorCommandDefinition = {
  id: 'machining.set-start',
  label: 'Set Start',
  menuPath: ['Machining', 'Operation', 'Set Start'],
  scope: 'operation',
  toolWindowId: 'entry-exit',
  historyLabel: 'Set operation start',
  prerequisites: [{ kind: 'selected-operation' }],
  session: { kind: 'set-start' }
};

describe('editor command availability', () => {
  it('indexes one canonical definition per command and groups commands by workflow menu', () => {
    const registry = createEditorCommandRegistry([
      selectedOperationCommand,
      {
        id: 'view.contour-tree',
        label: 'Contour Tree',
        menuPath: ['View', 'Contour Tree'],
        scope: 'view',
        toolWindowId: 'contour-tree'
      }
    ]);

    expect(registry.get('machining.set-start')).toBe(selectedOperationCommand);
    expect(registry.commandsForMenu('View').map((command) => command.id))
      .toEqual(['view.contour-tree']);
    expect(() => createEditorCommandRegistry([
      selectedOperationCommand,
      { ...selectedOperationCommand }
    ])).toThrow(/duplicate editor command/i);
  });

  it('explains that an operation must be selected', () => {
    expect(evaluateEditorCommand(selectedOperationCommand, context())).toEqual({
      enabled: false,
      reason: 'Select an operation before starting Set Start.'
    });
  });

  it('explains which mutating tool must finish first', () => {
    expect(
      evaluateEditorCommand(
        selectedOperationCommand,
        context({
          selectedOperationId: 'operation-1',
          activeTool: { commandId: 'geometry.transform', label: 'Transform Geometry' }
        })
      )
    ).toEqual({
      enabled: false,
      reason: 'Finish or cancel Transform Geometry before starting Set Start.'
    });
  });

  it('allows passive panels to remain open while starting a tool', () => {
    const available = evaluateEditorCommand(
      selectedOperationCommand,
      context({ selectedOperationId: 'operation-1', visiblePanelIds: ['contour-tree'] })
    );

    expect(available).toEqual({ enabled: true });
    expect(canStartEditorToolSession(available)).toBe(true);
  });

  it('requires mutating workflow commands to define one history label', () => {
    expect(() => createEditorCommandRegistry([{
      id: 'geometry.transform',
      label: 'Transform Geometry',
      menuPath: ['Geometry', 'Transform Geometry'],
      scope: 'document',
      toolWindowId: 'path-transform',
      workflow: { kind: 'mutating' }
    }])).toThrow(/history label/i);
  });

  it('accepts view workflows without assigning document history', () => {
    const command: EditorCommandDefinition = {
      id: 'view.summary',
      label: 'Path Summary',
      menuPath: ['View', 'Path Summary'],
      scope: 'view',
      toolWindowId: 'path-summary',
      workflow: { kind: 'view' }
    };

    expect(createEditorCommandRegistry([command]).get(command.id)).toBe(command);
  });
});

function context(
  overrides: Partial<EditorCommandEvaluationContext> = {}
): EditorCommandEvaluationContext {
  return {
    documentAvailable: true,
    interactionLocked: false,
    selectedOperationId: null,
    selectedPathElementId: null,
    activeTool: null,
    visiblePanelIds: [],
    ...overrides
  };
}
