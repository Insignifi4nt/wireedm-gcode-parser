import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { inspectCadExtrudeDepth, type CadExtrudeDepthControl, type CadExtrudeDepthState } from './cadExtrudeDepthInteraction';
import { createCadExtrudeDepthHandle } from './cadExtrudeDepthHandle';

function part(distance: number | string = ' depth ', symmetric = false, x = 30): CadDocument {
  return { ...createCadDocument('Depth handle', 'depth_handle'), parameters: { depth: 10 }, features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x, y: 10, width: 20, height: 10, cornerRadius: 0 } }
    ] }, { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance, symmetric, operation: 'new', targetId: null }
  ] };
}
function control(document = part()) {
  let current = document, state: CadExtrudeDepthState | null = null, token: string | null = null, start = document;
  const listeners = new Set<() => void>();
  const publish = () => { const feature = current.features.find(feature => feature.id === 'pad'); if (!feature) throw new Error('Missing Pad'); const model = inspectCadExtrudeDepth(current, feature); state = model ? { model, definitionKey: JSON.stringify(current.parameters), gestureActive: token !== null, capability: model.capability } : null; listeners.forEach(listener => listener()); };
  publish();
  const change = vi.fn((value: number) => { current = { ...current, parameters: { ...current.parameters, depth: value } }; publish(); return true; });
  const value: CadExtrudeDepthControl = { owner: 'editor', featureId: 'pad', baseVersion: 'accepted', subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getState: () => state,
    begin(key) { if (key !== state?.definitionKey || state.capability.kind !== 'editable' || token) return null; start = current; token = 'gesture'; publish(); return token; },
    setQuantity(key, quantity) { return key === token && token !== null ? change(quantity) : false; },
    release(key) { if (key !== token || token === null) return false; token = null; publish(); return true; },
    cancel(key) { if (key !== token || token === null) return false; current = start; token = null; publish(); return true; } };
  return { value, change, lose: () => { token = null; state = null; listeners.forEach(listener => listener()); }, listeners };
}
function cameraAt(target = new THREE.Vector3(40, 15, 10), endOn = false) {
  const camera = new THREE.OrthographicCamera(-200 / 3, 200 / 3, 50, -50, .01, 10000);
  camera.up.set(0, 0, 1); if (endOn) camera.up.set(0, 1, 0);
  camera.position.copy(target).add(endOn ? new THREE.Vector3(0, 0, 200) : new THREE.Vector3(0, -200, 0));
  camera.lookAt(target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); return camera;
}
function pointFor(camera: THREE.OrthographicCamera, world: THREE.Vector3) { const p = world.clone().project(camera); return { x: (p.x + 1) * 400, y: (1 - p.y) * 300 }; }
function rayFor(camera: THREE.OrthographicCamera, world: THREE.Vector3) {
  const p = world.clone().project(camera), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(p.x, p.y), camera); return ray.ray;
}

it.each([[19.844262327110005, '19.844262'], [-19.844262327110005, '-19.844262'], [10, '10'],
  [1e-7, '1e-7'], [-1e-7, '-1e-7'], [1e-9, '1e-9'], [-1e-9, '-1e-9'],
  [1.23456789012345e-9, '1.23457e-9'], [-1.23456789012345e-9, '-1.23457e-9']] as const)(
  'displays compact CAD precision for Length %s while keeping the exact quantity, endpoint and named expression', (quantity, text) => {
    const document = { ...part(), parameters: { depth: quantity } }, original = JSON.stringify(document), h = control(document);
    const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
    try {
      handle.setView(cameraAt(new THREE.Vector3(40, 15, quantity)), 800, 600); handle.update(h.value);
      expect(handle.getState()?.label).toBe(`Length ${text} mm`);
      expect(handle.getState()?.quantityMm).toBe(quantity); expect(handle.getState()?.endpointMm[2]).toBe(quantity);
      expect(h.value.getState()?.model.binding).toEqual({ kind: 'parameter', name: 'depth', quantity });
      expect(h.change).not.toHaveBeenCalled(); expect(JSON.stringify(document)).toBe(original);
      expect(document.features[1]).toMatchObject({ distance: ' depth ' });
    } finally { handle.dispose(); }
  }
);

