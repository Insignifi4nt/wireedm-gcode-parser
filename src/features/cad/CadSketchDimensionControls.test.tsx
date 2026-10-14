import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadProfile, CadSketchProfile } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CAD_GEAR_V2_PLUGIN, createCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { CadSession } from './cadSession';
import { CadSketchDimensionControls } from './CadSketchDimensionControls';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function makeDocument(geometry: CadProfile, parameters: Readonly<Record<string, number>> = {}, constraints?: CadSketchProfile['constraints']): CadDocument {
  return { ...createCadDocument(), parameters, features: [{ id: 'sketch', name: 'Part section', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'profile', name: 'Part', construction: false, geometry, ...(constraints ? { constraints } : {}) }] }] };
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  if (!button) throw new Error(`Missing ${label}`); await act(async () => button.click());
}
async function input(label: string, value: string) {
  const element = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); if (!element) throw new Error(`Missing ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set; if (!setter) throw new Error('Missing native setter');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function renderControls(document: CadDocument) {
  const session = new CadSession(document), pending = vi.fn(), inspect = vi.fn(), configure = vi.fn();
  const edit = vi.fn((edits: readonly CadEdit[]) => session.edit(edits));
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = state.document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Missing test sketch');
    return <CadSketchDimensionControls document={state.document} sketch={sketch} profile={sketch.profiles[0]} parameters={state.document.parameters} anchor={{ x: 200, y: 150 }} onEditMany={edit} onPendingChange={pending} interactionLocked={false} cancelSignal={0} onInspectInput={inspect} onConfigure={configure} />;
  }
  await act(async () => root.render(<Harness />)); return { session, pending, inspect, configure, edit };
}
function currentGeometry(session: CadSession) { const sketch = session.getSnapshot().document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Missing sketch'); return sketch.profiles[0].geometry; }
describe('on-part sketch dimension editing', () => {
  it.each(['width', 'diameter', 'angle'] as const)('displays a supported tiny %s without zeroing its signed value or changing an unchanged edit', async quantity => {
    const magnitude = 4e-7, parameters: Readonly<Record<string, number>> = quantity === 'width' ? { size: magnitude } : {};
    const geometry: CadProfile = quantity === 'width' ? { kind: 'rectangle', x: 0, y: 0, width: ' size ', height: 20, cornerRadius: 0 }
      : quantity === 'diameter' ? { kind: 'circle', x: 0, y: 0, radius: magnitude / 2 }
        : { kind: 'slot', x: 0, y: 0, width: 8, length: 20, angle: -magnitude };
    const { session, edit } = await renderControls(makeDocument(geometry, parameters, [{ id: 'tiny', kind: 'dimension', quantity }]));
    const before = session.getSnapshot(), label = quantity[0].toUpperCase() + quantity.slice(1), value = quantity === 'angle' ? -magnitude : magnitude;
    expect(container.querySelector(`[aria-label="Edit ${label}"] strong`)?.textContent).toBe(String(value));
    await click(`Edit ${label}`); expect(container.querySelector<HTMLInputElement>(`input[aria-label="${label} value"]`)?.value).toBe(String(value));
    await click('Apply'); expect(session.getSnapshot()).toBe(before); expect(edit).not.toHaveBeenCalled();
    await click(`Edit ${label}`); await click('Cancel'); expect(session.getSnapshot()).toBe(before);
  });

  it('keeps numeric mouse geometry free until a driving dimension is explicitly added', async () => {
    const { session } = await renderControls(makeDocument({ kind: 'rectangle', x: 10, y: 20, width: 30, height: 15, cornerRadius: 0 }));
    const before = session.getSnapshot();
    expect(container.querySelector('button[aria-label="Edit Width"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Edit Height"]')).toBeNull();
    await act(async () => session.edit([{ kind: 'add-sketch-dimension', sketchId: 'sketch', profileId: 'profile', constraint: { id: 'width', kind: 'dimension', quantity: 'width' } }]));
    expect(container.querySelector('button[aria-label="Edit Width"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Edit Height"]')).toBeNull();
    expect(currentGeometry(session)).toEqual(before.document.features[0].kind === 'sketch' && before.document.features[0].profiles[0].geometry);
  });
  it.each(['literal', 'numeric text', 'parameter'] as const)('preserves full-precision %s radius and history when an unchanged diameter is applied', async source => {
    const radius = 1 / 3;
    const storedRadius = source === 'parameter' ? 'shaftRadius' : source === 'numeric text' ? String(radius) : radius;
    const { session, edit } = await renderControls(makeDocument({ kind: 'circle', x: 0, y: 0, radius: storedRadius }, source === 'parameter' ? { shaftRadius: radius } : {}, [{ id: 'diameter', kind: 'dimension', quantity: 'diameter' }]));
    const before = session.getSnapshot();
    await click('Edit Diameter');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Diameter value"]')?.value).toBe(String(radius * 2));
    await click('Apply');
    expect(session.getSnapshot()).toBe(before);
    expect(currentGeometry(session)).toEqual({ kind: 'circle', x: 0, y: 0, radius: storedRadius });
    expect(edit).not.toHaveBeenCalled();
  });
  it('edits a linked circle diameter through its radius parameter without detaching it', async () => {
    const { session, edit, pending } = await renderControls(makeDocument({ kind: 'circle', x: 0, y: 0, radius: 'shaftRadius' }, { shaftRadius: 3 }));
    expect(container.querySelector('button[aria-label="Edit Diameter"]')?.textContent).toContain('6');
    await click('Edit Diameter'); expect(pending).toHaveBeenLastCalledWith(true);
    await input('Diameter value', '10'); await click('Apply');
    expect(session.getSnapshot().document.parameters.shaftRadius).toBe(5); const geometry = currentGeometry(session); expect(geometry.kind === 'circle' && geometry.radius).toBe('shaftRadius');
    expect(edit).toHaveBeenCalledWith([{ kind: 'set-parameter', name: 'shaftRadius', value: 5 }]); expect(container.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => session.undo()); expect(session.getSnapshot().document.parameters.shaftRadius).toBe(3);
  });
  it('updates a literal rectangle dimension without changing its other coordinates or dimensions', async () => {
    const { session } = await renderControls(makeDocument({ kind: 'rectangle', x: 10, y: 20, width: 30, height: 15, cornerRadius: 2 }, {}, [{ id: 'height', kind: 'dimension', quantity: 'height' }]));
    await click('Edit Height'); await input('Height value', '22'); await click('Apply');
    expect(currentGeometry(session)).toEqual({ kind: 'rectangle', x: 10, y: 20, width: 30, height: 22, cornerRadius: 2 });
  });
  it('keeps compound bindings read-only and links to their configuration', async () => {
    const { session, configure, edit } = await renderControls(makeDocument({ kind: 'slot', x: 0, y: 0, length: 'width * 3', width: 'width', angle: 30 }, { width: 4 }));
    const before = session.getSnapshot().document; await click('Edit Length');
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain('width * 3'); expect(container.querySelector('input')).toBeNull();
    await click('Profile configuration'); expect(configure).toHaveBeenCalledWith('length'); expect(edit).not.toHaveBeenCalled(); expect(session.getSnapshot().document).toBe(before);
  });
  it('blocks invalid slot proportions while keeping the draft available for correction', async () => {
    const { session, edit } = await renderControls(makeDocument({ kind: 'slot', x: 0, y: 0, length: 20, width: 8, angle: 15 }, {}, [{ id: 'length', kind: 'dimension', quantity: 'length' }]));
    const before = session.getSnapshot().document; await click('Edit Length'); await input('Length value', '6');
    expect(container.querySelector('[role="alert"]')).not.toBeNull(); await click('Apply'); expect(edit).not.toHaveBeenCalled(); expect(session.getSnapshot().document).toBe(before);
    await input('Length value', '30'); await click('Apply'); expect(currentGeometry(session)).toEqual({ kind: 'slot', x: 0, y: 0, length: 30, width: 8, angle: 15 });
  });
  it('updates gear tooth aliases with the same correlated geometry guards as the profile editor', async () => {
    const gear = createCadPluginProfile(CAD_GEAR_V2_PLUGIN); gear.inputs.teeth = 'toothCount'; gear.inputs.module = 'gearModule';
    const { session, edit } = await renderControls(makeDocument(gear, { toothCount: 18, gearModule: 3 }));
    await click('Edit Teeth'); await input('Teeth value', '12.5'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('integer'); await click('Apply'); expect(edit).not.toHaveBeenCalled();
    await input('Teeth value', '12'); await click('Apply'); expect(session.getSnapshot().document.parameters.toothCount).toBe(12);
    const geometry = currentGeometry(session); expect(geometry.kind === 'plugin' && geometry.inputs.teeth).toBe('toothCount');
    await click('Edit Module'); await input('Module value', '4'); await click('Apply'); expect(session.getSnapshot().document.parameters.gearModule).toBe(4);
  });
  it('rejects stale drafts and cancels on Escape without overwriting newer values', async () => {
    const { session, edit, pending } = await renderControls(makeDocument({ kind: 'circle', x: 0, y: 0, radius: 'radius' }, { radius: 3 }));
    const chip = container.querySelector<HTMLButtonElement>('button[aria-label="Edit Diameter"]'); if (!chip) throw new Error('Missing diameter chip');
    await act(async () => { chip.focus(); chip.click(); }); await input('Diameter value', '12');
    await act(async () => session.edit([{ kind: 'set-parameter', name: 'radius', value: 4 }]));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('part changed'); await click('Apply'); expect(edit).not.toHaveBeenCalled();
    const form = container.querySelector('form'); if (!form) throw new Error('Missing dimension editor');
    await act(async () => form.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('form')).toBeNull(); expect(document.activeElement).toBe(chip); expect(pending).toHaveBeenLastCalledWith(false); expect(session.getSnapshot().document.parameters.radius).toBe(4);
  });
});
