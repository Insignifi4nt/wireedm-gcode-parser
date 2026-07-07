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

  it('opens the panel menu on hover, closes on leave, and remains clickable for automation', async () => {
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

    const toolbar = container.querySelector('[data-editor-panel-toolbar]') as HTMLDetailsElement | null;
    const summary = toolbar?.querySelector('summary');
    const item = toolbar?.querySelector(
      'button[data-editor-panel-menu-item="path-actions"]'
    ) as HTMLButtonElement | null;

    expect(toolbar?.open).toBe(false);

    await act(async () => {
      toolbar?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    expect(toolbar?.open).toBe(true);

    await act(async () => {
      toolbar?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(toolbar?.open).toBe(false);

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(toolbar?.open).toBe(true);

    await act(async () => {
      item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
