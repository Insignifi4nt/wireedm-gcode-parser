import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleSimulation } from '@/domain/simulation';
import { SimulationViewport } from '../SimulationViewport';
import { createSimulationScene, type SimulationScene } from '../SimulationScene';
import { compiledInput } from './simulationCompilerTestSupport';

vi.mock('../SimulationScene', () => ({ createSimulationScene: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe('simulation viewport lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: ComponentProps<typeof SimulationViewport>;
  let scene: SimulationScene;

  beforeEach(() => {
    const plan = compiledInput().plan;
    scene = {
      backend: 'WebGPU', update: vi.fn(), setMachine: vi.fn(), setMachineVisible: vi.fn(),
      fitMachine: vi.fn(), setView: vi.fn(), capture: vi.fn(), dispose: vi.fn()
    };
    vi.mocked(createSimulationScene).mockResolvedValue(scene);
    props = { plan, snapshot: sampleSimulation(plan, 0), machine: null,
      placement: { x: 0, y: 0, z: 0, rotation: 0 }, onCaptureReady: vi.fn() };
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); });

  it('releases a newly created scene if applying its initial model fails and permits a clean retry', async () => {
    vi.mocked(scene.setMachine).mockImplementationOnce(() => { throw new Error('Unable to render the model'); });
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to render the model');
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(props.onCaptureReady).toHaveBeenLastCalledWith(null);

    const replacement = { ...scene, dispose: vi.fn() };
    vi.mocked(createSimulationScene).mockResolvedValueOnce(replacement);
    await click('Retry renderer');
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(props.onCaptureReady).toHaveBeenLastCalledWith(expect.any(Function));
    await act(async () => root.render(null));
    expect(replacement.dispose).toHaveBeenCalledOnce();
  });

  it('contains a later playback render failure and invalidates the capture callback', async () => {
    await render();
    expect(props.onCaptureReady).toHaveBeenLastCalledWith(expect.any(Function));
    vi.mocked(scene.update).mockImplementationOnce(() => { throw new Error('Renderer lost the device'); });
    await expect(render({ snapshot: sampleSimulation(props.plan, 0.1) })).resolves.toBeUndefined();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Renderer lost the device');
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(props.onCaptureReady).toHaveBeenLastCalledWith(null);
    await act(async () => root.render(null));
    expect(scene.dispose).toHaveBeenCalledOnce();
  });

  it('disposes a scene whose creation finishes after unmount without exposing a stale capture', async () => {
    let finish!: (value: SimulationScene) => void;
    vi.mocked(createSimulationScene).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => root.render(null));
    await act(async () => finish(scene));
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(scene.update).not.toHaveBeenCalled();
    expect(props.onCaptureReady).toHaveBeenCalledExactlyOnceWith(null);
  });

  async function render(changes: Partial<ComponentProps<typeof SimulationViewport>> = {}) {
    props = { ...props, ...changes };
    await act(async () => root.render(<SimulationViewport {...props} />));
  }
  async function click(text: string) {
    const button = [...container.querySelectorAll('button')].find(element => element.textContent === text);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }
});
