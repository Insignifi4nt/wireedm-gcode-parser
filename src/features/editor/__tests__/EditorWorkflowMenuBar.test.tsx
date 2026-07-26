import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorWorkflowMenuBar, type EditorWorkflowMenuGroup } from '../EditorWorkflowMenuBar';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const groups: EditorWorkflowMenuGroup[] = [
  {
    title: 'Geometry',
    commands: [
      {
        id: 'geometry.blocked',
        label: 'Blocked geometry command',
        description: 'Blocked geometry action',
        enabled: false,
        disabledReason: 'Select a contour first.',
        onExecute: vi.fn()
      },
      {
        id: 'geometry.command',
        label: 'Geometry command',
        description: 'Edit the selected contour.',
        enabled: true,
        onExecute: vi.fn()
      }
    ]
  },
  {
    title: 'Machining',
    commands: [
      {
        id: 'machining.command',
        label: 'Machining command',
        description: 'Configure machining settings.',
        enabled: true,
        onExecute: vi.fn()
      }
    ]
  },
  { title: 'Construction', commands: [] },
  { title: 'View', commands: [] },
  { title: 'Machine', commands: [] },
  { title: 'Export', commands: [] }
];

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

  it('shows one footer description for the active enabled command', async () => {
    await renderMenu();
    await clickMenu('Machining');

    expect(container.querySelectorAll('[data-editor-workflow-description]')).toHaveLength(1);
    expect(
      container.querySelector('[data-editor-workflow-command="machining.command"]')?.textContent
    ).toBe('Machining command');
    expect(container.textContent).toContain('Configure machining settings.');
  });

  it('moves focus to the first enabled command when ArrowDown opens a menu', async () => {
    await renderMenu();
    const geometryMenu = getMenuButton('Geometry');
    geometryMenu.focus();

    await act(async () => {
      geometryMenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });

    expect(document.activeElement).toBe(
      container.querySelector('[data-editor-workflow-command="geometry.command"]')
    );
  });

  it('closes a mouse-opened desktop menu with Escape at its trigger', async () => {
    await renderMenu();
    const trigger = getMenuButton('Machining');
    trigger.focus();
    await act(async () => trigger.click());
    const pageKeyDown = vi.fn();
    window.addEventListener('keydown', pageKeyDown);
    const escapeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape'
    });

    await act(async () => {
      trigger.dispatchEvent(escapeEvent);
    });
    window.removeEventListener('keydown', pageKeyDown);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(pageKeyDown).not.toHaveBeenCalled();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes the first menu when a second menu opens', async () => {
    await renderMenu();
    await clickMenu('Geometry');
    await clickMenu('Machining');

    expect(container.querySelector('[data-editor-workflow-menu="Geometry"]')).toBeNull();
    expect(container.querySelector('[data-editor-workflow-menu="Machining"]')).not.toBeNull();
  });

  it('closes its menu after an enabled command executes', async () => {
    await renderMenu();
    await clickMenu('Machining');

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        '[data-editor-workflow-command="machining.command"]'
      )?.click();
    });

    expect(groups[1].commands[0].onExecute).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-editor-workflow-menu="Machining"]')).toBeNull();
  });

  it('closes an open menu after an outside pointer interaction', async () => {
    await renderMenu();
    await clickMenu('Machining');

    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(container.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps a disabled reason available to assistive technology and pointer users', async () => {
    await renderMenu();
    await clickMenu('Geometry');

    const blocked = container.querySelector<HTMLButtonElement>(
      '[data-editor-workflow-command="geometry.blocked"]'
    );
    const describedBy = blocked?.getAttribute('aria-describedby');
    expect(blocked?.disabled).toBe(true);
    expect(blocked?.title).toBe('Select a contour first.');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Select a contour first.');
  });

  it('makes every workflow category reachable through the compact launcher', async () => {
    await renderMenu();

    await act(async () => {
      getCompactLauncher().click();
    });

    const categoryMenu = container.querySelector('[data-editor-workflow-category-menu]');
    expect(categoryMenu).not.toBeNull();
    expect(
      [...categoryMenu!.querySelectorAll<HTMLButtonElement>('button')].map(
        (button) => button.textContent
      )
    ).toEqual(['Geometry', 'Machining']);

    await act(async () => {
      categoryMenu
        ?.querySelector<HTMLButtonElement>('button[aria-label="Open Machining workflows"]')
        ?.click();
    });

    expect(
      container.querySelector('[data-editor-workflow-command="machining.command"]')
    ).not.toBeNull();
    expect(container.querySelector('[data-editor-workflow-compact-back]')).not.toBeNull();
  });

  it('owns Escape after mouse-opening a compact command menu and returns to its launcher', async () => {
    await renderMenu();
    const launcher = getCompactLauncher();
    launcher.focus();
    await act(async () => launcher.click());
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Open Machining workflows"]')
        ?.click();
    });

    const command = container.querySelector<HTMLButtonElement>(
      '[data-editor-workflow-compact] [data-editor-workflow-command="machining.command"]'
    );
    command?.focus();
    const pageKeyDown = vi.fn();
    window.addEventListener('keydown', pageKeyDown);
    const escapeEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape'
    });
    await act(async () => {
      command?.dispatchEvent(escapeEvent);
    });
    window.removeEventListener('keydown', pageKeyDown);

    expect(escapeEvent.defaultPrevented).toBe(true);
    expect(pageKeyDown).not.toHaveBeenCalled();
    expect(container.querySelector('[data-editor-workflow-compact-menu]')).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });

  async function renderMenu() {
    await act(async () => root.render(<EditorWorkflowMenuBar groups={groups} />));
  }

  async function clickMenu(title: EditorWorkflowMenuGroup['title']) {
    await act(async () => getMenuButton(title).click());
  }

  function getMenuButton(title: EditorWorkflowMenuGroup['title']) {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${title} menu"]`);
    if (!button) throw new Error(`${title} menu button was not rendered.`);
    return button;
  }

  function getCompactLauncher() {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Workflows"]'
    );
    if (!button) throw new Error('Compact Workflows launcher was not rendered.');
    return button;
  }
});
