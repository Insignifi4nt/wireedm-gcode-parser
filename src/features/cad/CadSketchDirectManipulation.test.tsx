import { act, useSyncExternalStore, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSketchCanvas } from './CadSketchCanvas';
import { CadSession } from './cadSession';
import { CAD_STAR_PLUGIN, createCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import type { CadRenderedViewControls } from './cadViewportControls';
import type { CadSketchHandle } from '@/domain/cad/cadSketchHandles';

let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const rectangle = { kind: 'rectangle', x: 0, y: 0, width: 'size', height: 10, cornerRadius: 0 } satisfies CadProfile;
async function harness(geometry: CadProfile = rectangle, overrides: Partial<ComponentProps<typeof CadSketchCanvas>> = {}) {
  let controls: CadRenderedViewControls | null = null;
  const session = new CadSession(parseCadDocument({ ...createCadDocument('Move', 'move'), parameters: { size: 20 }, features: [{
    id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'profile', name: 'Profile', construction: false, geometry, ...(geometry.kind === 'rectangle' ? { constraints: [{ id: 'height', kind: 'dimension', quantity: 'height' }] } : {}) }]
  }] }));
  const translated = vi.fn((profileId: string, translation: readonly [number, number]) => {
    session.setWorkflowOpen(false);
    session.edit([{ kind: 'translate-sketch-profiles', sketchId: 'sketch', profileIds: [profileId], translation }]);
  });
  const reshaped = vi.fn((profileId: string, handle: CadSketchHandle, translation: readonly [number, number]) => {
    session.setWorkflowOpen(false);
    session.edit([{ kind: 'move-sketch-handle', sketchId: 'sketch', profileId, handle, translation }]);
  });
  const pending = vi.fn((value: boolean) => session.setWorkflowOpen(value));
  const selected = vi.fn(), error = vi.fn(), added = vi.fn(), menu = vi.fn();
  let props = overrides;
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = state.document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Sketch fixture missing.');
    return <CadSketchCanvas sketch={sketch} parameters={state.document.parameters} documentVersion={state.version} tool="select" selectedProfileId="profile"
      onSelectProfile={selected} onAddProfile={added} onPendingChange={pending} onError={error} cancelSignal={0}
      viewLocked={state.workflowOpen} onContextMenu={menu} onTranslateProfile={translated} onControlsReady={value => { controls = value; }} {...props} />;
  }
  const render = async (next: Partial<ComponentProps<typeof CadSketchCanvas>> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<Harness />)); };
  await render();
  const svg = container.querySelector<SVGSVGElement>('svg.cad-sketch-canvas'); if (!svg) throw new Error('Canvas missing.');
  let captured: number | null = null;
  const capture = vi.fn((id: number) => { captured = id; });
  const release = vi.fn((id: number) => { if (captured === id) captured = null; });
  Object.assign(svg, { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 600 }),
    setPointerCapture: capture, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: release });
  const position = (x: number, y: number) => {
    const box = svg.getAttribute('viewBox'); if (!box) throw new Error('Canvas view missing.');
    const [minX, minY, width, height] = box.split(' ').map(Number);
    const state = controls?.getState(); if (!state || state.mode === 'solid') throw new Error('Sketch frame missing');
    return { clientX: 10 + (x - state.centerMm[0] - minX) / width * 800, clientY: 20 + (state.centerMm[1] - y - minY) / height * 600 };
  };
  const frame = () => { if (!controls) throw new Error('Sketch frame missing'); return JSON.stringify(controls.getState()); };
  const pointer = async (type: string, point: readonly [number, number], init: MouseEventInit = {}, pointerId = 11) => {
    const event = new MouseEvent(type, { button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...position(...point), ...init });
    Object.defineProperties(event, { pointerId: { value: pointerId }, isPrimary: { value: true } });
    await act(async () => svg.dispatchEvent(event));
  };
  const profile = (): CadSketchFeature['profiles'][number] => {
    const sketch = session.getSnapshot().document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Sketch missing.');
    return sketch.profiles[0];
  };
  const click = async (point: readonly [number, number]) => act(async () => svg.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, button: 0, ...position(...point) })));
  return { svg, session, translated, reshaped, pending, selected, error, added, menu, render, position, pointer, click, capture, release, profile, frame };
}

