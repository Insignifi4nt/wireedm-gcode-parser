import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { createCadSketchCornerTreatment } from '@/domain/cad/cadSketchCornerTreatment';
import { CadSketchGraphDimensions } from './CadSketchGraphDimensions';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: ['length', 0] }], entities: [],
  relations: [{ id: 'dimension', kind: 'distance', pointIds: ['a', 'b'], value: ' length ' }] });

describe('graph dimension activation', () => {
  it.each([true, false])('owns label events and configures only when interactive=%s', async interactive => {
    const configure = vi.fn(), parent = vi.fn();
    await act(async () => root.render(<svg onPointerDown={parent} onClick={parent} onKeyDown={parent}><g transform="scale(1,-1)">
      <CadSketchGraphDimensions graph={graph} parameters={{ length: 20 }} center={[7, 2]} mmPerPixel={.1} interactive={interactive} onConfigure={configure} />
    </g></svg>));
    const label = container.querySelector<SVGGElement>('[role="button"]'); if (!label) throw new Error('Dimension label missing.');
    Object.assign(label, { focus: vi.fn() });
    const pointer = new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true });
    Object.defineProperty(pointer, 'isPrimary', { value: true });
    await act(async () => label.dispatchEvent(pointer));
    await act(async () => label.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true, detail: 1 })));
    for (const key of ['Enter', ' ']) await act(async () => label.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
    expect(configure).toHaveBeenCalledTimes(interactive ? 3 : 0);
    if (interactive) expect(configure.mock.calls.every(([relation]) => relation === graph.relations[0])).toBe(true);
    expect(parent).not.toHaveBeenCalled(); expect(pointer.defaultPrevented).toBe(true);
    expect(graph.relations[0]).toMatchObject({ value: ' length ' });
  });

  it.each(['fillet', 'chamfer'] as const)('configures the exact existing %s relation from every native annotation with owned label events', async kind => {
    let next = 0;
    const source = parseCadSketchGraph({ points: [{ id: 'v', position: [0, 0] }, { id: 'a', position: [20, 0] }, { id: 'b', position: [0, 20] }],
      entities: [{ id: 'line-a', kind: 'line', construction: false, startPointId: 'v', endPointId: 'a' },
        { id: 'line-b', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }], relations: [] });
    const { graph: corner } = createCadSketchCornerTreatment({ graph: source, parameters: { radius: 2, setback: 3 }, pointId: 'v',
      treatment: kind === 'fillet' ? { kind, radius: ' radius ' } : { kind, setbacks: ['radius', ' setback '] }, createId: () => `corner-${++next}` });
    const relation = corner.relations[0], before = JSON.stringify(corner), configure = vi.fn(), parent = vi.fn();
    const render = (interactive: boolean) => root.render(<svg onPointerDown={parent} onClick={parent} onKeyDown={parent}>
      <CadSketchGraphDimensions graph={corner} parameters={{ radius: 2, setback: 3 }} center={[7, 2]} mmPerPixel={.1}
        interactive={interactive} onConfigure={configure} selectedRelationId={relation.id} />
    </svg>);
    await act(async () => render(true));
    const labels = container.querySelectorAll<SVGGElement>('[role="button"]'); expect(labels).toHaveLength(kind === 'fillet' ? 1 : 2);
    for (const label of labels) {
      Object.assign(label, { focus: vi.fn() });
      const pointer = new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(pointer, 'isPrimary', { value: true });
      await act(async () => label.dispatchEvent(pointer));
      await act(async () => label.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true })));
      await act(async () => label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
      expect(label.getAttribute('aria-pressed')).toBe('true'); expect(pointer.defaultPrevented).toBe(true);
    }
    expect(configure).toHaveBeenCalledTimes(labels.length * 2); expect(configure.mock.calls.every(([value]) => value === relation)).toBe(true);
    expect(parent).not.toHaveBeenCalled(); expect(JSON.stringify(corner)).toBe(before);
    await act(async () => render(false)); configure.mockClear();
    for (const label of container.querySelectorAll('[role="button"]')) await act(async () => label.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true, cancelable: true })));
    expect(configure).not.toHaveBeenCalled(); expect(parent).not.toHaveBeenCalled();
  });
});