it.each([4e-7, -4e-7])('displays accepted nonzero Length %s faithfully below the normal six-decimal display step', quantity => {
  const document = parseCadDocument({ ...part(), parameters: { depth: quantity } }), original = JSON.stringify(document), h = control(document);
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  try {
    handle.setView(cameraAt(new THREE.Vector3(40, 15, quantity)), 800, 600); handle.update(h.value);
    expect(handle.getState()?.label).toBe(`Length ${quantity} mm`);
    expect(handle.getState()?.quantityMm).toBe(quantity); expect(handle.getState()?.endpointMm[2]).toBe(quantity);
    expect(h.value.getState()?.model.binding).toEqual({ kind: 'parameter', name: 'depth', quantity });
    expect(h.change).not.toHaveBeenCalled(); expect(JSON.stringify(document)).toBe(original);
  } finally { handle.dispose(); }
});

it('keeps idle and hovered Length arrows distinct against both dark canvas and selected cyan material without changing body colors', () => {
  const h = control(), handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  const luminance = (hex: number) => [16, 8, 0].reduce((sum, shift, index) => {
    const channel = ((hex >> shift) & 255) / 255;
    return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
  }, 0);
  const contrast = (a: number, b: number) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  try {
    handle.setView(cameraAt(), 800, 600); handle.update(h.value);
    const head = handle.group.children[0]; if (!(head instanceof THREE.Mesh) || !(head.material instanceof THREE.MeshBasicMaterial)) throw new Error('Missing Length arrow material');
    const material = head.material, idle = material.color.getHex();
    for (const background of [0x18252e, 0x79c8e6]) expect(contrast(idle, background)).toBeGreaterThanOrEqual(2.5);
    handle.hover(handle.getState()?.screenPoint ?? null); const hovered = material.color.getHex(); expect(hovered).not.toBe(idle);
    for (const background of [0x18252e, 0x79c8e6]) expect(contrast(hovered, background)).toBeGreaterThanOrEqual(2.5);
    handle.hover(null); expect(material.color.getHex()).toBe(idle); expect(head.material).toBe(material);
    expect(h.change).not.toHaveBeenCalled(); expect(handle.getState()?.quantityMm).toBe(10);
  } finally { handle.dispose(); }
});

it('uses actual material placement and a real camera ray to change linked depth without a jump or accepted mutation', () => {
  const source = part(), before = JSON.stringify(source), h = control(source), camera = cameraAt(), render = vi.fn(), interaction = vi.fn();
  const handle = createCadExtrudeDepthHandle({ requestRender: render, onInteractionChange: interaction });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value);
    const tip = new THREE.Vector3(40, 15, 10), start = pointFor(camera, tip);
    expect(handle.getState()?.endpointMm).toEqual([40, 15, 10]); expect(handle.hitTest(start)).toBe(true);
    expect(handle.begin(7, rayFor(camera, tip), start)).toBe(true); expect(interaction).toHaveBeenLastCalledWith(true);
    expect(handle.move(7, rayFor(camera, tip))).toBe(true); expect(h.change).not.toHaveBeenCalled();
    expect(handle.move(7, rayFor(camera, new THREE.Vector3(40, 15, 20)))).toBe(true);
    expect(h.change).toHaveBeenLastCalledWith(expect.closeTo(20, 12)); expect(handle.getState()?.endpointMm[2]).toBeCloseTo(20, 12);
    expect(handle.release(7)).toBe(true); expect(interaction).toHaveBeenLastCalledWith(false);
    expect(JSON.stringify(source)).toBe(before); expect(render).toHaveBeenCalled();
  } finally { handle.dispose(); }
});

it.each([[false, -10, -15, -15], [true, -10, -10, -20], [true, 10, 10, 20]] as const)('preserves signed total depth for symmetric=%s, initial=%s', (symmetric, initial, capZ, expected) => {
  const document = { ...part(' depth ', symmetric), parameters: { depth: initial } }, h = control(document);
  const camera = cameraAt(new THREE.Vector3(40, 15, initial * (symmetric ? .5 : 1)));
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value);
    const start = new THREE.Vector3(40, 15, initial * (symmetric ? .5 : 1));
    expect(handle.begin(1, rayFor(camera, start), pointFor(camera, start))).toBe(true);
    expect(handle.move(1, rayFor(camera, new THREE.Vector3(40, 15, capZ)))).toBe(true);
    expect(h.change).toHaveBeenLastCalledWith(expect.closeTo(expected, 12));
    expect(handle.getState()?.endpointMm[2]).toBeCloseTo(capZ, 12);
    handle.release(1);
  } finally { handle.dispose(); }
});

