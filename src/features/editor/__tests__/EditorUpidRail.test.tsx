import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorUpidRail } from '../EditorUpidRail';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorUpidRail', () => {
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

  it('keeps program and geometry as separate expanded lenses', async () => {
    const onModeChange = vi.fn();

    await act(async () => {
      root.render(
        <EditorUpidRail
          collapsed={false}
          geometryContent={<div>Geometry hierarchy</div>}
          mode="program"
          onCollapseChange={vi.fn()}
          onModeChange={onModeChange}
          programContent={<div>Program sequence</div>}
          selectedOperationOrdinal={null}
          status="ready"
        />
      );
    });

    expect(container.querySelector<HTMLElement>('#editor-upid-rail-panel-program')?.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>('#editor-upid-rail-panel-geometry')?.hidden).toBe(true);
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Geometry lens"]')?.click();
    });
    expect(onModeChange).toHaveBeenCalledWith('geometry');
  });

  it('uses associated tabs and arrow keys to move focus between lenses', async () => {
    const onModeChange = vi.fn();

    await act(async () => {
      root.render(
        <EditorUpidRail
          collapsed={false}
          geometryContent={<div>Geometry hierarchy</div>}
          mode="program"
          onCollapseChange={vi.fn()}
          onModeChange={onModeChange}
          programContent={<div>Program sequence</div>}
          selectedOperationOrdinal={null}
          status="ready"
        />
      );
    });

    const programTab = container.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Program lens"]');
    const geometryTab = container.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Geometry lens"]');
    const programPanel = container.querySelector<HTMLElement>('#editor-upid-rail-panel-program');
    const geometryPanel = container.querySelector<HTMLElement>('#editor-upid-rail-panel-geometry');

    expect(programTab?.getAttribute('aria-controls')).toBe('editor-upid-rail-panel-program');
    expect(geometryTab?.getAttribute('aria-controls')).toBe('editor-upid-rail-panel-geometry');
    expect(programPanel?.getAttribute('aria-labelledby')).toBe(programTab?.id);
    expect(geometryPanel?.getAttribute('aria-labelledby')).toBe(geometryTab?.id);

    await act(async () => {
      programTab?.focus();
      programTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(document.activeElement).toBe(geometryTab);
    expect(onModeChange).toHaveBeenLastCalledWith('geometry');

    await act(async () => {
      geometryTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    });
    expect(document.activeElement).toBe(programTab);
    expect(onModeChange).toHaveBeenLastCalledWith('program');

    await act(async () => {
      geometryTab?.focus();
      geometryTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }));
    });
    expect(document.activeElement).toBe(programTab);
    expect(onModeChange).toHaveBeenLastCalledWith('program');

    await act(async () => {
      programTab?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
    });
    expect(document.activeElement).toBe(geometryTab);
    expect(onModeChange).toHaveBeenLastCalledWith('geometry');
  });

  it('uses a 36px compact strip with named expand, lens, status, and ordinal controls', async () => {
    const onCollapseChange = vi.fn();
    const onModeChange = vi.fn();

    await act(async () => {
      root.render(
        <EditorUpidRail
          collapsed
          geometryContent={<div>Geometry hierarchy</div>}
          mode="program"
          onCollapseChange={onCollapseChange}
          onModeChange={onModeChange}
          programContent={<div>Program sequence</div>}
          selectedOperationOrdinal={2}
          status="review-required"
        />
      );
    });

    const rail = container.querySelector<HTMLElement>('[data-editor-upid-rail]');
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand UPID rail"]');
    const lens = container.querySelector<HTMLButtonElement>('[aria-label="Switch to Geometry lens"]');
    expect(rail?.className).toContain('w-9');
    expect(expand).not.toBeNull();
    expect(lens).not.toBeNull();
    expect(container.querySelector('[aria-label="Program status: Review required"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Selected operation 2"]')?.textContent).toBe('02');

    await act(async () => {
      expand?.click();
      lens?.click();
    });
    expect(onCollapseChange).toHaveBeenCalledWith(false);
    expect(onModeChange).toHaveBeenCalledWith('geometry');
  });
});
