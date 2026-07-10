import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorPanelToolbar } from '../EditorWorkspacePanels';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorPanelToolbar', () => {
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

  it('opens on hover, toggles from the Workspace trigger, and closes after a selection', async () => {
    const onShow = vi.fn();

    await act(async () => {
      root.render(
        <EditorPanelToolbar
          groups={[
            {
              id: 'path',
              title: 'Path',
              panels: [
                {
                  id: 'path-actions',
                  title: 'Path Actions',
                  description: 'selection actions',
                  placement: 'hidden',
                  onHide: vi.fn(),
                  onShow
                }
              ]
            }
          ]}
        />
      );
    });

    const toolbar = container.querySelector('[data-editor-panel-toolbar]');
    const details = toolbar?.querySelector('details') as HTMLDetailsElement | null;
    const summary = toolbar?.querySelector('summary');
    const item = toolbar?.querySelector(
      'button[data-editor-panel-menu-item="path-actions"]'
    ) as HTMLButtonElement | null;

    expect(summary?.textContent).toBe('Workspace');
    expect(details?.open).toBe(false);

    await act(async () => {
      details?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 550));
    });
    expect(details?.open).toBe(true);

    await act(async () => {
      details?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(details?.open).toBe(false);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(details?.open).toBe(true);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(details?.open).toBe(false);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onShow).toHaveBeenCalledTimes(1);
    expect(details?.open).toBe(false);
  });

  it('does not reopen after an explicit close while hover-open is pending', async () => {
    vi.useFakeTimers();

    try {
      await act(async () => {
        root.render(
          <EditorPanelToolbar
            groups={[
              {
                id: 'path',
                title: 'Path',
                panels: [
                  {
                    id: 'path-actions',
                    title: 'Path Actions',
                    placement: 'hidden',
                    onHide: vi.fn(),
                    onShow: vi.fn()
                  }
                ]
              }
            ]}
          />
        );
      });

      const details = container.querySelector('details') as HTMLDetailsElement | null;
      const summary = container.querySelector('summary');

      await act(async () => {
        details?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(details?.open).toBe(false);

      await act(async () => {
        vi.runAllTimers();
      });

      expect(details?.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reopen after focus leaves while hover-open is pending', async () => {
    vi.useFakeTimers();

    try {
      await act(async () => {
        root.render(
          <EditorPanelToolbar
            groups={[
              {
                id: 'path',
                title: 'Path',
                panels: [
                  {
                    id: 'path-actions',
                    title: 'Path Actions',
                    placement: 'hidden',
                    onHide: vi.fn(),
                    onShow: vi.fn()
                  }
                ]
              }
            ]}
          />
        );
      });

      const details = container.querySelector('details') as HTMLDetailsElement | null;

      await act(async () => {
        details?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        details?.dispatchEvent(
          new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })
        );
      });
      expect(details?.open).toBe(false);

      await act(async () => {
        vi.runAllTimers();
      });

      expect(details?.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reopen after a panel selection while hover-open is pending', async () => {
    vi.useFakeTimers();

    try {
      const onShow = vi.fn();

      await act(async () => {
        root.render(
          <EditorPanelToolbar
            groups={[
              {
                id: 'path',
                title: 'Path',
                panels: [
                  {
                    id: 'path-actions',
                    title: 'Path Actions',
                    placement: 'hidden',
                    onHide: vi.fn(),
                    onShow
                  }
                ]
              }
            ]}
          />
        );
      });

      const details = container.querySelector('details') as HTMLDetailsElement | null;
      const summary = container.querySelector('summary');
      const item = container.querySelector(
        'button[data-editor-panel-menu-item="path-actions"]'
      ) as HTMLButtonElement | null;

      await act(async () => {
        summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(details?.open).toBe(true);

      await act(async () => {
        details?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(onShow).toHaveBeenCalledTimes(1);
      expect(details?.open).toBe(false);

      await act(async () => {
        vi.runAllTimers();
      });

      expect(details?.open).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('delegates every primary Path shortcut to its existing panel controller', async () => {
    const shortcutPanels = [
      ['contour-tree', 'Contour Tree', 'Tree'],
      ['path-actions', 'Path Actions', 'Actions'],
      ['cut-sequence', 'Cut Sequence', 'Sequence'],
      ['path-transform', 'Transform', 'Transform'],
      ['path-diagnostics', 'Path Diagnostics', 'Diagnostics'],
      ['statistics', 'Statistics', 'Inspect'],
      ['measurement', 'Measurement', 'Measure'],
      ['machine', 'Machine', 'Machine']
    ] as const;
    const callbacks = new Map(
      shortcutPanels.map(([id]) => [
        id,
        { onHide: vi.fn(), onShow: vi.fn() }
      ])
    );

    await act(async () => {
      root.render(
        <EditorPanelToolbar
          groups={[
            {
              id: 'all',
              title: 'All',
              panels: shortcutPanels.map(([id, title]) => ({
                id,
                title,
                placement: id === 'path-actions' ? 'docked-right' as const : 'hidden' as const,
                ...callbacks.get(id)!
              }))
            }
          ]}
        />
      );
    });

    for (const [id, , label] of shortcutPanels) {
      const shortcut = container.querySelector(
        `button[data-editor-panel-shortcut="${id}"]`
      ) as HTMLButtonElement | null;
      expect(shortcut?.textContent).toBe(label);
      await act(async () => {
        shortcut?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    }

    for (const [id] of shortcutPanels) {
      const controller = callbacks.get(id);
      expect(controller?.onShow).toHaveBeenCalledTimes(id === 'path-actions' ? 0 : 1);
      expect(controller?.onHide).toHaveBeenCalledTimes(id === 'path-actions' ? 1 : 0);
    }
    expect(container.querySelectorAll('[data-editor-panel-menu-item]')).toHaveLength(8);
  });
});
