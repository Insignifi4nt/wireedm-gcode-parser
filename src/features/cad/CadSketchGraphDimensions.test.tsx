import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
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
});
