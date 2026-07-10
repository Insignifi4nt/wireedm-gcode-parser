import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  cleanupAppTestContext,
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

  it('keeps primary panels directly accessible in a compact Path Project header', async () => {
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

    const header = container.querySelector('[data-editor-context="path-project"]');
    expect(header?.querySelector('[data-editor-document-identity]')).not.toBeNull();
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
});