it('keeps far coordinates out of uploaded geometry and retains the same screen-size target through zoom', () => {
  const h = control(part(' depth ', false, 100_000_000)), tip = new THREE.Vector3(100_000_010, 15, 10), camera = cameraAt(tip);
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value);
    expect(handle.getState()?.endpointMm).toEqual([100_000_010, 15, 10]);
    const target = handle.getState()?.screenPoint; if (!target) throw new Error('Missing visible target');
    expect(handle.hitTest({ x: target.x + 13, y: target.y })).toBe(true);
    expect(handle.hitTest({ x: target.x + 15, y: target.y })).toBe(false);
    const head = handle.group.children[0]; if (!(head instanceof THREE.Mesh)) throw new Error('Missing arrow');
    const arrowScreenHeight = () => {
      const a = pointFor(camera, head.localToWorld(new THREE.Vector3(0, -7, 0))), b = pointFor(camera, head.localToWorld(new THREE.Vector3(0, 7, 0)));
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    expect(arrowScreenHeight()).toBeCloseTo(14, 10);
    for (const object of handle.group.children) {
      if (!(object instanceof THREE.Mesh)) throw new Error('Missing uploaded geometry');
      for (const value of object.geometry.getAttribute('position').array) expect(Math.abs(value)).toBeLessThanOrEqual(14);
    }
    camera.zoom = 5; camera.updateProjectionMatrix(); handle.setView(camera, 800, 600);
    expect(arrowScreenHeight()).toBeCloseTo(14, 10); expect(handle.hitTest({ x: target.x + 13, y: target.y })).toBe(true);
    expect(handle.begin(4, rayFor(camera, tip), pointFor(camera, tip))).toBe(true);
    handle.move(4, rayFor(camera, tip.clone().add(new THREE.Vector3(0, 0, 3))));
    expect(h.change).toHaveBeenLastCalledWith(expect.closeTo(13, 9));
  } finally { handle.dispose(); }
});

it('freezes a source-size-coupled anchor while dragging and refreshes the current material midpoint after release', () => {
  const document = part(), source = document.features[0]; if (source.kind !== 'sketch') throw new Error('Missing source');
  const candidate = { ...document, features: [{ ...source, profiles: [{ ...source.profiles[0], geometry: { kind: 'rectangle', x: 30, y: 10, width: 'depth', height: 10, cornerRadius: 0 } }] }, document.features[1]] } satisfies CadDocument;
  const h = control(candidate), tip = new THREE.Vector3(35, 15, 10), camera = cameraAt(tip), handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value); expect(handle.getState()?.endpointMm).toEqual([35, 15, 10]);
    expect(handle.begin(1, rayFor(camera, tip), pointFor(camera, tip))).toBe(true);
    handle.move(1, rayFor(camera, tip.clone().add(new THREE.Vector3(0, 0, 10))));
    expect(h.value.getState()?.model.materialBoundsMm.maxX).toBeCloseTo(50, 12);
    expect(handle.getState()?.endpointMm).toEqual([35, 15, 20]);
    handle.release(1); expect(handle.getState()?.endpointMm).toEqual([40, 15, 20]);
  } finally { handle.dispose(); }
});

it('restores the starting provisional depth on cancel, owner/settings exit and view change, ignoring foreign or late pointers', () => {
  const h = control(), tip = new THREE.Vector3(40, 15, 10), camera = cameraAt(tip), interaction = vi.fn();
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange: interaction });
  const begin = () => handle.begin(2, rayFor(camera, tip), pointFor(camera, tip));
  const drag = () => handle.move(2, rayFor(camera, tip.clone().add(new THREE.Vector3(0, 0, 10))));
  try {
    handle.setView(camera, 800, 600); handle.update(h.value); expect(begin()).toBe(true); drag();
    expect(handle.release(99)).toBe(false); expect(handle.getState()?.active).toBe(true);
    expect(handle.cancel()).toBe(true); expect(h.value.getState()?.model.quantityMm).toBe(10);
    expect(handle.move(2, rayFor(camera, tip))).toBe(false); expect(handle.release(2)).toBe(false);
    expect(begin()).toBe(true); drag(); handle.update(null);
    expect(h.value.getState()?.model.quantityMm).toBe(10); expect(h.listeners.size).toBe(0); expect(handle.getState()).toBeNull();
    handle.update(h.value); expect(begin()).toBe(true); drag();
    camera.zoom = 2; camera.updateProjectionMatrix(); handle.setView(camera, 800, 600);
    expect(h.value.getState()?.model.quantityMm).toBe(10); expect(camera.zoom).toBe(2);
    expect(interaction.mock.calls.map(([active]) => active)).toEqual([true, false, true, false, true, false]);
  } finally { handle.dispose(); }
});

