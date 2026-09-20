import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { SimulationPlan, SimulationSnapshot } from '@/domain/simulation';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import SimulationPanel from '../SimulationPanel';
import * as collisionScan from '../useMachineCollisionScan';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const viewport = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../SimulationViewport', () => ({
  SimulationViewport: (props: unknown) => {
    viewport.render(props);
    return <div data-testid="simulation-viewport" />;
  }
}));
vi.mock('../MachineSetupPanel', () => ({ MachineSetupPanel: () => <div data-testid="machine-setup" /> }));

type PanelProps = ComponentProps<typeof SimulationPanel>;
type SceneState = { plan: SimulationPlan; snapshot: SimulationSnapshot };

function savedDocument(): PathPlanningDocument {
  const source = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
  ], { operationOrderStrategy: 'source-order' });
  source.geometryBasis = 'wire-centre';
  source.setup = {
    initialWirePosition: { kind: 'manual', point: { ...source.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  source.plan.operations[0].transitions = {
    entry: { strategy: 'none', review: 'reviewed' },
    exit: { strategy: 'none', review: 'reviewed' }
  };
  return source;
}

describe('SimulationPanel saved-process integration', () => {
  let container: HTMLDivElement;
  let root: Root;
  let props: PanelProps;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    viewport.render.mockClear();
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
    vi.spyOn(performance, 'now').mockReturnValue(0);
    props = {
      document: savedDocument(), projectName: 'Saved contour', savedAt: '2026-09-21T09:00:00.000Z',
      dirty: false, active: true, onEdit: vi.fn(), onCaptureReady: vi.fn()
    };
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('identifies the saved source and excludes dirty editor changes without changing its compiled process', async () => {
    const original = structuredClone(props.document);
    await render({ dirty: true });
    const savedPlan = scene().plan;
    expect(container.textContent).toContain('Saved contour');
    expect(container.textContent).toContain('SAVED UPID');
    expect(container.querySelector(`[title="${props.savedAt}"]`)).not.toBeNull();
    expect(container.textContent).toContain('Unsaved editor changes are excluded.');
    await clickText('Return to editor to save');
    expect(props.onEdit).toHaveBeenCalledOnce();

    await render({ dirty: false });
    expect(container.textContent).not.toContain('Unsaved editor changes are excluded.');
    expect(scene().plan).toBe(savedPlan);
    expect(props.document).toEqual(original);
  });

  it('blocks playback for missing saved machining intent and recovers when a valid saved source arrives', async () => {
    const incomplete = savedDocument();
    delete incomplete.setup;
    const original = structuredClone(incomplete);
    await render({ document: incomplete });
    expect(container.querySelector('[data-testid="simulation-viewport"]')).toBeNull();
    expect(container.querySelector('[aria-label="Play simulation"]')).toBeNull();
    expect(container.querySelector('[aria-label="Simulation timeline"]')).toBeNull();
    expect(container.textContent).toContain('Finish the machining setup');
    expect(container.textContent?.toLowerCase()).toContain('initial wire');
    await clickText('Review in editor');
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(incomplete).toEqual(original);

    await render({ document: savedDocument() });
    expect(container.querySelector('[data-testid="simulation-viewport"]')).not.toBeNull();
    expect(button('Play simulation')).toBeDefined();
    expect(scene().snapshot.elapsedSeconds).toBe(0);
  });

  it('applies stock assumptions only on submission, resets playback, and preserves saved execution provenance', async () => {
    const original = structuredClone(props.document);
    await render();
    const initial = scene().plan;
    await changeInput('Simulation timeline', '1');
    await click('Stock settings');
    await changeInput('Stock width', '45');
    await changeInput('Stock thickness', '12');
    await changeInput('Stock originX', '-15');
    await changeInput('Support floor Z', '-60');
    await changeSelect('Released piece behavior', 'retain');
    expect(scene().plan).toBe(initial);
    expect(scene().snapshot.elapsedSeconds).toBe(1);

    await submitStock();
    expect(scene().plan).not.toBe(initial);
    expect(scene().plan.settings).toMatchObject({
      stock: { width: 45, thickness: 12, originX: -15 }, supportFloorZ: -60, retention: 'retain'
    });
    expect(scene().snapshot.elapsedSeconds).toBe(0);
    expect(scene().plan.executionPlan).toEqual(initial.executionPlan);
    expect(props.document).toEqual(original);
    expect(container.textContent).toContain('no machine-cycle or cut-quality prediction');
  });

  it('keeps the last valid stock on invalid input and clears the error after a corrected application', async () => {
    await render();
    const initial = scene().plan;
    await click('Stock settings');
    await changeInput('Stock width', '0');
    await submitStock();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('greater than zero');
    expect(scene().plan).toBe(initial);
    expect(button('Play simulation')).toBeDefined();

    await changeInput('Stock width', '50');
    await submitStock();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(scene().plan.settings.stock.width).toBe(50);
  });

  it('reports an impossible support floor as a stock error while preserving the saved process', async () => {
    await render();
    const initial = scene().plan;
    const original = structuredClone(props.document);
    await click('Stock settings');
    await changeInput('Support floor Z', '1');
    await submitStock();
    expect(container.querySelector('[role="alert"]')?.textContent?.toLowerCase() ?? '').toContain('support floor');
    expect(container.querySelector('[data-testid="simulation-viewport"]')).not.toBeNull();
    expect(scene().plan).toBe(initial);
    expect(container.textContent).not.toContain('Finish the machining setup');
    expect(props.document).toEqual(original);

    await changeInput('Support floor Z', '-15');
    await submitStock();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(scene().plan.settings.supportFloorZ).toBe(-15);
  });

  it('seeks the exact end of a non-rounded circular duration and restarts from zero', async () => {
    await render();
    const duration = scene().plan.durationSeconds;
    expect(duration).not.toBe(Math.round(duration * 100) / 100);
    await changeInput('Simulation timeline', String(duration));
    expect(scene().snapshot.elapsedSeconds).toBe(duration);
    expect(scene().snapshot.phase).toBe('complete');
    expect(container.querySelector('.sim-state-card')?.textContent).toContain('Complete');
    expect(frames.size).toBe(0);

    await click('Play simulation');
    expect(scene().snapshot.elapsedSeconds).toBe(0);
    expect(frames.size).toBe(1);
    await frame(100);
    expect(scene().snapshot.elapsedSeconds).toBeCloseTo(0.1);
    await click('Restart simulation');
    expect(scene().snapshot.elapsedSeconds).toBe(0);
    expect(button('Play simulation')).toBeDefined();
    expect(frames.size).toBe(0);
  });

  it('cancels playback when inactive, preserves the seek position, and does not resume automatically', async () => {
    await render();
    await changeSelect('Simulation playback speed', '2');
    await click('Play simulation');
    await frame(100);
    expect(scene().snapshot.elapsedSeconds).toBeCloseTo(0.2);
    expect(button('Pause simulation')).toBeDefined();

    await render({ active: false });
    expect(frames.size).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(button('Play simulation')).toBeDefined();
    const stoppedAt = scene().snapshot.elapsedSeconds;
    await frame(200);
    expect(scene().snapshot.elapsedSeconds).toBe(stoppedAt);
    await render({ active: true });
    expect(frames.size).toBe(0);
    expect(scene().snapshot.elapsedSeconds).toBe(stoppedAt);
  });

  it('pauses a running animation when seeking and resets it when the saved source changes', async () => {
    await render();
    await click('Play simulation');
    await frame(100);
    await changeInput('Simulation timeline', '2');
    expect(scene().snapshot.elapsedSeconds).toBe(2);
    expect(frames.size).toBe(0);
    expect(button('Play simulation')).toBeDefined();

    const replacement = savedDocument();
    replacement.plan.operations[0].programStops = [{
      id: 'retention-check', enabled: true, reason: 'part-retention',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 5 }
    }];
    await render({ document: replacement, savedAt: '2026-09-21T10:00:00.000Z' });
    expect(scene().snapshot.elapsedSeconds).toBe(0);
    expect(scene().plan.steps.some(step => step.event.kind === 'program-stop')).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('navigates to authored stops and back without running through them', async () => {
    const source = savedDocument();
    source.plan.operations[0].programStops = [{
      id: 'operator-check', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 5 }
    }];
    await render({ document: source });
    const stop = scene().plan.steps.find(step => step.event.kind === 'program-stop');
    expect(stop).toBeDefined();
    await click('Play simulation');
    await click('Next simulation event');
    expect(scene().snapshot.elapsedSeconds).toBe(stop!.startSeconds);
    expect(scene().snapshot.phase).toBe('paused');
    expect(button('Play simulation')).toBeDefined();
    expect(frames.size).toBe(0);

    await click('Next simulation event');
    expect(scene().snapshot.phase).toBe('complete');
    await click('Previous simulation event');
    expect(scene().snapshot.elapsedSeconds).toBe(stop!.startSeconds);
    await click('Previous simulation event');
    expect(scene().snapshot.elapsedSeconds).toBe(0);
  });

  it('keeps pending stock inputs while switching focused setup panels and closes after applying', async () => {
    await render();
    await click('Stock settings');
    await changeInput('Stock width', '45');
    await click('Machine model settings');
    expect(container.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Machine model');
    await click('Close simulation settings');
    expect(container.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true);
    await click('Stock settings');
    expect(input('Stock width').value).toBe('45');
    expect(scene().plan.settings.stock.width).not.toBe(45);
    await submitStock();
    expect(scene().plan.settings.stock.width).toBe(45);
    expect(container.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true);
  });

  it('lets a user inspect future material findings directly and dismiss setup with Escape', async () => {
    await render();
    const warning = scene().plan.warnings[0];
    expect(warning).toBeDefined();
    expect(scene().snapshot.elapsedSeconds).toBe(0);
    await click('Simulation checks');
    await clickText(warning.message);
    expect(scene().snapshot.elapsedSeconds).toBe(warning.elapsedSeconds);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector<HTMLElement>('[role="dialog"]')?.hidden).toBe(true);
    expect(document.activeElement).toBe(button('Simulation checks'));
  });

  it.each(['Simulation checks', 'Simulation information'])('moves focus into %s even when it has no interactive content', async label => {
    const incomplete = savedDocument();
    delete incomplete.setup;
    await render({ document: incomplete });
    button(label).focus();
    await click(label);
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(dialog.hidden).toBe(true);
    expect(document.activeElement).toBe(button(label));
  });

  it.each(['failed', 'incomplete'] as const)('surfaces a %s machine check in the closed findings control', async status => {
    vi.spyOn(collisionScan, 'useMachineCollisionScan').mockReturnValue(status === 'failed'
      ? { status: 'error', message: 'Machine surface checking failed. No clearance was verified.' }
      : { status: 'ready', result: { complete: false, cancelled: false, checkedSweeps: 0, testedTriangles: 0,
        warnings: [], message: 'Remaining motion was not checked.', limitations: [] } });
    await render();
    const trigger = button('Simulation checks');
    expect(Number(trigger.querySelector('b')?.textContent)).toBe(scene().plan.warnings.length + 1);
    const description = document.getElementById(trigger.getAttribute('aria-describedby') ?? '');
    expect(description?.textContent?.toLowerCase()).toContain(status === 'failed' ? 'failed' : 'incomplete');
    await click('Simulation checks');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(status === 'failed' ? 'No clearance was verified.' : 'Remaining motion was not checked.');
  });

  function scene(): SceneState {
    const call = viewport.render.mock.calls.at(-1);
    if (!call) throw new Error('The saved process did not produce a simulation scene.');
    return call[0] as SceneState;
  }

  async function render(changes: Partial<PanelProps> = {}) {
    props = { ...props, ...changes };
    await act(async () => root.render(<SimulationPanel {...props} />));
  }

  function input(label: string): HTMLInputElement {
    const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing input: ${label}`);
    return element;
  }

  function button(label: string): HTMLButtonElement {
    const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing button: ${label}`);
    return element;
  }

  async function click(label: string) {
    await act(async () => button(label).click());
  }

  async function clickText(text: string) {
    const element = [...container.querySelectorAll('button')].find(item => item.textContent?.includes(text));
    if (!element) throw new Error(`Missing button: ${text}`);
    await act(async () => element.click());
  }

  async function changeInput(label: string, value: string) {
    await act(async () => {
      const element = input(label);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function changeSelect(label: string, value: string) {
    const element = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
    if (!element) throw new Error(`Missing select: ${label}`);
    await act(async () => {
      element.value = value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function submitStock() {
    const form = input('Stock width').closest('form');
    if (!form) throw new Error('Missing stock form.');
    await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }

  async function frame(now: number) {
    const callbacks = [...frames.values()];
    frames.clear();
    await act(async () => callbacks.forEach(callback => callback(now)));
  }
});
