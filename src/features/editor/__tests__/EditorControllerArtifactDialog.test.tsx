import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import {
  createEmptyPostLibrary,
  installPostPackage,
  type PostInstallationRef,
  type PostLibrary
} from '@/domain/post-processor/postLibrary';
import { minimalPostPackage } from '@/domain/post-processor/__tests__/postPackageFixture';
import type { ControllerArtifactResult } from '@/domain/wire-edm-job/controllerArtifact';

import { EditorControllerArtifactDialog } from '../EditorControllerArtifactDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('EditorControllerArtifactDialog', () => {
  let container: HTMLDivElement;
  let root: Root;
  let posts: PostLibrary;
  let machines: readonly MachineDefinition[];

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const first = await installPostPackage(createEmptyPostLibrary(), minimalPostPackage());
    if (!first.ok) throw new Error(first.error.message);
    const secondPackage = {
      ...minimalPostPackage(),
      manifest: { ...minimalPostPackage().manifest, id: 'test.custom', name: 'Custom post' }
    };
    const second = await installPostPackage(first.library, secondPackage);
    if (!second.ok) throw new Error(second.error.message);
    posts = second.library;
    machines = [machine('alpha', [first.installation.ref, second.installation.ref])];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('requires a saved draft and uses the machine active setup without another selector', async () => {
    const generate = vi.fn();
    await render({ hasUnsavedChanges: true, onGenerateControllerArtifact: generate });

    expect(button('Generate controller artifact').disabled).toBe(true);
    expect(container.textContent).toContain('Save the project before generating');
    expect(container.querySelector('[aria-label="Controller export binding"]')).toBeNull();
    expect(selectElement('Controller export machine').value).toBe('alpha');
    expect(container.textContent).toContain('Setup: Production');
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates, previews, and downloads the exact returned artifact bytes', async () => {
    const artifactText = 'LINE 1\r\nLINE 2\r\n';
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      artifact: { fileName: 'project.iso', text: artifactText }
    } as ControllerArtifactResult);
    const download = vi.fn();
    await render({ onDownload: download, onGenerateControllerArtifact: generate });

    await click('Generate controller artifact');

    expect(generate).toHaveBeenCalledWith({ machineId: 'alpha' });
    expect(container.querySelector('pre')?.textContent).toBe(artifactText);
    expect(container.textContent).toContain('Output: .iso · CRLF · ASCII');

    await click('Download project.iso');
    expect(download).toHaveBeenCalledWith('project.iso', artifactText);
  });

  it('shows the exact post diagnostic when controller generation is rejected', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'CONTROLLER_ARTIFACT_POST_FAILED',
        message: 'The exact saved post could not generate an audited controller program.',
        diagnostics: [{
          code: 'POST_CUSTOM_RUNTIME_FAILED',
          message: 'Cutting motion requires active compensation.',
          eventId: 'event-000005',
          commandId: null
        }]
      }
    } satisfies ControllerArtifactResult);
    await render({ onGenerateControllerArtifact: generate });

    await click('Generate controller artifact');

    expect(container.textContent).toContain('POST_CUSTOM_RUNTIME_FAILED');
    expect(container.textContent).toContain('Cutting motion requires active compensation.');
    expect(container.textContent).toContain('Event event-000005');
  });

  it('shows execution-plan diagnostics that prevent revision creation', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'CONTROLLER_ARTIFACT_EXECUTION_PLAN_INVALID',
        message: 'The saved project cannot produce a valid execution plan.',
        diagnostics: [{
          code: 'EXECUTION_PLAN_COMPENSATION_UNRESOLVED',
          message: 'Choose which side of the contour keeps material.',
          operationId: 'operation-1'
        }]
      }
    } satisfies ControllerArtifactResult);
    await render({ onGenerateControllerArtifact: generate });

    await click('Generate controller artifact');

    expect(container.textContent).toContain('EXECUTION_PLAN_COMPENSATION_UNRESOLVED');
    expect(container.textContent).toContain('Choose which side of the contour keeps material.');
    expect(container.textContent).toContain('Operation operation-1');
  });

  it('locks machine selection while generation is pending', async () => {
    let finish!: (result: ControllerArtifactResult) => void;
    const generate = vi.fn().mockReturnValue(new Promise<ControllerArtifactResult>((resolve) => {
      finish = resolve;
    }));
    await render({ onGenerateControllerArtifact: generate });

    await click('Generate controller artifact');

    expect(selectElement('Controller export machine').disabled).toBe(true);
    expect(button('Close').disabled).toBe(true);
    await act(async () => finish({
      ok: false,
      error: {
        code: 'CONTROLLER_ARTIFACT_REVISION_UNVALIDATED',
        message: 'Test generation completed.'
      }
    }));
    expect(selectElement('Controller export machine').disabled).toBe(false);
    expect(button('Close').disabled).toBe(false);
  });

  it('blocks a machine with no active setup', async () => {
    machines = [{ ...machines[0], activeBindingId: null }];
    await render();

    expect(button('Generate controller artifact').disabled).toBe(true);
    expect(container.textContent).toContain('This machine has no active setup');
  });

  it('explains package installation when no machine or exact post is available', async () => {
    await render({ machines: [] });
    expect(button('Generate controller artifact').disabled).toBe(true);
    expect(container.textContent).toContain('Install a complete .wireedm-package');

    await render({ posts: createEmptyPostLibrary() });
    await act(async () => {
      const select = selectElement('Controller export machine');
      select.value = 'alpha';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(button('Generate controller artifact').disabled).toBe(true);
    expect(container.textContent).toContain('The active setup requires');
    expect(container.textContent).toContain('Reinstall its complete machine package');
  });

  it('keeps the generated artifact available when download fails and retries without reposting', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: true, artifact: { fileName: 'retry.iso', text: 'G90\r\nM02' }
    } as ControllerArtifactResult);
    const download = vi.fn()
      .mockImplementationOnce(() => { throw new Error('Browser download unavailable'); })
      .mockImplementationOnce(() => undefined);
    await render({ onDownload: download, onGenerateControllerArtifact: generate });

    await click('Generate controller artifact');
    await click('Download retry.iso');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Browser download unavailable');
    expect(container.querySelector('pre')?.textContent).toBe('G90\r\nM02');

    await click('Download retry.iso');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenLastCalledWith('retry.iso', 'G90\r\nM02');
    expect(generate).toHaveBeenCalledOnce();
  });

  it('contains keyboard focus and shortcuts, then restores focus when closed', async () => {
    const launcher = document.createElement('button');
    document.body.appendChild(launcher);
    launcher.focus();
    const onClose = vi.fn();
    const editorShortcut = vi.fn();
    window.addEventListener('keydown', editorShortcut);
    try {
      await render({ onClose });
      const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
      expect(document.activeElement).toBe(dialog);
      await act(async () => dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(button('Close'));
      await act(async () => button('Close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(button('Generate controller artifact'));
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })));
      expect(editorShortcut).not.toHaveBeenCalled();
      await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      expect(onClose).toHaveBeenCalledOnce();
      await act(async () => root.render(null));
      expect(document.activeElement).toBe(launcher);
    } finally {
      window.removeEventListener('keydown', editorShortcut);
      launcher.remove();
    }
  });

  async function render(overrides: Partial<React.ComponentProps<typeof EditorControllerArtifactDialog>> = {}) {
    await act(async () => {
      root.render(
        <EditorControllerArtifactDialog
          defaultMachineId="alpha"
          hasUnsavedChanges={false}
          machines={machines}
          posts={posts}
          onClose={vi.fn()}
          onDownload={vi.fn()}
          onGenerateControllerArtifact={vi.fn()}
          {...overrides}
        />
      );
    });
  }

  function button(label: string) {
    const element = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
    expect(element).toBeDefined();
    return element as HTMLButtonElement;
  }

  function selectElement(label: string) {
    const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    expect(element).not.toBeNull();
    return element!;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }
});

function machine(id: string, postRefs: readonly PostInstallationRef[]): MachineDefinition {
  return {
    format: 'wire-edm-machine',
    schemaVersion: 1,
    id,
    name: `Machine ${id}`,
    identity: {
      manufacturer: 'Maker',
      model: id,
      controller: { manufacturer: 'Controller', model: 'C1' }
    },
    limits: { xTravel: { status: 'unknown' }, yTravel: { status: 'unknown' } },
    hardware: { manualThreading: true, automaticThreading: false },
    evidence: [],
    bindings: postRefs.map((post, index) => ({
      id: index === 0 ? 'production' : `setup-${index}`,
      name: index === 0 ? 'Production' : `Setup ${index}`,
      post,
      properties: {},
      compatibility: {
        status: 'acknowledged',
        acknowledgedAt: '2026-01-01T00:00:00.000Z',
        acknowledgedBy: 'Tester',
        notes: ''
      },
      verification: { status: 'unverified' }
    })),
    activeBindingId: 'production',
    notes: ''
  };
}