it('invalidates a lost editor token and disposes every owned GPU resource exactly once without retaining subscriptions', () => {
  const h = control(), tip = new THREE.Vector3(40, 15, 10), camera = cameraAt(tip), interaction = vi.fn();
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange: interaction });
  handle.setView(camera, 800, 600); handle.update(h.value);
  const objects = handle.group.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  const resources = [...objects.map(object => object.geometry), ...new Set(objects.map(object => object.material))];
  const disposals = resources.map(resource => { if (Array.isArray(resource)) throw new Error('Unexpected material array'); return vi.spyOn(resource, 'dispose'); });
  expect(handle.begin(2, rayFor(camera, tip), pointFor(camera, tip))).toBe(true); h.lose();
  expect(handle.getState()).toBeNull(); expect(handle.move(2, rayFor(camera, tip))).toBe(false); expect(interaction).toHaveBeenLastCalledWith(false);
  handle.dispose(); handle.dispose();
  expect(h.listeners.size).toBe(0); expect(handle.group.children).toEqual([]);
  for (const disposal of disposals) expect(disposal).toHaveBeenCalledTimes(1);
});

it('drags along a far cardinal datum normal rather than global Z and keeps its rotated source anchor', () => {
  const document = part(), sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Missing sketch');
  const datum = { id: 'datum', name: 'Far datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY',
    origin: [500_000, -500_000, 100], rotation: [0, 90, 0] } } satisfies CadDocument['features'][number];
  const h = control({ ...document, features: [datum, { ...sketch, plane: { kind: 'datum-plane', featureId: 'datum' } }, document.features[1]] });
  const tip = new THREE.Vector3(500_010, -499_985, 60), camera = cameraAt(tip), handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value); expect(handle.getState()?.endpointMm).toEqual([500_010, -499_985, 60]);
    expect(handle.begin(5, rayFor(camera, tip), pointFor(camera, tip))).toBe(true);
    handle.move(5, rayFor(camera, tip.clone().add(new THREE.Vector3(3, 0, 0))));
    expect(h.change).toHaveBeenLastCalledWith(expect.closeTo(13, 8));
    expect(handle.getState()?.endpointMm).toEqual([500_013, -499_985, 60]);
  } finally { handle.dispose(); }
});

it('does not schedule an idle render loop when the viewport republishes an unchanged camera or control', () => {
  const h = control(), camera = cameraAt(), render = vi.fn(), handle = createCadExtrudeDepthHandle({ requestRender: render, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value); render.mockClear();
    expect(handle.setView(camera, 800, 600)).toBe(false); expect(handle.update(h.value)).toBe(false); expect(render).not.toHaveBeenCalled();
    expect(handle.hover(handle.getState()?.screenPoint ?? null)).toBe(true); expect(render).toHaveBeenCalledTimes(1);
  } finally { handle.dispose(); }
});

