import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorWorkflowMenuBar, type EditorWorkflowMenuGroup } from '../EditorWorkflowMenuBar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorWorkflowMenuBar', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('exposes all workflow menus, executes enabled commands, and explains disabled commands', async () => {
    const execute = vi.fn();
    const titles: EditorWorkflowMenuGroup['title'][] = [
      'Project', 'Geometry', 'Machining', 'Construction', 'View', 'Machine', 'Export'
    ];
    await act(async () => root.render(
      <EditorWorkflowMenuBar groups={titles.map((title) => ({
        title,
        commands: [{
          id: `${title.toLowerCase()}.command`,
          label: `${title} command`,
          description: 'Ready action',
          enabled: title !== 'Export',
          disabledReason: title === 'Export' ? 'Resolve export diagnostics first.' : undefined,
          onExecute: execute
        }]
      }))} />
    ));

    expect(container.querySelectorAll('summary')).toHaveLength(7);
    await act(async () => {
      container.querySelector<HTMLElement>('summary[aria-label="Machining menu"]')?.click();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-editor-workflow-command="machining.command"]')?.click();
    });
    expect(execute).toHaveBeenCalledTimes(1);

    await act(async () => {
      container.querySelector<HTMLElement>('summary[aria-label="Export menu"]')?.click();
    });
    const blocked = container.querySelector<HTMLButtonElement>('[data-editor-workflow-command="export.command"]');
    expect(blocked?.disabled).toBe(true);
    expect(blocked?.title).toBe('Resolve export diagnostics first.');
  });
});
