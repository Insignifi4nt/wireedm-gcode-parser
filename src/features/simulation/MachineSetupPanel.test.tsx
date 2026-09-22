import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { machineImportFailure, type MachineModel } from '@/domain/simulation/machine-import';
import type { MachineImportWorkerResponse } from './machine-import/protocol';
import { MACHINE_IMPORT_THIRD_PARTY } from './machine-import/thirdPartyNotices';
import { MachineSetupPanel } from './MachineSetupPanel';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent<MachineImportWorkerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { TestWorker.instances.push(this); }
  send(data: MachineImportWorkerResponse) { this.onmessage?.({ data } as MessageEvent<MachineImportWorkerResponse>); }
}

describe('MachineSetupPanel', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  const onMachineChange = vi.fn();
  const onPlacementChange = vi.fn();
  const placement = { x: 10, y: 20, z: 30, rotation: 45 };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    TestWorker.instances = [];
    vi.stubGlobal('Worker', TestWorker);
    onMachineChange.mockClear();
    onPlacementChange.mockClear();
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('retains intermediate minus signs and applies negative alignment only after explicit submission', async () => {
    await render();
    await change('Machine x', '-');
    expect(input('Machine x').value).toBe('-');
    expect(onPlacementChange).not.toHaveBeenCalled();
    await change('Machine x', '-12.5');
    await change('Machine z', '-0.25');
    await change('Machine rotation', '-90');
    expect(onPlacementChange).not.toHaveBeenCalled();
    await click('Apply alignment');
    expect(onPlacementChange).toHaveBeenCalledExactlyOnceWith({ x: -12.5, y: 20, z: -0.25, rotation: -90 });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ['x', ''], ['x', '-'], ['x', 'Infinity'], ['x', '0x10'], ['x', '10000001'], ['rotation', '-360001']
  ])('rejects invalid %s alignment %s without changing the scene', async (key, value) => {
    await render();
    await change(`Machine ${key}`, value);
    await click('Apply alignment');
    expect(onPlacementChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('±10,000,000 mm');
  });

  it('updates its coordinate drafts after an applied placement changes outside the form', async () => {
    const machine = model('existing');
    await render({ machine });
    await change('Machine x', '-');
    await render({ machine, placement: { x: -40, y: 2, z: 8, rotation: -180 } });
    expect(input('Machine x').value).toBe('-40');
    expect(input('Machine rotation').value).toBe('-180');
    expect(onPlacementChange).not.toHaveBeenCalled();
  });

  it('reports import progress and retains the current model and alignment when replacement fails', async () => {
    await render();
    const file = new File(['STEP source'], 'replacement.step');
    await chooseFile(file);
    const worker = TestWorker.instances[0];
    expect(worker.postMessage).toHaveBeenCalledWith({ file });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Reading STEP file');
    await act(async () => worker.send({ type: 'progress', progress: { stage: 'triangulating' } }));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Tessellating machine geometry');
    await act(async () => worker.send({ type: 'result', result: machineImportFailure('MACHINE_IMPORT_INVALID_STEP', 'STEP data is incomplete.') }));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('STEP data is incomplete.');
    expect(container.textContent).toContain('existing.step');
    expect(input('Machine x').value).toBe('10');
    expect(onMachineChange).not.toHaveBeenCalled();
    expect(onPlacementChange).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('replaces the model and resets its placement only after successful import', async () => {
    await render();
    await chooseFile(new File(['STEP source'], 'replacement.step'));
    expect(onMachineChange).not.toHaveBeenCalled();
    const replacement = model('replacement');
    await act(async () => TestWorker.instances[0].send({ type: 'result', result: { ok: true, model: replacement } }));
    expect(onMachineChange).toHaveBeenCalledExactlyOnceWith(replacement);
    expect(onPlacementChange).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0, z: 0, rotation: 0 });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('cancels an active worker, preserves the current model, and ignores a late successful reply', async () => {
    await render();
    await chooseFile(new File(['STEP source'], 'replacement.step'));
    const worker = TestWorker.instances[0];
    const lateReply = worker.onmessage;
    await click('Cancel STEP import');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    await act(async () => lateReply?.({ data: { type: 'result', result: { ok: true, model: model('late') } } } as MessageEvent<MachineImportWorkerResponse>));
    expect(onMachineChange).not.toHaveBeenCalled();
    expect(onPlacementChange).not.toHaveBeenCalled();
    expect(container.textContent).toContain('existing.step');
  });

  it('stops an active replacement before removing its current model', async () => {
    await render();
    await chooseFile(new File(['STEP source'], 'replacement.step'));
    await click('Remove machine model');
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(onMachineChange).toHaveBeenCalledExactlyOnceWith(null);
    expect(onPlacementChange).not.toHaveBeenCalled();
  });

  it('terminates the parser when the panel unmounts', async () => {
    await render();
    await chooseFile(new File(['STEP source'], 'replacement.step'));
    await act(async () => root.unmount());
    mounted = false;
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(onMachineChange).not.toHaveBeenCalled();
  });

  it('exposes local license assets and exact upstream source links beside STEP import', async () => {
    await render({ machine: null });
    const details = [...container.querySelectorAll('details')].find(element => element.querySelector('summary')?.textContent === 'STEP importer licenses & source');
    expect(details?.textContent).toContain(MACHINE_IMPORT_THIRD_PARTY.notice);
    expect([...details!.querySelectorAll('a')].map(link => ({ label: link.textContent, href: link.getAttribute('href') }))).toEqual(MACHINE_IMPORT_THIRD_PARTY.links);
  });

  async function render(overrides: Partial<ComponentProps<typeof MachineSetupPanel>> = {}) {
    await act(async () => root.render(<MachineSetupPanel machine={model('existing')} placement={placement} onMachineChange={onMachineChange} onPlacementChange={onPlacementChange} {...overrides} />));
  }

  function input(label: string) { return container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!; }

  async function change(label: string, value: string) {
    await act(async () => {
      const element = input(label);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function click(label: string) {
    const button = [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  async function chooseFile(file: File) {
    await act(async () => {
      const element = input('Machine STEP file');
      Object.defineProperty(element, 'files', { configurable: true, value: [file] });
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
});

function model(id: string): MachineModel {
  const bounds = { min: [0, 0, 0] as const, max: [1, 1, 0] as const };
  return {
    id, name: `${id}.step`, format: 'step', units: 'mm', bounds,
    meshes: [{ id: 'mesh', name: 'Triangle', positions: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: null, indices: new Uint32Array([0, 1, 2]), color: null, faceGroups: [], bounds }],
    root: { name: id, meshIds: ['mesh'], children: [] }, triangleCount: 1,
    source: { fileName: `${id}.step`, byteLength: 11, sha256: '0'.repeat(64) },
    tessellation: { linearDeflectionMm: 0.1, angularDeflectionRadians: 0.5 }
  };
}