it('does not publish helper renders for camera updates while no depth control or visual exists', () => {
  const camera = cameraAt(), render = vi.fn(), handle = createCadExtrudeDepthHandle({ requestRender: render, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(null); render.mockClear();
    for (let i = 0; i < 4; i++) {
      camera.position.x += 1; camera.lookAt(40, 15, 10); camera.updateMatrixWorld(true);
      handle.setView(camera, 800, 600); handle.update(null);
      expect(handle.getState()).toBeNull(); expect(handle.group.visible).toBe(false); expect(render).not.toHaveBeenCalled();
    }
    handle.update(control().value); expect(handle.getState()?.visible).toBe(true); expect(render).toHaveBeenCalledTimes(1);
    handle.update(null); expect(handle.getState()).toBeNull(); expect(handle.group.visible).toBe(false); expect(render).toHaveBeenCalledTimes(2);
    camera.position.x += 1; handle.setView(camera, 800, 600); expect(render).toHaveBeenCalledTimes(2);
  } finally { handle.dispose(); }
});

it('synchronizes visible camera geometry without a duplicate helper publication, while owned hover and quantity still publish', () => {
  const h = control(), camera = cameraAt(), render = vi.fn(), handle = createCadExtrudeDepthHandle({ requestRender: render, onInteractionChange() {} });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value); render.mockClear();
    const before = handle.getState()!.screenPoint;
    camera.position.x += 10; camera.updateMatrixWorld(true); handle.setView(camera, 800, 600);
    const moved = handle.getState()!.screenPoint;
    expect(Math.hypot(moved.x - before.x, moved.y - before.y)).toBeGreaterThan(1); expect(render).not.toHaveBeenCalled();
    const point = handle.getState()!.screenPoint; handle.hover(point); expect(render).toHaveBeenCalledTimes(1);
    const tip = new THREE.Vector3(40, 15, 10); expect(handle.begin(1, rayFor(camera, tip), point)).toBe(true);
    render.mockClear(); handle.move(1, rayFor(camera, tip.clone().add(new THREE.Vector3(0, 0, 3))));
    expect(handle.getState()?.quantityMm).toBeCloseTo(13, 10); expect(render).toHaveBeenCalled();
  } finally { handle.dispose(); }
});

it('locks idle input without changing its exact visual, then updates real model and owner loss instead of freezing stale geometry', () => {
  const h = control(), render = vi.fn(); let blocked = false;
  const ownedControl: CadExtrudeDepthControl = { ...h.value, getState() {
    const current = h.value.getState();
    return current && blocked ? { ...current, capability: { kind: 'locked', reason: 'Operation in progress' } } : current;
  } };
  const handle = createCadExtrudeDepthHandle({ requestRender: render, onInteractionChange() {} });
  try {
    const camera = cameraAt(), tip = new THREE.Vector3(40, 15, 10);
    handle.setView(camera, 800, 600); handle.update(ownedControl); const original = handle.getState(); render.mockClear();
    blocked = true; handle.update(ownedControl, true); h.listeners.forEach(listener => listener());
    expect(handle.getState()).toEqual(original); expect(render).not.toHaveBeenCalled();
    expect(handle.hover(original!.screenPoint)).toBe(false); expect(handle.begin(1, rayFor(camera, tip), original!.screenPoint)).toBe(false);
    expect(handle.move(1, rayFor(camera, tip.clone().add(new THREE.Vector3(0, 0, 10))))).toBe(false); expect(h.change).not.toHaveBeenCalled();
    blocked = false; handle.update(ownedControl); expect(handle.getState()).toEqual(original); expect(render).not.toHaveBeenCalled();
    blocked = true; handle.update(ownedControl, true); h.change(20);
    expect(handle.getState()?.quantityMm).toBe(20); expect(handle.getState()?.endpointMm[2]).toBe(20); expect(render).toHaveBeenCalled();
    h.lose(); expect(handle.getState()).toBeNull(); expect(handle.group.visible).toBe(false);
  } finally { handle.dispose(); }
});

it('exposes a contextual end-on or formula lock without starting a gesture or amplifying a ray', () => {
  const h = control(), tip = new THREE.Vector3(40, 15, 10), camera = cameraAt(tip, true), interactions = vi.fn();
  const handle = createCadExtrudeDepthHandle({ requestRender() {}, onInteractionChange: interactions });
  try {
    handle.setView(camera, 800, 600); handle.update(h.value);
    expect(handle.getState()?.capability).toMatchObject({ kind: 'locked', reason: expect.stringContaining('Rotate') });
    expect(handle.begin(1, rayFor(camera, tip), pointFor(camera, tip))).toBe(false); expect(h.change).not.toHaveBeenCalled();
    const formula = control(part('depth / 2')); handle.update(formula.value);
    expect(handle.getState()?.capability).toMatchObject({ kind: 'locked', reason: expect.stringContaining('formula') });
    expect(interactions).not.toHaveBeenCalled();
  } finally { handle.dispose(); }
});
