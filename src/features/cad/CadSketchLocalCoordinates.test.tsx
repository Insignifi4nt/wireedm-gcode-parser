import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadCurveFeature, CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { CadSketchCanvas } from './CadSketchCanvas';
import { CadSketchProfileGeometry } from './CadSketchProfileGeometry';
import * as references from './cadViewportReferences';
import type { CadRenderedViewControls } from './cadViewportControls';

let root: Root;
let container: HTMLDivElement;
let controls: CadRenderedViewControls | null;
function currentControls() { if (!controls) throw new Error('Sketch controls missing'); return controls; }
async function mount(sketch: CadSketchFeature | CadCurveFeature, overrides: Partial<ComponentProps<typeof CadSketchCanvas>> = {}) {
  await act(async () => root.render(<CadSketchCanvas sketch={sketch} parameters={{}} tool="select" selectedProfileId={null}
    onSelectProfile={vi.fn()} onAddProfile={vi.fn()} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0}
    onControlsReady={value => { controls = value; }} {...overrides} />));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); controls = null;
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('renders a small far-origin circle in bounded SVG coordinates without changing its exact source or world controls', async () => {
  const sketch: CadSketchFeature = { id: 'far', kind: 'sketch', name: 'Far circle', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 'origin', y: 100000000, radius: 12 } }] };
  const original = JSON.stringify(sketch);
  await act(async () => root.render(<CadSketchCanvas sketch={sketch} parameters={{ origin: 100000000 }} tool="select" selectedProfileId={null}
    onSelectProfile={vi.fn()} onAddProfile={vi.fn()} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0}
    onControlsReady={value => { controls = value; }} />));
  const svg = container.querySelector('.cad-sketch-canvas'); const circle = container.querySelector('.cad-profile circle');
  if (!svg || !circle || !controls) throw new Error('Far circle view missing');
  for (const value of svg.getAttribute('viewBox')!.split(' ').map(Number)) expect(Math.abs(value)).toBeLessThan(100);
  expect(Number(circle.getAttribute('cx'))).toBe(0); expect(Number(circle.getAttribute('cy'))).toBe(0);
  expect(Number(circle.getAttribute('r'))).toBe(12);
  expect(currentControls().getState()).toMatchObject({ mode: 'sketch', centerMm: [100000000, 100000000], heightSpanMm: 30 });
  expect(JSON.stringify(sketch)).toBe(original);
});

const far = 100000000;
const gear = createCadPluginProfile(CAD_GEAR_V3_PLUGIN); gear.inputs.x = 'origin'; gear.inputs.y = 'origin';
const geometries: readonly CadProfile[] = [
  { kind: 'rectangle', x: 'origin', y: far, width: 20, height: 10, cornerRadius: 3 },
  { kind: 'circle', x: 'origin', y: far, radius: 12 },
  { kind: 'polygon', points: [['origin', far], [far + 20, far], [far, far + 10]] },
  { kind: 'slot', x: 'origin', y: far, length: 20, width: 6, angle: 90 },
  { kind: 'path', segments: [
    { kind: 'line', start: [far, far], end: [far + 20, far] },
    { kind: 'arc', center: [far + 20, far + 10], radius: 10, startAngle: -90, sweep: 180 },
    { kind: 'line', start: [far + 20, far + 20], end: [far, far + 20] },
    { kind: 'line', start: [far, far + 20], end: [far, far] },
  ] },
  gear,
];