describe('direct sketch contour manipulation', () => {
  it('drags a free vertex independently, previews without persistence and commits one undoable point edit', async () => {
    const h = await harness({ kind: 'polygon', points: [[0, 0], [20, 0], [20, 10], [0, 10]] });
    await h.render({ onMoveHandle: h.reshaped });
    const initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [20, 0]); await h.pointer('pointermove', [25, -5]);
    expect(h.session.getSnapshot().document).toBe(initial.document);
    expect(h.session.getSnapshot().workflowOpen).toBe(true);
    expect(container.querySelector('[aria-label="Select Profile profile"] polygon')?.getAttribute('points')).toBe('-12.5,-2.5 12.5,-7.5 7.5,7.5 -12.5,7.5');
    await h.pointer('pointerup', [25, -5]);
    expect(h.reshaped).toHaveBeenCalledExactlyOnceWith('profile', { kind: 'vertex', index: 1 }, [5, -5]);
    expect(h.translated).not.toHaveBeenCalled();
    expect(h.profile().geometry).toEqual({ kind: 'polygon', points: [[0, 0], [25, -5], [20, 10], [0, 10]] });
    await act(async () => h.session.undo());
    expect(h.session.getSnapshot().document).toEqual(initial.document); expect(h.session.getSnapshot().canUndo).toBe(false);
  });

  it('never falls through from a locked point to whole-profile translation', async () => {
    const h = await harness({ kind: 'polygon', points: [[0, 0], ['size', 'size / 2'], [0, 20]] });
    await h.render({ onMoveHandle: h.reshaped });
    const initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [20, 10]); await h.pointer('pointermove', [25, 15]); await h.pointer('pointerup', [25, 15]);
    expect(h.session.getSnapshot()).toEqual(initial);
    expect(h.translated).not.toHaveBeenCalled(); expect(h.reshaped).not.toHaveBeenCalled();
  });

  it('honors the explicitly hit grip when another grip is nearer in an overlapping screen footprint', async () => {
    const h = await harness({ kind: 'circle', x: 0, y: 0, radius: 5 });
    await h.render({ onMoveHandle: h.reshaped });
    const radius = container.querySelector('[aria-label="Radius of Profile"]');
    if (!radius) throw new Error('Radius grip missing.');
    const event = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, buttons: 1, ...h.position(1, 0) });
    Object.defineProperties(event, { pointerId: { value: 11 }, isPrimary: { value: true } });
    await act(async () => radius.dispatchEvent(event));
    await h.pointer('pointermove', [6, 0]); await h.pointer('pointerup', [6, 0]);
    expect(h.reshaped).toHaveBeenCalledExactlyOnceWith('profile', { kind: 'radius' }, [5, 0]);
    expect(h.profile().geometry).toEqual({ kind: 'circle', x: 0, y: 0, radius: 10 });
    expect(h.translated).not.toHaveBeenCalled();
  });

  it('snaps the dragged point to the grid, cancels its preview, and supports a keyboard point edit', async () => {
    const h = await harness({ kind: 'polygon', points: [[0, 0], [22, 2], [20, 20], [0, 20]] });
    await h.render({ onMoveHandle: h.reshaped });
    const initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [22, 2]); await h.pointer('pointermove', [26, 3]);
    await act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await h.pointer('pointerup', [26, 3]);
    expect(h.session.getSnapshot()).toEqual(initial); expect(h.reshaped).not.toHaveBeenCalled();
    await h.pointer('pointerdown', [22, 2]); await h.pointer('pointermove', [26, 3]); await h.pointer('pointerup', [26, 3]);
    expect(h.reshaped).toHaveBeenCalledExactlyOnceWith('profile', { kind: 'vertex', index: 1 }, [3, 3]);
    expect(h.profile().geometry).toMatchObject({ points: [[0, 0], [25, 5], [20, 20], [0, 20]] });
    const point = container.querySelector<SVGCircleElement>('[aria-label="Point 2 of Profile"]');
    if (!point) throw new Error('Point grip missing.');
    await act(async () => point.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    expect(h.profile().geometry).toMatchObject({ points: [[0, 0], [30, 5], [20, 20], [0, 20]] });
    expect(h.translated).not.toHaveBeenCalled();
  });

  it('previews a snapped translation without editing, then commits one undoable move preserving dimensions and expressions', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]);
    expect(h.session.getSnapshot().workflowOpen).toBe(false);
    await h.pointer('pointermove', [8, 5]);
    expect(h.session.getSnapshot()).toMatchObject({ document: initial.document, version: initial.version, workflowOpen: true });
    expect(container.querySelector('[aria-label="Select Profile profile"]')?.getAttribute('transform')).toBe('translate(5 0)');
    expect(h.translated).not.toHaveBeenCalled();
    await h.pointer('pointerup', [8, 5]);
    expect(h.translated).toHaveBeenCalledExactlyOnceWith('profile', [5, 0]);
    expect(h.profile()).toMatchObject({ geometry: { ...rectangle, x: 5 }, constraints: [{ id: 'height', kind: 'dimension', quantity: 'height' }] });
    expect(h.session.getSnapshot()).toMatchObject({ canUndo: true, workflowOpen: false });
    await act(async () => h.session.undo());
    expect(h.session.getSnapshot().document).toEqual(initial.document);
    expect(h.session.getSnapshot().canUndo).toBe(false);
    expect(h.error).not.toHaveBeenCalled(); expect(h.added).not.toHaveBeenCalled();
  });

  it('keeps a stationary or sub-threshold click as selection without opening a workflow or creating history', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]);
    await h.pointer('pointermove', [4.1, 3]);
    await h.pointer('pointerup', [4.1, 3]); await h.click([4.1, 3]);
    expect(h.selected).toHaveBeenCalledExactlyOnceWith('profile');
    expect(h.pending).not.toHaveBeenCalledWith(true); expect(h.translated).not.toHaveBeenCalled();
    expect(h.session.getSnapshot()).toEqual(initial);
  });

  it('suppresses the click generated by a completed drag while keeping the next physical click selectable', async () => {
    const h = await harness();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]); await h.pointer('pointerup', [9, 3]); await h.click([9, 3]);
    expect(h.selected).not.toHaveBeenCalled();
    await h.pointer('pointerdown', [9, 3]); await h.pointer('pointerup', [9, 3]); await h.click([9, 3]);
    expect(h.selected).toHaveBeenCalledExactlyOnceWith('profile'); expect(h.translated).toHaveBeenCalledOnce();
  });

  it('uses unsnapped displacement when snapping is disabled', async () => {
    const h = await harness();
    const snap = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle grid snapping"]'); if (!snap) throw new Error('Snap toggle missing.');
    await act(async () => snap.click());
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9.2, 1.9]); await h.pointer('pointerup', [9.2, 1.9]);
    expect(h.translated).toHaveBeenCalledExactlyOnceWith('profile', [expect.closeTo(5.2, 12), expect.closeTo(-1.1, 12)]);
    expect(h.profile().geometry).toMatchObject({ x: expect.closeTo(5.2, 12), y: expect.closeTo(-1.1, 12), width: 'size', height: 10 });
  });

  it.each([
    { geometry: { kind: 'circle', x: 0, y: 0, radius: 5 }, start: [0, 0], end: [5, 0], expected: { kind: 'circle', x: 5, y: 0, radius: 5 } },
    { geometry: { kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]] }, start: [1, 1], end: [6, 1], expected: { kind: 'polygon', points: [[5, 0], [15, 0], [5, 10]] } },
    { geometry: { kind: 'path', segments: [{ kind: 'arc', center: [0, 0], radius: 5, startAngle: 37, sweep: -360 }] }, start: [0, 0], end: [5, 0], expected: { kind: 'path', segments: [{ kind: 'arc', center: [5, 0], radius: 5, startAngle: 37, sweep: -360 }] } }
  ] satisfies { geometry: CadProfile; start: readonly [number, number]; end: readonly [number, number]; expected: CadProfile }[])('moves the existing $geometry.kind contour without changing its shape', async ({ geometry, start, end, expected }) => {
    const h = await harness(geometry);
    await h.pointer('pointerdown', start); await h.pointer('pointermove', end);
    expect(container.querySelector('[aria-label="Select Profile profile"]')?.getAttribute('transform')).toBe('translate(5 0)');
    await h.pointer('pointerup', end);
    expect(h.profile().geometry).toEqual(expected); expect(h.translated).toHaveBeenCalledOnce(); expect(h.error).not.toHaveBeenCalled();
  });

  it('ends a grid-snapped zero-displacement gesture without creating an undo step', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [5, 3]);
    expect(h.session.getSnapshot().workflowOpen).toBe(true);
    await h.pointer('pointerup', [5, 3]); await h.click([5, 3]);
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial); expect(h.selected).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'pointercancel', 'lostpointercapture', 'blur', 'cancelSignal', 'locked', 'tool', 'selection'] as const)('cancels an active contour move on %s without committing', async reason => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]);
    expect(h.session.getSnapshot().workflowOpen).toBe(true);
    if (reason === 'Escape') await act(async () => h.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    else if (reason === 'blur') await act(async () => window.dispatchEvent(new Event('blur')));
    else if (reason === 'cancelSignal') await h.render({ cancelSignal: 1 });
    else if (reason === 'locked') await h.render({ interactionLocked: true });
    else if (reason === 'tool') await h.render({ tool: 'circle' });
    else if (reason === 'selection') await h.render({ selectedProfileId: null });
    else await h.pointer(reason, [9, 3]);
    await h.pointer('pointerup', [9, 3]);
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial);
    expect(container.querySelector('[aria-label="Select Profile profile"]')?.hasAttribute('transform')).toBe(false);
    expect(h.release).toHaveBeenCalledWith(11); expect(h.pending).toHaveBeenLastCalledWith(false);
  });

  it('cancels a stale accepted document and never overwrites the newer parameter update', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]);
    await act(async () => h.session.edit([{ kind: 'set-parameter', name: 'size', value: 30 }]));
    const newer = h.session.getSnapshot();
    await h.pointer('pointerup', [9, 3]);
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(newer);
    expect(h.profile().geometry).toEqual(rectangle); expect(newer.document.parameters.size).toBe(30);
    expect(newer.workflowOpen).toBe(false);
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toEqual(initial.document);
  });

  it('cancels when the accepted revision is replaced even if its immutable geometry object is reused', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]);
    await act(async () => h.session.replace(initial.document));
    const replacement = h.session.getSnapshot();
    expect(replacement.version).not.toBe(initial.version); expect(replacement.document).toBe(initial.document);
    await h.pointer('pointerup', [9, 3]);
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(replacement);
  });

  it('only the initiating pointer can move or release a contour', async () => {
    const h = await harness();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3], {}, 22);
    expect(h.pending).not.toHaveBeenCalledWith(true);
    await h.pointer('pointerup', [9, 3], {}, 22); expect(h.release).not.toHaveBeenCalled();
    await h.pointer('pointermove', [9, 3]);
    await h.pointer('lostpointercapture', [9, 3], {}, 22); expect(h.session.getSnapshot().workflowOpen).toBe(true);
    await h.pointer('pointerup', [9, 3]); expect(h.translated).toHaveBeenCalledExactlyOnceWith('profile', [5, 0]);
  });

  it('cancels when the initiating left button disappears before release', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]);
    await h.pointer('pointermove', [10, 3], { buttons: 0 }); await h.pointer('pointerup', [10, 3]);
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial);
  });

  it('releases pending ownership and pointer capture when the active canvas unmounts', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]);
    await act(async () => root.render(null));
    expect(h.release).toHaveBeenCalledWith(11); expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial);
  });

  it('keeps capture failure and locked or unselected contours from starting a move', async () => {
    const h = await harness();
    h.capture.mockImplementationOnce(() => { throw new DOMException('Pointer is no longer active', 'NotFoundError'); });
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]); await h.pointer('pointerup', [9, 3]);
    await h.render({ interactionLocked: true }); await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]); await h.pointer('pointerup', [9, 3]);
    await h.render({ interactionLocked: false, selectedProfileId: null }); await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]); await h.pointer('pointerup', [9, 3]);
    expect(h.capture).toHaveBeenCalledTimes(1); expect(h.pending).not.toHaveBeenCalledWith(true); expect(h.translated).not.toHaveBeenCalled(); expect(h.error).not.toHaveBeenCalled();
  });

  it('rejects a formula-driven position without replacing the binding or publishing a move', async () => {
    const h = await harness({ ...rectangle, x: 'size' }), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [24, 3]); await h.pointer('pointermove', [29, 3]); await h.pointer('pointerup', [29, 3]);
    expect(h.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('follows an expression'));
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial);
  });

  it('restores the accepted view and releases ownership when the guarded commit rejects', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    h.translated.mockImplementationOnce(() => { throw new Error('The contour would intersect another profile.'); });
    await h.pointer('pointerdown', [4, 3]); await h.pointer('pointermove', [9, 3]); await h.pointer('pointerup', [9, 3]);
    expect(h.error).toHaveBeenCalledExactlyOnceWith('The contour would intersect another profile.');
    expect(h.session.getSnapshot()).toEqual(initial);
    expect(container.querySelector('[aria-label="Select Profile profile"]')?.hasAttribute('transform')).toBe(false);
  });

  it('keeps generated plugin geometry controlled by its placement configuration', async () => {
    const h = await harness(createCadPluginProfile(CAD_STAR_PLUGIN)), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [0, 0]); await h.pointer('pointermove', [10, 0]); await h.pointer('pointerup', [10, 0]);
    expect(h.capture).not.toHaveBeenCalled(); expect(h.pending).not.toHaveBeenCalledWith(true); expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial);
  });

  it('retains stationary right-click menus and right-drag panning on the selected contour', async () => {
    const h = await harness(), initial = h.session.getSnapshot(), view = h.frame();
    await h.pointer('pointerdown', [4, 3], { button: 2, buttons: 2 }); await h.pointer('pointerup', [4, 3], { button: 2, buttons: 0 });
    expect(h.menu).toHaveBeenCalledOnce(); expect(h.menu.mock.calls[0][0]).toMatchObject({ profileId: 'profile', trigger: 'pointer' });
    await h.pointer('pointerdown', [4, 3], { button: 2, buttons: 2 }); await h.pointer('pointermove', [9, 3], { button: 2, buttons: 2 }); await h.pointer('pointerup', [9, 3], { button: 2, buttons: 0 });
    expect(h.frame()).not.toBe(view); expect(h.menu).toHaveBeenCalledOnce();
    expect(h.translated).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(initial);
  });

  it('drops a held stationary right-click owner when an identical document is reopened at another revision', async () => {
    const h = await harness(), initial = h.session.getSnapshot();
    await h.pointer('pointerdown', [4, 3], { button: 2, buttons: 2 });
    await act(async () => h.session.replace(initial.document));
    await h.pointer('pointerup', [4, 3], { button: 2, buttons: 0 });
    expect(h.menu).not.toHaveBeenCalled(); expect(h.translated).not.toHaveBeenCalled(); expect(h.release).toHaveBeenCalledWith(11);
  });
});
