import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clampEditorFloatingPanelGeometry,
  EditorPanelToolbar,
  EditorWorkspacePanelFrame
} from '../EditorWorkspacePanels';

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

    expect(summary?.textContent).toBe('');
    expect(summary?.getAttribute('aria-label')).toBe('Panels');
    expect(summary?.getAttribute('title')).toBe('All workspace panels');
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
      ['contour-tree', 'Contour Tree'],
      ['path-actions', 'Path Actions'],
      ['cut-sequence', 'Cut Sequence'],
      ['path-transform', 'Transform'],
      ['path-diagnostics', 'Path Diagnostics'],
      ['statistics', 'Statistics'],
      ['measurement', 'Measurement'],
      ['machine', 'Machine']
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

    for (const [id, title] of shortcutPanels) {
      const shortcut = container.querySelector(
        `button[data-editor-panel-shortcut="${id}"]`
      ) as HTMLButtonElement | null;
      const action = id === 'path-actions' ? 'Hide' : 'Show';
      expect(shortcut?.textContent).toBe('');
      expect(shortcut?.getAttribute('aria-label')).toBe(
        `${action} ${title} workspace panel`
      );
      expect(shortcut?.getAttribute('title')).toBe(`${action} ${title}`);
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

describe('EditorWorkspacePanelFrame', () => {
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

  it('offers keyboard placement, move, and resize controls without replacing pointer handles', async () => {
    const geometry = { x: 300, y: 120, width: 340, height: 430 };
    const onDock = vi.fn();
    const onFloat = vi.fn();
    const onGeometryChange = vi.fn();

    await act(async () => {
      root.render(
        <>
          <div data-editor-floating-layer />
          <EditorWorkspacePanelFrame
            geometry={geometry}
            id="path-transform"
            onDock={onDock}
            onDragEnd={vi.fn()}
            onFloat={onFloat}
            onFloatFromDock={vi.fn()}
            onGeometryChange={onGeometryChange}
            onHide={vi.fn()}
            placement="floating"
            title="Transform"
          >
            Transform tools
          </EditorWorkspacePanelFrame>
        </>
      );
    });

    const dockLeft = document.querySelector(
      'button[aria-label="Dock Transform left"]'
    ) as HTMLButtonElement | null;
    const dockRight = document.querySelector(
      'button[aria-label="Dock Transform right"]'
    ) as HTMLButtonElement | null;
    const float = document.querySelector(
      'button[aria-label="Float Transform"]'
    ) as HTMLButtonElement | null;
    const move = document.querySelector(
      'button[aria-label="Move Transform"]'
    ) as HTMLButtonElement | null;
    const resize = document.querySelector(
      'button[aria-label="Resize Transform"]'
    ) as HTMLButtonElement | null;

    expect(dockLeft?.disabled).toBe(false);
    expect(dockRight?.disabled).toBe(false);
    expect(float?.disabled).toBe(true);
    expect(move?.tabIndex).toBe(0);
    expect(resize?.tabIndex).toBe(0);
    expect(move?.getAttribute('data-editor-workspace-panel-handle')).toBe('path-transform');
    expect(resize?.getAttribute('data-editor-floating-panel-resizer')).toBe('path-transform');

    await act(async () => {
      dockLeft?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      dockRight?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      move?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
      move?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', shiftKey: true })
      );
      resize?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
      resize?.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp', shiftKey: true })
      );
    });

    expect(onDock.mock.calls).toEqual([['left'], ['right']]);
    expect(onFloat).not.toHaveBeenCalled();
    expect(onGeometryChange.mock.calls.map(([nextGeometry]) => nextGeometry)).toEqual([
      { ...geometry, x: 310 },
      { ...geometry, y: 121 },
      { ...geometry, width: 330 },
      { ...geometry, height: 429 }
    ]);
  });

  it('disables the active dock command and delegates Float from a docked frame', async () => {
    const onDock = vi.fn();
    const onFloat = vi.fn();

    await act(async () => {
      root.render(
        <>
          <div data-editor-dock-panel-stack="right" />
          <EditorWorkspacePanelFrame
            geometry={{ x: 300, y: 120, width: 340, height: 430 }}
            id="path-transform"
            onDock={onDock}
            onDragEnd={vi.fn()}
            onFloat={onFloat}
            onFloatFromDock={vi.fn()}
            onGeometryChange={vi.fn()}
            onHide={vi.fn()}
            placement="docked-right"
            title="Transform"
          >
            Transform tools
          </EditorWorkspacePanelFrame>
        </>
      );
      await Promise.resolve();
    });

    const dockRight = document.querySelector(
      'button[aria-label="Dock Transform right"]'
    ) as HTMLButtonElement | null;
    const float = document.querySelector(
      'button[aria-label="Float Transform"]'
    ) as HTMLButtonElement | null;
    expect(dockRight?.disabled).toBe(true);
    expect(float?.disabled).toBe(false);

    await act(async () => {
      float?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onFloat).toHaveBeenCalledOnce();
  });
});

describe('clampEditorFloatingPanelGeometry', () => {
  const viewport = { height: 720, left: 8, top: 42, width: 1024 };

  it('keeps dragged, resized, and undersized panels inside the usable viewport', () => {
    expect(
      clampEditorFloatingPanelGeometry(
        { x: 1400, y: 900, width: 340, height: 430 },
        viewport
      )
    ).toEqual({ x: 676, y: 282, width: 340, height: 430 });
    expect(
      clampEditorFloatingPanelGeometry(
        { x: 300, y: 120, width: 2000, height: 1000 },
        viewport
      )
    ).toEqual({ x: 8, y: 42, width: 1008, height: 670 });
    expect(
      clampEditorFloatingPanelGeometry(
        { x: 300, y: 120, width: 20, height: 30 },
        viewport
      )
    ).toEqual({ x: 300, y: 120, width: 260, height: 180 });
  });

  it('reconciles a 1440-wide layout at 1024 and preserves valid geometry identity', () => {
    expect(
      clampEditorFloatingPanelGeometry(
        { x: 1040, y: 134, width: 300, height: 220 },
        viewport
      )
    ).toEqual({ x: 716, y: 134, width: 300, height: 220 });

    const validGeometry = { x: 300, y: 120, width: 340, height: 430 };
    expect(clampEditorFloatingPanelGeometry(validGeometry, viewport)).toBe(validGeometry);
  });
});
