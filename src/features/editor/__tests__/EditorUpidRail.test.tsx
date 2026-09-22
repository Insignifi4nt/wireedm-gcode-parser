import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EditorUpidRail } from '../EditorUpidRail';
import { EditorCompactDrawerLaunchers } from '../EditorWorkspacePanels';

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

    expect(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')[0]?.hidden).toBe(false);
    expect(container.querySelectorAll<HTMLElement>('[role="tabpanel"]')[1]?.hidden).toBe(true);
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
    const panels = [...container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    const programPanel = panels[0];
    const geometryPanel = panels[1];

    expect(programTab?.getAttribute('aria-controls')).toBe(programPanel?.id);
    expect(geometryTab?.getAttribute('aria-controls')).toBe(geometryPanel?.id);
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

  it('keeps tab and panel IDs unique and locally associated across multiple rails', async () => {
    await act(async () => {
      root.render(
        <>
          <EditorUpidRail
            collapsed={false}
            geometryContent={<div>First geometry</div>}
            mode="program"
            onCollapseChange={vi.fn()}
            onModeChange={vi.fn()}
            programContent={<div>First program</div>}
            selectedOperationOrdinal={null}
            status="ready"
          />
          <EditorUpidRail
            collapsed={false}
            geometryContent={<div>Second geometry</div>}
            mode="geometry"
            onCollapseChange={vi.fn()}
            onModeChange={vi.fn()}
            programContent={<div>Second program</div>}
            selectedOperationOrdinal={null}
            status="ready"
          />
        </>
      );
    });

    const rails = [...container.querySelectorAll<HTMLElement>('[data-editor-upid-rail]')];
    const ids = rails.flatMap((rail) => [
      ...[...rail.querySelectorAll<HTMLElement>('[role="tab"]')].map((tab) => tab.id),
      ...[...rail.querySelectorAll<HTMLElement>('[role="tabpanel"]')].map((panel) => panel.id)
    ]);

    expect(new Set(ids).size).toBe(ids.length);
    for (const rail of rails) {
      const tabs = [...rail.querySelectorAll<HTMLElement>('[role="tab"]')];
      const panels = [...rail.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
      for (const tab of tabs) {
        const panel = panels.find(({ id }) => id === tab.getAttribute('aria-controls'));
        expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
      }
    }
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
          status="unresolved"
        />
      );
    });

    const rail = container.querySelector<HTMLElement>('[data-editor-upid-rail]');
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand UPID rail"]');
    const lens = container.querySelector<HTMLButtonElement>('[aria-label="Switch to Geometry lens"]');
    expect(rail?.className).toContain('w-9');
    expect(expand).not.toBeNull();
    expect(lens).not.toBeNull();
    expect(container.querySelector('[aria-label="Program status: Unresolved"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Selected operation 2"]')?.textContent).toBe('02');

    await act(async () => {
      expand?.click();
      lens?.click();
    });
    expect(onCollapseChange).toHaveBeenCalledWith(false);
    expect(onModeChange).toHaveBeenCalledWith('geometry');
  });

  it('keeps compact UPID and workflow drawers mutually exclusive and returns Escape focus to the launcher', async () => {
    await act(async () => {
      root.render(<CompactDrawerHarness hasActiveWorkflow />);
    });

    const upidLauncher = container.querySelector<HTMLButtonElement>('[aria-label="Open UPID rail"]');
    const workflowLauncher = container.querySelector<HTMLButtonElement>('[aria-label="Open active workflow"]');
    expect(upidLauncher).not.toBeNull();
    expect(workflowLauncher).not.toBeNull();

    await act(async () => {
      upidLauncher?.click();
    });
    expect(container.querySelector('[role="dialog"][aria-label="UPID rail"]')).not.toBeNull();

    await act(async () => {
      workflowLauncher?.click();
    });
    expect(container.querySelector('[role="dialog"][aria-label="UPID rail"]')).toBeNull();
    expect(container.querySelector('[role="dialog"][aria-label="Active workflow"]')).not.toBeNull();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(workflowLauncher);
  });

  it('shows the workflow launcher only while a workflow is active', async () => {
    await act(async () => {
      root.render(<CompactDrawerHarness hasActiveWorkflow={false} />);
    });

    expect(container.querySelector('[aria-label="Open UPID rail"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Open active workflow"]')).toBeNull();
  });

  it('omits the mobile launcher grid row when a view has no launchers while preserving an open drawer', async () => {
    await act(async () => root.render(<CompactDrawerHarness hasActiveWorkflow={false} hasUpidRail={false} />));
    // An empty flex launcher bar becomes an implicit grid row in the mobile simulation layout.
    expect(container.querySelector('[data-editor-compact-drawer-launchers]')).toBeNull();
    expect(container.childElementCount).toBe(0);

    await act(async () => root.render(<CompactDrawerHarness hasActiveWorkflow hasUpidRail={false} />));
    const workflowLauncher = container.querySelector<HTMLButtonElement>('[aria-label="Open active workflow"]');
    expect(workflowLauncher).not.toBeNull();
    await act(async () => workflowLauncher?.click());
    const draft = container.querySelector<HTMLInputElement>('[aria-label="Workflow draft"]');
    draft!.value = 'Pending workflow changes';

    await act(async () => root.render(<CompactDrawerHarness hasActiveWorkflow={false} hasUpidRail={false} />));
    expect(container.querySelector('[data-editor-compact-drawer-launchers]')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Workflow draft"]')).toBe(draft);
    expect(draft?.value).toBe('Pending workflow changes');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(container.childElementCount).toBe(0);
  });
});

function CompactDrawerHarness({ hasActiveWorkflow, hasUpidRail = true }: { hasActiveWorkflow: boolean; hasUpidRail?: boolean }) {
  const [drawer, setDrawer] = useState<'upid' | 'workflow' | null>(null);

  return (
    <EditorCompactDrawerLaunchers
      drawer={drawer}
      hasActiveWorkflow={hasActiveWorkflow}
      hasUpidRail={hasUpidRail}
      onDrawerChange={setDrawer}
      upidContent={<div>Program sequence</div>}
      workflowContent={<input aria-label="Workflow draft" defaultValue="Draft survives" />}
    />
  );
}