it.each(geometries)('keeps $kind geometry exact and caches its local SVG across navigation', async geometry => {
  const anchor = geometry.kind === 'plugin' ? 500000 : far; // Existing gear package placement range is ±1e6 mm.
  const parameters = { origin: anchor }; const original = JSON.stringify(geometry);
  const resolve = vi.spyOn(references, 'cadProfileReferenceGeometry');
  const render = async (viewCenter: readonly [number, number]) => act(async () => root.render(<svg><CadSketchProfileGeometry geometry={geometry} parameters={parameters} viewCenter={viewCenter} /></svg>));
  await render([anchor, anchor]);
  const cached = container.querySelector('svg > g > *'); if (!cached) throw new Error('Exact geometry missing');
  const geometryText = cached.outerHTML;
  const numbers = geometryText.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  expect(numbers.length).toBeGreaterThan(0);
  for (const value of numbers) expect(Math.abs(value)).toBeLessThan(1000);
  expect(resolve).toHaveBeenCalledTimes(1);
  await render([anchor + 3, anchor - 4]);
  expect(container.querySelector('svg > g > *')).toBe(cached);
  expect(cached.outerHTML).toBe(geometryText); expect(resolve).toHaveBeenCalledTimes(1);
  const placement = container.querySelector('svg > g')?.getAttribute('transform') ?? '';
  expect(placement).not.toContain(String(anchor));
  expect(JSON.stringify(geometry)).toBe(original);
  await act(async () => root.render(<svg><CadSketchProfileGeometry geometry={geometry} parameters={{ origin: anchor + 5 }} viewCenter={[anchor, anchor]} /></svg>));
  expect(resolve).toHaveBeenCalledTimes(2);
});

it('keeps far-origin pointer selection and keyboard drawing in world millimetres while grid and previews use local coordinates', async () => {
  const sketch: CadSketchFeature = { id: 'far', kind: 'sketch', name: 'Far circle', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: far + 2, y: -far + 3, radius: 12 } }] };
  const selected = vi.fn(), added = vi.fn();
  await mount(sketch, { onSelectProfile: selected });
  const svg = container.querySelector<SVGSVGElement>('.cad-sketch-canvas'); if (!svg) throw new Error('Canvas missing');
  Object.assign(svg, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 500 }) });
  await act(async () => svg.dispatchEvent(new MouseEvent('click', { clientX: 500, clientY: 250, detail: 1, bubbles: true })));
  expect(selected).toHaveBeenCalledExactlyOnceWith('circle');
  expect(container.querySelector('pattern')?.getAttribute('x')).toBe('-2');
  expect(container.querySelector('pattern')?.getAttribute('y')).toBe('-2');
  await mount(sketch, { tool: 'circle', onAddProfile: added });
  const key = async (key: string) => act(async () => svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  await key(' '); await key('ArrowRight');
  const preview = container.querySelector('.cad-profile-preview circle'); if (!preview) throw new Error('Circle preview missing');
  expect(Number(preview.getAttribute('cx'))).toBe(0); expect(Number(preview.getAttribute('cy'))).toBe(0);
  expect(Number(preview.getAttribute('r'))).toBe(5);
  for (const marker of container.querySelectorAll('.cad-sketch-vertex')) {
    expect(Math.abs(Number(marker.getAttribute('cx')))).toBeLessThan(10); expect(Math.abs(Number(marker.getAttribute('cy')))).toBeLessThan(10);
  }
  await key(' ');
  expect(added).toHaveBeenCalledExactlyOnceWith({ kind: 'circle', x: far, y: -far + 5, radius: 5 }, expect.any(AbortSignal));
  expect(currentControls().getState()).toMatchObject({ centerMm: [far + 2, -far + 3], heightSpanMm: 30 });
});

it('aligns inspection circles with the actual far-origin gear and keeps its parameter expressions unchanged', async () => {
  const sketch: CadSketchFeature = { id: 'gear', kind: 'sketch', name: 'Gear', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'gear', name: 'Gear', construction: false, geometry: gear }] };
  const original = JSON.stringify(sketch);
  await mount(sketch, { parameters: { origin: 500000 }, inspection: { profileIds: ['gear'], gear: { profileId: 'gear', inputName: 'module' } } });
  const overlay = container.querySelector('.cad-gear-inspection'); const pitch = overlay?.querySelector('[aria-label="Pitch circle"]');
  if (!overlay || !pitch) throw new Error('Gear inspection missing');
  expect(pitch.getAttribute('cx')).toBe('0'); expect(pitch.getAttribute('cy')).toBe('0');
  expect(Number(pitch.getAttribute('r'))).toBe(27);
  expect(overlay.getAttribute('transform')).toBe('translate(0,0)');
  expect(JSON.stringify(sketch)).toBe(original);
});

