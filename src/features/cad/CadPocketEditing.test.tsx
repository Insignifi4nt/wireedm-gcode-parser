import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature, CadPlane, CadPocketFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { cadVisibleBodyIds, createCadDocument } from '@/domain/cad/cadSchema';
import { CadWorkbench } from './CadWorkbench';
import { CadSession } from './cadSession';

vi.mock('./CadViewport', () => ({ CadViewport: () => <div aria-label="3D model viewport" /> }));
let root: Root; let container: HTMLDivElement; let session: CadSession;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const bore = (plane: CadPlane = 'XY'): CadSketchFeature => ({ id: 'profile', name: 'Bore', kind: 'sketch', plane, offset: 0, suppressed: false,
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } }],
  source: { format: 'dxf', fileName: 'bore.dxf', text: 'Original exact DXF source', units: 'mm' } });
const stockSketch: CadSketchFeature = { id: 'stock_profile', name: 'Stock profile', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
  profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: -5, y: -5, width: 10, height: 10, cornerRadius: 0 } }] };
const stock: CadFeature = { id: 'stock', name: 'Stock', kind: 'extrude', suppressed: false, sketchId: 'stock_profile', distance: 10, symmetric: true, operation: 'new', targetId: null };
const distanceCut: CadFeature = { id: 'cut', name: 'Bore cut', kind: 'extrude', suppressed: false, sketchId: 'profile', distance: '-depth / 2', symmetric: false, operation: 'cut', targetId: 'stock' };
const pocket: CadPocketFeature = { id: 'cut', name: 'Bore cut', kind: 'pocket', suppressed: false, sketchId: 'profile', targetId: 'stock', extent: { kind: 'through-all', direction: 'positive' } };
function part(feature: CadFeature = distanceCut, plane: CadPlane = 'XY'): CadDocument {
  return { ...createCadDocument('Pocket editing'), parameters: { depth: 12 }, features: [stockSketch, stock, bore(plane), feature] };
}
async function mount(initial = part()) {
  session = new CadSession(initial); const snapshot = session.getSnapshot();
  session.markSaved({ document: snapshot.document, savedVersion: 'saved-original', updatedAt: '2026-10-13T12:00:00.000Z' }, snapshot.version);
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const meshes = cadVisibleBodyIds(state.document.features).map(featureId => ({ featureId, name: featureId, positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 100,
      bounds: { min: [-5, -5, -5] as const, max: [5, 5, 5] as const } }));
    return <CadWorkbench document={state.document} documentVersion={state.version} buildVersion={state.version} buildState="ready" build={{ buildId: state.version, meshes, diagnostics: [], durationMs: 0 }}
      dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo} onEditMany={edits => { session.edit(edits); }} onEdit={edit => { session.assertWorkflowClosed('editor'); session.edit([edit], state.version); }}
      onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen} onBack={vi.fn()} onSave={async () => undefined}
      onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined} onExportDocument={vi.fn()} onExportSolid={async () => undefined}
      onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />)); await click('Bore cut');
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label
    || entry.classList.contains('cad-tree-row') && [...entry.querySelectorAll('span')].some(span => span.textContent === label));
  if (!result) throw new Error(`Missing button ${label}`); return result;
}
async function click(label: string) { await act(async () => button(label).click()); }
function field(label: string) {
  const result = [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.childNodes[0]?.textContent === label);
  if (!result) throw new Error(`Missing field ${label}`); return result;
}
function select(label: string) { const result = field(label).querySelector('select'); if (!result) throw new Error(`Missing select ${label}`); return result; }
async function choose(label: string, value: string) { await act(async () => { const control = select(label); control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); }); }
function input(label: string) { const result = field(label).querySelector('input'); if (!result) throw new Error(`Missing input ${label}`); return result; }
async function type(label: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { const control = input(label); setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function relation(label: string, value: string) {
  await click(`Edit ${label} relation`);
  const control = document.querySelector<HTMLInputElement>(`input[aria-label="${label} expression"]`), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  if (!control) throw new Error(`Missing ${label} expression`);
  await act(async () => { setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
  const keep = [...document.querySelectorAll('button')].find(entry => entry.textContent?.trim() === 'Keep relation'); if (!keep) throw new Error('Missing Keep relation');
  await act(async () => keep.click());
  const close = document.querySelector<HTMLButtonElement>(`button[aria-label="Close ${label} relation help"]`); if (!close) throw new Error('Missing relation close');
  await act(async () => close.click());
}
function accepted() { const feature = session.getSnapshot().document.features.find(entry => entry.id === 'cut'); if (!feature) throw new Error('Cut missing'); return feature; }

describe('shared Session distance / Through-all editing', () => {
  it('keeps same-ID extent conversion local, then commits one exact step with no inactive fields and reversible saved state', async () => {
    await mount(); const before = session.getSnapshot();
    // The final build only contains Cut; its preceding Stock is still the correct editable target.
    expect(select('Target body').value).toBe('stock'); expect(select('Target body').selectedOptions[0].disabled).toBe(false);
    await relation('Length', '-depth * 2'); await choose('Extent', 'through-all'); await choose('Direction', 'both'); await choose('Extent', 'distance');
    expect(input('Length').value).toBe('-24'); expect(container.querySelector<HTMLInputElement>('.cad-check input')?.checked).toBe(false);
    await choose('Extent', 'through-all'); expect(select('Direction').value).toBe('negative');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, dirty: false, canUndo: false, workflowOpen: true });
    await click('Apply'); const after = session.getSnapshot();
    expect(accepted()).toEqual({ ...pocket, extent: { kind: 'through-all', direction: 'negative' } }); expect(accepted()).not.toHaveProperty('distance'); expect(accepted()).not.toHaveProperty('symmetric'); expect(accepted()).not.toHaveProperty('operation');
    expect(after.document.features.slice(0, -1)).toEqual(before.document.features.slice(0, -1)); expect(after).toMatchObject({ dirty: true, canUndo: true, canRedo: false, workflowOpen: false });
    expect(after.version).not.toBe(before.version); await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot()).toMatchObject({ dirty: false, canUndo: false, canRedo: true, workflowOpen: false });
    expect(select('Extent').value).toBe('distance'); expect(input('Length').value).toBe('-6');
    await click('Redo'); expect(session.getSnapshot().document).toEqual(after.document); expect(select('Extent').value).toBe('through-all');
    await choose('Extent', 'distance'); await click('Apply'); expect(accepted()).toEqual({ ...distanceCut, distance: -10 }); expect(accepted()).not.toHaveProperty('extent');
  });

  it('cancels depth and extent drafts together, keeps native text undo, and never changes accepted history', async () => {
    await mount(); const before = session.getSnapshot(); await relation('Length', '-depth * 2');
    expect(button('Undo').disabled).toBe(true); expect(button('Save').disabled).toBe(true); expect(button('Stock').disabled).toBe(true);
    const nativeUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }); await act(async () => input('Length').dispatchEvent(nativeUndo));
    expect(nativeUndo.defaultPrevented).toBe(false); expect(session.getSnapshot().version).toBe(before.version);
    await choose('Extent', 'through-all'); await choose('Direction', 'both'); await choose('Extent', 'distance'); expect(input('Length').value).toBe('-24');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }); await act(async () => input('Length').dispatchEvent(escape));
    expect(escape.defaultPrevented).toBe(true); expect(session.getSnapshot()).toEqual(before); expect(input('Length').value).toBe('-6'); expect(select('Extent').value).toBe('distance');
    await choose('Extent', 'through-all'); await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });

  it('uses the staged shared depth when converting direction and keeps its exact relation through dormant distance edits', async () => {
    await mount(part({ ...distanceCut, distance: ' depth ' })); const before = session.getSnapshot();
    expect(input('Length').value).toBe('12'); await type('Length', '-24');
    await choose('Extent', 'through-all'); expect(select('Direction').value).toBe('negative');
    await choose('Direction', 'positive'); await choose('Extent', 'distance'); expect(input('Length').value).toBe('-24');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    await click('Apply'); expect(accepted()).toEqual({ ...distanceCut, distance: ' depth ' }); expect(session.getSnapshot().document.parameters).toEqual({ depth: -24 });
    expect(session.getSnapshot().canUndo).toBe(true); await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it.each([['XZ', '−Y from sketch', '+Y from sketch'], ['YZ', '+X from sketch', '−X from sketch']] as const)('uses current %s direction when a saved Pocket first converts to distance', async (plane, positive, negative) => {
    await mount(part(pocket, plane)); const before = session.getSnapshot();
    expect(select('Direction').options[0].textContent).toBe(positive); expect(select('Direction').options[1].textContent).toBe(negative);
    await choose('Direction', 'negative'); await choose('Extent', 'distance'); expect(input('Length').value).toBe('-10');
    await click('Apply'); expect(accepted()).toMatchObject({ id: 'cut', kind: 'extrude', distance: -10, symmetric: false, operation: 'cut', targetId: 'stock' });
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); expect(select('Direction').value).toBe('positive');
    await choose('Direction', 'both'); await choose('Extent', 'distance'); expect(input('Length').value).toBe('10'); expect(container.querySelector<HTMLInputElement>('.cad-check input')?.checked).toBe(true);
  });

  it('retains an invalid numeric draft across extent switching and permits a valid Through-all conversion without persisting the inactive error', async () => {
    await mount(part({ ...distanceCut, distance: 6 })); const before = session.getSnapshot(); await type('Length', '-');
    expect(input('Length').getAttribute('aria-invalid')).toBe('true'); expect(input('Length').value).toBe('-'); expect(button('Apply').disabled).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, dirty: false, canUndo: false, workflowOpen: true });
    await choose('Extent', 'through-all'); expect(button('Apply').disabled).toBe(false);
    await choose('Extent', 'distance'); expect(input('Length').value).toBe('-'); expect(button('Apply').disabled).toBe(true);
    await choose('Extent', 'through-all'); await click('Apply'); expect(accepted()).toEqual(pocket); expect(session.getSnapshot().workflowOpen).toBe(false);
    await choose('Extent', 'distance'); expect(input('Length').value).toBe('10'); await click('Cancel'); expect(accepted()).toEqual(pocket);
  });

  it('shows unavailable saved sources without substituting a visible successor until the user chooses it', async () => {
    const replacement = { ...bore(), id: 'replacement', name: 'Repair profile' };
    const otherStock: CadFeature = { ...stock, id: 'other_stock', name: 'Repair stock' };
    await mount({ ...part({ ...pocket, suppressed: true }), features: [stockSketch, { ...stock, suppressed: true }, otherStock, { ...bore(), suppressed: true }, replacement, { ...pocket, suppressed: true }] });
    const before = session.getSnapshot();
    for (const [label, reason] of [['Profile sketch', 'suppressed'], ['Target body', 'unavailable']]) { expect(select(label).selectedOptions[0].disabled).toBe(true); expect(select(label).selectedOptions[0].textContent).toContain(`(${reason})`); }
    expect(select('Target body').value).toBe('stock'); expect(select('Profile sketch').value).toBe('profile');
    await choose('Target body', 'other_stock'); await choose('Profile sketch', 'replacement'); expect(accepted()).toEqual(before.document.features.at(-1)); await click('Apply');
    expect(accepted()).toMatchObject({ kind: 'pocket', suppressed: true, targetId: 'other_stock', sketchId: 'replacement' }); await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document);
  });

  it('resets safely after an accepted same-ID replacement rather than rendering an incompatible stale extent draft', async () => {
    await mount(part(pocket));
    const replacement: CadFeature = { id: 'cut', name: 'Moved stock', kind: 'transform', suppressed: false, sourceId: 'stock', translation: [0, 0, 2], rotation: [0, 0, 0] };
    await act(async () => { session.assertWorkflowClosed(); session.edit([{ kind: 'update-feature', feature: replacement }]); });
    expect(accepted()).toEqual(replacement); expect(button('Moved stock').textContent).toBe('Moved stock'); expect(input('Z').value).toBe('2'); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Undo'); expect(accepted()).toEqual(pocket); expect(select('Extent').value).toBe('through-all');
  });
});
