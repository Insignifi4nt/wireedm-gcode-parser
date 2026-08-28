import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEmptyMachineLibrary } from '@/domain/machine-definition/machineLibrary';
import { createEmptyPostLibrary } from '@/domain/post-processor/postLibrary';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  MachinePostSettingsPanel,
  type MachinePostSettingsActions
} from './MachinePostSettingsPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MachinePostSettingsPanel', () => {
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

  it('requires every newly configured preference instead of inventing hidden values', async () => {
    const onSaveCatalogPreferences = vi.fn();
    await render({ onSaveCatalogPreferences });

    expect(select('Fixed import unit').value).toBe('');
    expect(select('Extension type').value).toBe('');
    expect(select('Line ending').value).toBe('');

    await choose('DXF import units', 'fixed');
    await submitPreferences();
    expect(container.textContent).toContain('Select the fixed DXF import unit.');
    expect(onSaveCatalogPreferences).not.toHaveBeenCalled();

    await choose('Fixed import unit', 'millimeters');
    await choose('Controller export', 'configured');
    await submitPreferences();
    expect(container.textContent).toContain('Select an output extension type.');
    expect(onSaveCatalogPreferences).not.toHaveBeenCalled();
  });

  async function render(overrides: Partial<MachinePostSettingsActions> = {}) {
    const actions: MachinePostSettingsActions = {
      onCreateMachineBinding: vi.fn(),
      onExportMachineDefinition: vi.fn(),
      onImportMachineDefinition: vi.fn(),
      onImportPostPackage: vi.fn(),
      onRemoveMachineBinding: vi.fn(),
      onRemoveMachineDefinition: vi.fn(),
      onRemovePostInstallation: vi.fn(),
      onReplaceMachineDefinition: vi.fn(),
      onSaveCatalogPreferences: vi.fn(),
      ...overrides
    };
    await act(async () => {
      root.render(
        <MachinePostSettingsPanel
          {...actions}
          connectedWorkbench={workbench}
          interactionLocked={false}
          settingsErrorMessage={null}
          settingsStatus="idle"
        />
      );
    });
  }

  function select(label: string) {
    const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    if (!element) throw new Error(`Select is missing: ${label}.`);
    return element;
  }

  async function choose(label: string, value: string) {
    const element = select(label);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function submitPreferences() {
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === 'Save preferences'
    );
    if (!button) throw new Error('Save preferences button is missing.');
    await act(async () => button.click());
  }
});

const adapter: WorkbenchStorageAdapter = {
  kind: 'memory',
  name: 'settings-test',
  deleteText: async () => undefined,
  ensureDirectory: async () => undefined,
  readText: async () => null,
  writeText: async () => undefined
};

const workbench: ConnectedWorkbenchCatalog = {
  adapter,
  machines: createEmptyMachineLibrary(),
  posts: createEmptyPostLibrary(),
  manifest: {
    format: 'wire-edm-workbench',
    schemaVersion: 2,
    name: 'Settings test',
    createdAt: '2026-08-28T12:00:00.000Z',
    updatedAt: '2026-08-28T12:00:00.000Z',
    preferences: {
      importUnits: { mode: 'ask' },
      export: { status: 'unconfigured' },
      recentPlanningMachineId: null
    },
    projects: []
  }
};
