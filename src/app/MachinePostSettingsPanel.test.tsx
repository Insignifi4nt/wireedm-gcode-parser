import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMachinePackageArchive } from '@/domain/machine-package';
import { machinePackageFixture } from '@/domain/machine-package/__tests__/machinePackageFixture';
import {
  commitStoredMachinePackageInstallation,
  prepareStoredMachinePackageInstallation
} from '@/domain/machine-package/machinePackageInstallation';
import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';
import { initializeWorkbenchCatalog, type ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  MachinePostSettingsPanel,
  type MachinePostSettingsActions
} from './MachinePostSettingsPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MachinePostSettingsPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let workbench: ConnectedWorkbenchCatalog;

  beforeEach(async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const initialized = await initializeWorkbenchCatalog(new MemoryAdapter(), {
      now: new Date('2026-09-04T08:00:00.000Z')
    });
    if (!initialized.ok) throw new Error(initialized.error.message);
    workbench = initialized.workbench;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('keeps only dynamic preferences and never asks for controller output settings', async () => {
    const onSaveCatalogPreferences = vi.fn();
    await render({ onSaveCatalogPreferences });

    expect(select('Fixed import unit').value).toBe('');
    expect(container.querySelector('[aria-label="Controller export"]')).toBeNull();
    expect(container.querySelector('[aria-label="Line ending"]')).toBeNull();
    expect(container.querySelector('[aria-label="Post properties JSON"]')).toBeNull();

    await choose('DXF import units', 'fixed');
    await click('Save preferences');
    expect(container.textContent).toContain('Select the fixed DXF import unit.');
    expect(onSaveCatalogPreferences).not.toHaveBeenCalled();
  });

  it('previews one complete package and commits the explicit install choice', async () => {
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const onPrepareMachinePackage = vi.fn().mockResolvedValue(prepared);
    const onCommitMachinePackage = vi.fn().mockResolvedValue(true);
    await render({ onCommitMachinePackage, onPrepareMachinePackage });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Machine package input is missing.');
    const file = new File(['archive'], 'robofil.wireedm-package', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

    expect(onPrepareMachinePackage).toHaveBeenCalledWith(file);
    expect(container.textContent).toContain('Shop Robofil 100 package');
    expect(container.textContent).toContain('Machine: Shop Robofil 100');
    await click('Install machine package');
    expect(onCommitMachinePackage).toHaveBeenCalledWith(prepared.prepared, { kind: 'install-new' });
  });

  it('previews a dropped package through the same install flow and rejects invalid drops', async () => {
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    const onPrepareMachinePackage = vi.fn().mockResolvedValue(prepared);
    await render({ onPrepareMachinePackage });

    const zone = container.querySelector('[aria-label="Machine package drop zone"]');
    if (!zone) throw new Error('Drop zone is missing.');
    const packageFile = new File(['archive'], 'robofil.wireedm-package');
    await drop([packageFile]);
    expect(onPrepareMachinePackage).toHaveBeenCalledExactlyOnceWith(packageFile);
    expect(container.querySelector('[data-machine-package-preview]')).not.toBeNull();

    await drop([new File(['bad'], 'drawing.dxf')]);
    expect(onPrepareMachinePackage).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Drop a .wireedm-package or .zip file.');
    expect(container.querySelector('[data-machine-package-preview]')).toBeNull();

    await drop([packageFile, packageFile]);
    expect(container.textContent).toContain('Drop one machine package file at a time.');
    expect(onPrepareMachinePackage).toHaveBeenCalledTimes(1);

    async function drop(files: File[]) {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files } });
      await act(async () => zone!.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('discards previews and late preparation results when the connected workbench changes', async () => {
    const built = await buildMachinePackageArchive(await machinePackageFixture());
    if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
    const prepared = await prepareStoredMachinePackageInstallation(workbench, built.archive);
    if (!prepared.ok) throw new Error(prepared.error.message);
    type Prepared = Extract<Awaited<ReturnType<typeof prepareStoredMachinePackageInstallation>>, { ok: true }>;
    let resolve!: (value: Prepared) => void;
    const pending = new Promise<Prepared>((done) => { resolve = done; });
    const onPrepareMachinePackage = vi.fn().mockResolvedValueOnce(prepared).mockReturnValueOnce(pending);
    await render({ onPrepareMachinePackage });
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['archive'], 'machine.wireedm-package')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(container.querySelector('[data-machine-package-preview]')).not.toBeNull();
    workbench = { ...workbench, machines: { ...workbench.machines } };
    await render({ onPrepareMachinePackage });
    expect(container.querySelector('[data-machine-package-preview]')).toBeNull();
    act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
    const other = await initializeWorkbenchCatalog(new MemoryAdapter());
    if (!other.ok) throw new Error(other.error.message);
    workbench = other.workbench;
    await render({ onPrepareMachinePackage });
    await act(async () => { resolve(prepared); await pending; });
    expect(container.querySelector('[data-machine-package-preview]')).toBeNull();
  });

  it('shows complete leaf-level physical machine changes before replacement', async () => {
    const beforeModel = 'Controller model with a deliberately shared long prefix A';
    const afterModel = 'Controller model with a deliberately shared long prefix B';
    const firstBuilt = await buildMachinePackageArchive(await machinePackageFixture({ controllerModel: beforeModel }));
    if (!firstBuilt.ok) throw new Error(JSON.stringify(firstBuilt.diagnostics));
    const firstPrepared = await prepareStoredMachinePackageInstallation(workbench, firstBuilt.archive);
    if (!firstPrepared.ok) throw new Error(firstPrepared.error.message);
    const firstCommitted = await commitStoredMachinePackageInstallation(firstPrepared.prepared, { kind: 'install-new' });
    if (!firstCommitted.ok) throw new Error(firstCommitted.error.message);
    workbench = firstCommitted.workbench;
    const changedBuilt = await buildMachinePackageArchive(await machinePackageFixture({
      packageVersion: '2.0.0',
      postVersion: '2.0.0',
      bindingId: 'production-v2',
      controllerModel: afterModel
    }));
    if (!changedBuilt.ok) throw new Error(JSON.stringify(changedBuilt.diagnostics));
    const changedPrepared = await prepareStoredMachinePackageInstallation(workbench, changedBuilt.archive);
    if (!changedPrepared.ok) throw new Error(changedPrepared.error.message);
    const onPrepareMachinePackage = vi.fn().mockResolvedValue(changedPrepared);
    await render({ onPrepareMachinePackage });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('Machine package input is missing.');
    const file = new File(['archive'], 'robofil-update.wireedm-package', { type: 'application/zip' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));

    expect(container.textContent).toContain('/identity/controller/model');
    expect(container.textContent).toContain(beforeModel);
    expect(container.textContent).toContain(afterModel);
  });

  async function render(overrides: Partial<MachinePostSettingsActions> = {}) {
    const actions: MachinePostSettingsActions = {
      onActivateMachineSetup: vi.fn(),
      onCommitMachinePackage: vi.fn().mockResolvedValue(false),
      onPrepareMachinePackage: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: 'TEST', message: 'No package supplied.' }
      }),
      onRemoveMachineDefinition: vi.fn(),
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

  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
    if (!button) throw new Error(`Button is missing: ${label}.`);
    await act(async () => button.click());
  }
});

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly name = 'settings-test';
  readonly files = new Map<string, string>();
  async deleteText(path: string) { this.files.delete(path); }
  async ensureDirectory() { return undefined; }
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
}
