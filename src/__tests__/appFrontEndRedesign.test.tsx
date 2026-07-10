import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupAppTestContext,
  createAppTestContext,
  flushAsync,
  renderApp,
  type AppTestContext
} from './appTestHelpers';

describe('App front-end redesign', () => {
  let context: AppTestContext;
  let container: HTMLDivElement;

  beforeEach(() => {
    context = createAppTestContext();
    container = context.container;
  });

  afterEach(() => {
    cleanupAppTestContext(context);
  });

  it('presents explicit Path Project and Machine Program entry points', async () => {
    window.showDirectoryPicker = undefined;
    await renderApp(context);

    expect(container.textContent).toContain('Workbench');
    expect(container.textContent).toContain('Import DXF as Path Project');
    expect(container.textContent).toContain('Open Machine Program');
    expect(container.textContent).toContain('.gcode, .nc, .iso, .txt');
    expect(container.textContent).toContain('Program workspace');
    expect(container.textContent).not.toContain('Export preview only');
  });

  it('keeps environment configuration in one settings surface', async () => {
    window.showDirectoryPicker = undefined;
    await renderApp(context);

    await act(async () => {
      container
        .querySelector('button[aria-label="Open settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const machineOutputSettingsButton = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Machine & Output settings'
    );
    expect(machineOutputSettingsButton).not.toBeNull();
    await act(async () => {
      machineOutputSettingsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(machineOutputSettingsButton?.getAttribute('aria-current')).toBe('page');

    const dialog = container.querySelector(
      '[role="dialog"][aria-label="Workbench settings"]'
    );
    expect(dialog?.querySelector('input[aria-label="Machine profile name"]')).not.toBeNull();
    expect(dialog?.querySelector('textarea[aria-label="Header template"]')).not.toBeNull();
    expect(dialog?.querySelector('select[aria-label="Output extension"]')).not.toBeNull();
    expect(container.querySelector('main textarea[aria-label="Header template"]')).toBeNull();
  });

  it('shows storage, machine, output, and project state in the application status bar', async () => {
    window.showDirectoryPicker = undefined;
    await renderApp(context);

    const status = container.querySelector('[data-app-status-bar]');
    expect(status?.textContent).toContain('Browser cache');
    expect(status?.textContent).toContain('Default Wire EDM');
    expect(status?.textContent).toContain('.iso');
    expect(status?.textContent).toContain('CRLF');
    expect(status?.textContent).toContain('0 projects');
  });

  it('does not report temporary storage before a workbench adapter is active', async () => {
    await renderApp(context, {
      connectRememberedWorkbenchDirectory: () => new Promise<never>(() => undefined)
    });

    const status = container.querySelector('[data-app-status-bar]');
    expect(status?.textContent).toContain('Preparing storage');
    expect(status?.textContent).not.toContain('Temporary storage');
  });

  it('opens an imported posted file in the Machine Program workspace', async () => {
    window.showDirectoryPicker = undefined;
    await renderApp(context);

    const input = container.querySelector(
      'input[aria-label="Machine program file"]'
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    if (!input) return;

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['G90\nG0 X0 Y0\nG1 X5 Y5'], 'sample.iso')]
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(container.querySelector('[data-editor-context="machine-program"]')).not.toBeNull();
    expect(container.textContent).toContain('Machine Program');
    expect(container.querySelector('[data-editor-status-bar]')?.textContent).toContain(
      'Program Lines'
    );
    const normalizedIsoExport = container.querySelector(
      'button[aria-label="Export normalized ISO"]'
    );
    expect(normalizedIsoExport).not.toBeNull();
    expect(normalizedIsoExport?.textContent).toContain('Export normalized ISO');
    expect(
      container.querySelector('button[aria-label="Open Path Project export preview"]')
    ).toBeNull();
    expect(container.querySelector('[data-app-header] h2')?.textContent).toMatch(/sample.*\.iso/);
    expect(container.querySelector('[data-editor-canvas-model="gcode"]')).not.toBeNull();

    const expandInspector = container.querySelector(
      'button[aria-label="Expand Inspector Rail"]'
    );
    await act(async () => {
      expandInspector?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsync();

    const programEditor = container.querySelector(
      'textarea[aria-label="Program editor"]'
    ) as HTMLTextAreaElement | null;
    expect(programEditor?.value).toContain('G1 X5 Y5');
  });

  it('disables every start action while an import is running', async () => {
    window.showDirectoryPicker = undefined;
    const importExternalProgram = vi.fn(() => new Promise<never>(() => undefined));
    await renderApp(context, { importExternalProgram });

    const input = container.querySelector(
      'input[aria-label="Machine program file"]'
    ) as HTMLInputElement | null;
    const buttons = [...container.querySelectorAll('button')];
    const dxfButton = buttons.find((button) =>
      button.textContent?.includes('Import DXF as Path Project')
    );
    const programButton = buttons.find((button) =>
      button.textContent?.includes('Open Machine Program')
    );
    const editorButton = buttons.find((button) => button.textContent?.includes('Open Editor'));

    expect(input).not.toBeNull();
    expect(dxfButton).toBeDefined();
    expect(programButton).toBeDefined();
    expect(editorButton).toBeDefined();
    if (!input) return;

    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [new File(['G90\nG1 X5 Y5'], 'busy.nc')]
    });

    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync();

    expect(importExternalProgram).toHaveBeenCalledOnce();
    expect(dxfButton?.disabled).toBe(true);
    expect(programButton?.disabled).toBe(true);
    expect(editorButton?.disabled).toBe(true);
  });
});
