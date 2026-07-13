import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupAppTestContext,
  confirmPendingDxfImport,
  createAppTestContext,
  enableAutoOpenEditorWorkspacePanels,
  flushAsync,
  renderApp,
  simpleLineDxf,
  type AppTestContext
} from './appTestHelpers';

describe('Editor density cleanup', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    enableAutoOpenEditorWorkspacePanels();
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  async function importSimplePathProject() {
    window.showDirectoryPicker = undefined;
    await renderApp(context);

    const input = container.querySelector(
      'input[aria-label="DXF file"]'
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File([simpleLineDxf()], 'density-cleanup.dxf')]
    });

    await act(async () => {
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();
    await confirmPendingDxfImport(container);
  }

  it('keeps primary panels directly accessible in a compact Path Project header', async () => {
    await importSimplePathProject();

    const header = container.querySelector('[data-editor-context="path-project"]');
    const documentIdentity = header?.querySelector('[data-editor-document-identity]');
    expect(documentIdentity).not.toBeNull();
    expect(documentIdentity?.textContent).not.toContain('/ UPID Project');
    expect(header?.querySelector('button[aria-label="Import Program"]')).toBeNull();
    expect(header?.querySelector('input[aria-label="G-code program file"]')).toBeNull();
    expect(header?.textContent).toContain('Undo');
    expect(header?.textContent).toContain('Redo');
    expect(header?.textContent).toContain('Save');
    expect(header?.querySelector('summary[aria-label="Panels"]')).not.toBeNull();

    const shortcuts = [...(header?.querySelectorAll('[data-editor-panel-shortcut]') ?? [])];
    expect(shortcuts).toHaveLength(8);
    for (const shortcut of shortcuts) {
      expect(shortcut.textContent).toBe('');
      expect(shortcut.getAttribute('title')).toMatch(/^(Show|Hide) /);
    }
  });

  it('moves Contour Tree teaching content into one hover and focus explanation', async () => {
    await importSimplePathProject();

    expect(document.querySelector('[data-upid-contour-tree-map]')).toBeNull();
    expect(document.querySelector('[data-upid-contour-tree-help]')).toBeNull();
    expect(document.querySelector('[data-upid-contour-tree-legend]')).toBeNull();

    const helpButton = document.querySelector('button[aria-label="Contour Tree help"]');
    const helpTooltip = document.querySelector('[data-upid-contour-tree-tooltip]');
    expect(helpButton).not.toBeNull();
    expect(helpButton?.getAttribute('aria-describedby')).toBe(helpTooltip?.id);
    expect(helpTooltip?.textContent).toContain('cross-highlight the canvas');
    expect(helpTooltip?.textContent).toContain('whole cut loop');
    expect(helpTooltip?.textContent).toContain('Endpoint Topology');
  });

  it('lets each workspace panel own scrolling for its primary row collection', async () => {
    await importSimplePathProject();

    const cutSequence = document.querySelector('[data-upid-cut-sequence-list]');
    expect(cutSequence).not.toBeNull();
    expect(cutSequence?.matches('[data-upid-cut-sequence]')).toBe(true);
    expect(cutSequence?.className).not.toMatch(/max-h-|overflow-auto/);

    for (const selector of [
      '[data-upid-contour-tree]',
      '[data-upid-endpoint-topology-list]',
      '[data-upid-diagnostics-list]'
    ]) {
      const primaryList = document.querySelector(selector);
      expect(primaryList).not.toBeNull();
      expect(primaryList?.className).not.toMatch(/max-h-|overflow-auto/);
    }
  });
});
