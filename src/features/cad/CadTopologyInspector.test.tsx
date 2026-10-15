import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadTopologyDescriptor, CadTopologyInspectResult, CadTopologyPickSet } from '@/domain/cad/cadTopology';
import { CadTopologyInspector, type CadInspectTopology } from './CadTopologyInspector';

let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const edge = (key = 'edge'): CadTopologyDescriptor => ({ kind: 'edge', key, curveType: 'line', length: 10,
  start: [0, 0, 0], end: [10, 0, 0], centroid: [5, 0, 0], bounds: { min: [0, 0, 0], max: [10, 0, 0] } });
const selected = (key = 'edge'): CadTopologyPickSet => ({ documentVersion: 'version', buildId: 'build', bodyId: 'body', picks: [{ kind: 'edge', key }] });
function deferred() {
  let resolve!: (result: CadTopologyInspectResult) => void;
  const promise = new Promise<CadTopologyInspectResult>(finish => { resolve = finish; });
  return { promise, resolve };
}
function button(text: string): HTMLButtonElement {
  const target = [...container.querySelectorAll('button')].find(element => element.textContent?.trim().endsWith(text));
  if (!target) throw new Error(`Missing button: ${text}`);
  return target;
}
async function click(text: string) { await act(async () => button(text).click()); }
function render(props: Partial<Parameters<typeof CadTopologyInspector>[0]> = {}) {
  return act(async () => root.render(<CadTopologyInspector bodyId="body" buildId="build" documentVersion="version" pickMode="body" selection={null}
    locked={false} onInspect={async () => { throw new Error('Unexpected inspection'); }} onSelect={() => undefined} onClear={() => undefined} {...props} />));
}

