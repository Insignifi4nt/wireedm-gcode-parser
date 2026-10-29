import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';

// Every graph point row asks for its pattern lock reason once per render, so the call count tracks row renders.
vi.mock('@/domain/cad/cadSketchLinearPattern', async importOriginal => {
  const original = await importOriginal<typeof import('@/domain/cad/cadSketchLinearPattern')>();
  return { ...original, cadSketchLinearPatternLockReason: vi.fn(original.cadSketchLinearPatternLockReason) };
});
const rowRenders = vi.mocked(cadSketchLinearPatternLockReason);
const renderedPoints = () => rowRenders.mock.calls.map(([, target]) => target.id);

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('sketch canvas cursor rendering', () => {
  it('moves the drawing cursor without rendering unchanged graph rows again', async () => {
    const sketch: CadSketchFeature = { id: 'sketch', name: 'Sketch', suppressed: false, kind: 'sketch', plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' }],
      relations: [] } };
    const document = { ...createCadDocument('Cursor rendering'), schemaVersion: 2 as const, features: [sketch] };
    let controls: CadRenderedViewControls | null = null;
    let props: ComponentProps<typeof CadSketchCanvas> = { sketch, parameters: {}, documentVersion: 'one', tool: 'rectangle', selectedProfileId: null,
      onSelectProfile: vi.fn(), onAddProfile: vi.fn(), onPendingChange: vi.fn(), onError: vi.fn(), cancelSignal: 0, onControlsReady: value => { controls = value; },
      graphControls: { document, selection: [], onSelect: vi.fn(), onSelectSet: vi.fn(), onDelete: vi.fn(), onEditMany: vi.fn() } };
    const show = async (next: Partial<typeof props> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<CadSketchCanvas {...props} />)); };
    await show();
    const svg = container.querySelector<SVGSVGElement>('svg.cad-sketch-canvas'); if (!svg) throw new Error('Missing sketch canvas');
    let captured: number | null = null;
    Object.assign(svg, { getBoundingClientRect: () => ({ left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, x: 10, y: 20, toJSON: () => ({}) }),
      setPointerCapture: (id: number) => { captured = id; }, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: () => { captured = null; } });
    const pointer = async (type: string, x: number, y: number) => {
      const box = svg.getAttribute('viewBox')!.split(' ').map(Number), state = controls?.getState();
      if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
      const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerdown' ? 1 : 0, clientX: 10 + (x - state.centerMm[0] - box[0]) / box[2] * 800, clientY: 20 + (state.centerMm[1] - y - box[1]) / box[3] * 600, bubbles: true });
      Object.defineProperties(event, { pointerId: { value: 3 }, isPrimary: { value: true } });
      await act(async () => svg.dispatchEvent(event));
    };
    const move = (x: number, y: number) => pointer('pointermove', x, y);
    expect(renderedPoints()).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    const readout = () => container.querySelector('[data-cad-drawing-readout] text')?.textContent ?? null;

    rowRenders.mockClear(); await move(5, 5); await move(8, 6); await move(12, 4);
    expect(renderedPoints()).toEqual([]);
    // Hovering a point re-renders only that row for its highlight, and leaving it does the same.
    await move(20, 0); expect(renderedPoints()).toEqual(['b']);
    rowRenders.mockClear(); await move(10, 5); expect(renderedPoints()).toEqual(['b']);

    // With a first corner down, the size readout follows every move while the rows keep their earlier render.
    await pointer('pointerdown', -10, 15); await pointer('pointerup', -10, 15);
    rowRenders.mockClear(); await move(5, 5); const first = readout(); await move(8, 6); await move(12, 4);
    expect(first).not.toBeNull(); expect(readout()).not.toBe(first);
    expect(renderedPoints()).toEqual([]);

    rowRenders.mockClear(); await show({ graphControls: { ...props.graphControls!, selection: [{ kind: 'point', id: 'c' }] } });
    expect(renderedPoints()).toEqual(['c']);
  });
});