it('renders far-origin saved Curve lines and wrapped analytic arcs in one coherent local frame', async () => {
  const curve: CadCurveFeature = { id: 'rail', kind: 'curve', name: 'Far rail', suppressed: false, plane: 'YZ', offset: 5,
    segments: [{ kind: 'line', start: [far, -far], end: [far + 20, -far] },
      { kind: 'arc', center: [far + 20, -far + 10], radius: 10, startAngle: -90, sweep: 180 }] };
  const original = JSON.stringify(curve);
  await mount(curve);
  const line = container.querySelector('[data-cad-path-segments] line'), arc = container.querySelector('[data-cad-path-segments] path');
  if (!line || !arc) throw new Error('Saved Curve missing');
  expect(line.getAttribute('x1')).toBe('0'); expect(line.getAttribute('y1')).toBe('0');
  expect(line.getAttribute('x2')).toBe('20'); expect(line.getAttribute('y2')).toBe('0');
  expect(arc.getAttribute('d')).toBe('M 20 0 A 10 10 0 0 1 20 20');
  expect(currentControls().getState()).toMatchObject({ mode: 'curve', plane: 'YZ', centerMm: [expect.closeTo(far + 15, 6), -far + 10] });
  const placement = container.querySelector('[data-cad-path-segments]')?.getAttribute('transform')?.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  expect(placement).toEqual([expect.closeTo(-15, 6), -10]);
  expect(JSON.stringify(curve)).toBe(original);
});

it('draws a far-origin mixed line/arc preview locally and publishes the unchanged exact world path', async () => {
  const sketch: CadSketchFeature = { id: 'far', kind: 'sketch', name: 'Far path', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'guide', name: 'Guide', construction: true, geometry: { kind: 'circle', x: far, y: far, radius: 12 } }] };
  const added = vi.fn(), error = vi.fn(); await mount(sketch, { tool: 'path', onAddProfile: added, onError: error });
  const svg = container.querySelector('.cad-sketch-canvas'); if (!svg) throw new Error('Canvas missing');
  const key = async (key: string, count = 1) => { for (let index = 0; index < count; index++) await act(async () => svg.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); };
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label);
    if (!button) throw new Error(`Missing ${label}`); await act(async () => button.click());
  };
  await key(' '); await key('ArrowRight', 4); await key(' '); await click('3-point Arc');
  await key('ArrowUp', 4); await key(' '); await key('ArrowRight', 2); await key('ArrowDown', 2);
  const arc = container.querySelector('.cad-profile-preview > path'); if (!arc) throw new Error('Arc preview missing');
  expect(arc.getAttribute('d')).toBe('M 20 0 A 10 10 0 0 1 20 20');
  const endpoint = container.querySelectorAll('.cad-sketch-vertex')[1];
  expect(endpoint.getAttribute('cx')).toBe('20'); expect(endpoint.getAttribute('cy')).toBe('20');
  await key(' '); await click('Line'); await key('ArrowLeft', 6); await key('ArrowUp', 2); await key(' ');
  const close = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Close profile');
  if (!close) throw new Error('Close profile missing'); await act(async () => close.click());
  expect(error).not.toHaveBeenCalled(); expect(added).toHaveBeenCalledExactlyOnceWith({ kind: 'path', segments: [
    { kind: 'line', start: [far, far], end: [far + 20, far] },
    { kind: 'arc', center: [far + 20, far + 10], radius: 10, startAngle: -90, sweep: 180 },
    { kind: 'line', start: [far + 20, far + 20], end: [far, far + 20] },
    { kind: 'line', start: [far, far + 20], end: [far, far] },
  ] }, expect.any(AbortSignal));
});
