import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MachineDefinition } from '@/domain/machine-definition/machineDefinition';
import type { ControllerArtifactResult } from '@/domain/wire-edm-job/controllerArtifact';

import { EditorControllerArtifactDialog } from '../EditorControllerArtifactDialog';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const machines = [machine('alpha', ['builtin', 'custom'])];

describe('EditorControllerArtifactDialog', () => {
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

  it('requires a saved draft and explicit machine and binding selections', async () => {
    const generate = vi.fn();
    await render({ hasUnsavedChanges: true, onGenerateControllerArtifact: generate });

    expect(button('Generate controller artifact').disabled).toBe(true);
    expect(container.textContent).toContain('Save the project before generating');

    await select('Controller export machine', 'alpha');
    await select('Controller export binding', 'builtin');
    expect(button('Generate controller artifact').disabled).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates, previews, and downloads the exact returned artifact bytes', async () => {
    const artifactText = 'LINE 1\r\nLINE 2\r\n';
    const generate = vi.fn().mockResolvedValue({
      ok: true,
      artifact: { fileName: 'project.nc', text: artifactText }
    } as ControllerArtifactResult);
    const download = vi.fn();
    await render({ onDownload: download, onGenerateControllerArtifact: generate });

    expect(selectElement('Controller export machine').value).toBe('');
    await select('Controller export machine', 'alpha');
    expect(selectElement('Controller export binding').value).toBe('');
    await select('Controller export binding', 'builtin');
    await click('Generate controller artifact');

    expect(generate).toHaveBeenCalledWith({ machineId: 'alpha', bindingId: 'builtin' });
    expect(container.querySelector('pre')?.textContent).toBe(artifactText);

    await click('Download project.nc');
    expect(download).toHaveBeenCalledWith('project.nc', artifactText);
  });

  it('shows typed custom-package not-runnable failures', async () => {
    const generate = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: 'CONTROLLER_ARTIFACT_POST_NOT_RUNNABLE',
        message: 'Custom package is installed but cannot run in this build.'
      }
    } as ControllerArtifactResult);
    await render({ onGenerateControllerArtifact: generate });

    await select('Controller export machine', 'alpha');
    await select('Controller export binding', 'custom');
    await click('Generate controller artifact');

    expect(container.textContent).toContain('CONTROLLER_ARTIFACT_POST_NOT_RUNNABLE');
    expect(container.textContent).toContain('Custom package is installed but cannot run in this build.');
  });

  async function render(overrides: Partial<React.ComponentProps<typeof EditorControllerArtifactDialog>> = {}) {
    await act(async () => {
      root.render(
        <EditorControllerArtifactDialog
          exportPreference={{
            status: 'configured',
            fileExtension: { kind: 'standard', extension: 'nc' },
            lineEnding: 'crlf'
          }}
          hasUnsavedChanges={false}
          machines={machines}
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

  async function select(label: string, value: string) {
    const element = selectElement(label);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }
});

function machine(id: string, bindingIds: readonly string[]): MachineDefinition {
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
    bindings: bindingIds.map((bindingId) => ({
      id: bindingId,
      name: `Binding ${bindingId}`,
      post: { packageId: `post-${bindingId}`, version: '1.0.0', contentHash: '0'.repeat(64) },
      properties: {},
      compatibility: {
        status: 'acknowledged',
        acknowledgedAt: '2026-01-01T00:00:00.000Z',
        acknowledgedBy: 'Tester',
        notes: ''
      },
      verification: { status: 'unverified' }
    })),
    notes: ''
  };
}