describe('compact exact topology disclosure', () => {
  it('keeps a tiny inspected edge nondegenerate in summary, measurements and browse rows without changing its descriptor or selection', async () => {
    const descriptor: CadTopologyDescriptor = { kind: 'edge', key: 'tiny', curveType: 'line', length: 4e-7,
      start: [0, 0, 0], end: [4e-7, 0, 0], centroid: [2e-7, 0, 0], bounds: { min: [0, 0, 0], max: [4e-7, 0, 0] } }, original = JSON.stringify(descriptor), select = vi.fn();
    const inspect = vi.fn<CadInspectTopology>(async () => ({ bodyId: 'body', buildId: 'build', descriptors: [descriptor], total: 1, nextOffset: null }));
    await render({ pickMode: 'edge', selection: selected('tiny'), onInspect: inspect, onSelect: select });
    const label = (number: number) => number.toLocaleString(undefined, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false });
    expect(container.querySelector('.cad-topology-summary strong')?.textContent).toBe(`Length ${label(4e-7)} mm`);
    const end = [...container.querySelectorAll('dt')].find(node => node.textContent === 'End'); expect(end?.nextElementSibling?.textContent).toBe(`${label(4e-7)}, 0, 0 mm`);
    await click('Browse edges'); expect(container.querySelector('.cad-topology-list small')?.textContent).toBe(`${label(4e-7)} mm`);
    expect(JSON.stringify(descriptor)).toBe(original); expect(select).not.toHaveBeenCalled();
  });

  it('does not inspect or show teaching/list controls while closed and keeps exact list selection accessible', async () => {
    const inspect = vi.fn<CadInspectTopology>(async () => ({ bodyId: 'body', buildId: 'build', total: 1, nextOffset: null, descriptors: [edge()] }));
    const select = vi.fn(); await render({ onInspect: inspect, onSelect: select });
    const disclosure = button('Inspect topology');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure.getAttribute('aria-label')).toBe('Inspect topology');
    const closedIcon = disclosure.querySelector('[data-workbench-icon="expand-right"]');
    expect(closedIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(closedIcon?.getAttribute('width')).toBe('12');
    expect(container.textContent).not.toContain('Pick faces'); expect(container.textContent).not.toContain('Browse edges'); expect(inspect).not.toHaveBeenCalled();
    const panel = document.getElementById(button('Inspect topology').getAttribute('aria-controls') ?? ''); expect(panel?.hidden).toBe(true);
    await click('Inspect topology');
    expect(button('Inspect topology').querySelector('[data-workbench-icon="expand-down"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(inspect).not.toHaveBeenCalled(); await click('Browse edges');
    expect(inspect).toHaveBeenCalledWith({ bodyId: 'body', expectedBuildId: 'build', selection: { kind: 'page', topology: 'edge', offset: 0, limit: 8 } }, 'version', expect.any(AbortSignal));
    const entry = [...container.querySelectorAll('button')].find(element => element.textContent?.includes('1. Straight edge'));
    if (!entry) throw new Error('Expected exact list button'); entry.focus(); expect(document.activeElement).toBe(entry);
    await act(async () => { entry.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); });
    expect(select).toHaveBeenCalledWith({ kind: 'edge', key: 'edge' }, true);
  });
  it('expands for face/edge modes, respects manual closing, and expands for a new selection', async () => {
    const inspect = vi.fn<CadInspectTopology>(async () => ({ bodyId: 'body', buildId: 'build', total: 1, nextOffset: null, descriptors: [edge()] }));
    await render({ pickMode: 'face', onInspect: inspect }); expect(button('Inspect topology').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Browse faces'); expect(inspect).not.toHaveBeenCalled();
    await click('Inspect topology'); await render({ pickMode: 'face', onInspect: inspect });
    expect(button('Inspect topology').getAttribute('aria-expanded')).toBe('false');
    await render({ pickMode: 'edge', onInspect: inspect }); expect(button('Inspect topology').getAttribute('aria-expanded')).toBe('true');
    await click('Inspect topology'); await render({ pickMode: 'body', selection: selected(), onInspect: inspect });
    expect(button('Inspect topology').getAttribute('aria-expanded')).toBe('true'); expect(container.textContent).toContain('Length');
  });
  it('cancels selected inspection when closed and rejects its late result after reopening', async () => {
    const first = deferred(); const next = deferred();
    const inspect = vi.fn<CadInspectTopology>().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    const clear = vi.fn(); await render({ selection: selected(), onInspect: inspect, onClear: clear });
    expect(container.textContent).toContain('Inspecting exact geometry'); const firstSignal = inspect.mock.calls[0][2];
    await click('Inspect topology'); expect(firstSignal.aborted).toBe(true);
    await act(async () => first.resolve({ bodyId: 'body', buildId: 'build', total: 1, nextOffset: null, descriptors: [edge()] }));
    expect(container.textContent).not.toContain('Length'); await click('Clear selection'); expect(clear).toHaveBeenCalledOnce();
    await click('Inspect topology'); expect(inspect).toHaveBeenCalledTimes(2);
    await act(async () => next.resolve({ bodyId: 'body', buildId: 'build', total: 1, nextOffset: null, descriptors: [edge()] }));
    expect(container.textContent).toContain('Length'); expect(container.textContent).toContain('10 mm');
  });
  it('aborts obsolete builds and displays only the matching build reply', async () => {
    const first = deferred(); const next = deferred();
    const inspect = vi.fn<CadInspectTopology>().mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise);
    await render({ selection: selected(), onInspect: inspect }); const signal = inspect.mock.calls[0][2];
    await render({ buildId: 'new-build', documentVersion: 'new-version', selection: { ...selected('new-edge'), buildId: 'new-build', documentVersion: 'new-version' }, onInspect: inspect });
    expect(signal.aborted).toBe(true);
    await act(async () => first.resolve({ bodyId: 'body', buildId: 'build', total: 1, nextOffset: null, descriptors: [edge()] }));
    expect(container.textContent).not.toContain('Length');
    await act(async () => next.resolve({ bodyId: 'body', buildId: 'foreign-build', total: 1, nextOffset: null, descriptors: [edge('new-edge')] }));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('solid changed'); expect(container.textContent).not.toContain('Length');
  });
});
