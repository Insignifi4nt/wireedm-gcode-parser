import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDatumPlaneFeature, CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { cadFramePointToWorld, resolveCadWorldDatum } from '@/domain/cad/cadDatumPlanes';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';
import { cadPlacementOptions } from './cadPlacementUi';

vi.mock('./CadViewport', () => ({ CadViewport: ({ hidden }: { hidden?: boolean }) => hidden ? <div className="cad-viewport" hidden /> : <div aria-label="3D model viewport" /> }));
const datum: CadDatumPlaneFeature = { id: 'mount', name: 'Mount', kind: 'datum-plane', suppressed: false,
  definition: { kind: 'world', basePlane: 'XY', origin: [10, 20, 30], rotation: [30, 0, 0] } };
const sketch: CadSketchFeature = { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: { kind: 'datum-plane', featureId: datum.id }, offset: 'lift / 2',
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 2, y: 3, radius: 1 } }],
  source: { format: 'dxf', fileName: 'Original.dxf', text: 'Exact original source', units: 'mm' } };
let root: Root; let container: HTMLDivElement; let session: CadSession;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(initial: CadDocument = { ...createCadDocument(), parameters: { lift: 8, tilt: 45 }, features: [datum, sketch] }) {
  session = new CadSession(initial);
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={state.document} documentVersion={state.version} buildVersion={null} build={null} buildState="idle"
      dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo} onEditMany={edits => { session.edit(edits); }} onEdit={edit => session.edit([edit], state.version)}
      onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen} onSave={async () => undefined}
      onBack={vi.fn()} onNewDocument={vi.fn()} onOpenDocument={vi.fn()} onImportDocument={async () => undefined} onExportDocument={vi.fn()}
      onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />));
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label
    || entry.classList.contains('cad-tree-row') && [...entry.querySelectorAll('span')].some(span => span.textContent === label));
  if (!result) throw new Error(`Missing button ${label}`); return result;
}
async function click(label: string) { await act(async () => button(label).click()); }
/** A history click only selects; double-click opens the feature editor. */
async function open(label: string) { await click(label); await act(async () => button(label).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); }
function field(label: string) {
  const result = [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.childNodes[0]?.textContent === label);
  if (!result) throw new Error(`Missing field ${label}`); return result;
}
async function input(label: string, value: string) {
  const control = field(label).querySelector('input')!; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function relation(label: string, value: string, keep = true) {
  await click(`Edit ${label} relation`);
  const control = document.querySelector<HTMLInputElement>(`input[aria-label="${label} expression"]`), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  if (!control) throw new Error('Missing expression field'); await act(async () => { setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
  if (keep) {
    const action = [...document.querySelectorAll('button')].find(entry => entry.textContent?.trim() === 'Keep relation'), close = document.querySelector<HTMLButtonElement>(`button[aria-label="Close ${label} relation help"]`);
    if (!action || !close) throw new Error('Missing relation actions'); await act(async () => action.click()); await act(async () => close.click());
  }
}
/** Right-click a history row and run one of its menu commands. */
async function menu(row: string, command: string) {
  await act(async () => button(`Select ${row} in history`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(entry => entry.textContent?.trim() === command);
  if (!item) throw new Error(`Missing menu command ${command}`); await act(async () => item.click());
}
async function escape() { await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); }

describe('datum placement editing with shared Session history', () => {
  it('creates a datum only on Apply and uses the selected accepted plane for Sketch and Curve creation', async () => {
    await mount(createCadDocument()); const before = session.getSnapshot();
    await click('Plane'); await input('Origin Z', '25'); await click('Cancel');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: false });
    await click('Plane'); await input('Origin Z', '25'); await click('Apply');
    const accepted = session.getSnapshot().document.features[0]; expect(accepted).toMatchObject({ kind: 'datum-plane', definition: { origin: [0, 0, 25] } });
    await click('Sketch');
    const created = session.getSnapshot().document.features[1]; expect(created).toMatchObject({ kind: 'sketch', plane: { kind: 'datum-plane', featureId: accepted.id } });
    expect(button('Finish sketch').disabled).toBe(false); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Finish sketch'); await click(accepted.name); await click('Curve');
    expect(field('Reference plane').querySelector('select')?.value).toBe(`datum:${accepted.id}`); await click('Cancel');
    expect(session.getSnapshot().document.features).toHaveLength(2); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Undo'); expect(session.getSnapshot().document.features).toEqual([accepted]); await click('Undo'); expect(session.getSnapshot().document.features).toEqual([]);
  });
  it('preserves expression drafts through fields, commits one frame edit and reverses it atomically', async () => {
    await mount(); await open('Mount'); const before = session.getSnapshot();
    await relation('Origin X', 'lift * 3'); await relation('Around X', 'tilt');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Sketch').disabled).toBe(true); await click('Apply');
    const accepted = session.getSnapshot().document.features[0]; expect(accepted).toMatchObject({ definition: { origin: ['lift * 3', 20, 30], rotation: ['tilt', 0, 0] } });
    expect(session.getSnapshot().document.features[1]).toEqual(before.document.features[1]); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); await click('Redo'); expect(session.getSnapshot().document.features[0]).toEqual(accepted);
    await open('Mount'); await relation('Around Y', '1 / 0', false); expect(document.querySelector('[role="alert"]')?.textContent).toContain('zero'); expect(button('Apply').disabled).toBe(true);
    expect(session.getSnapshot().document.features[0]).toBe(accepted);
    const close = document.querySelector<HTMLButtonElement>('button[aria-label="Close Around Y relation help"]'); if (!close) throw new Error('Missing relation close'); await act(async () => close.click());
    expect(session.getSnapshot().workflowOpen).toBe(false); expect(session.getSnapshot().document.features[0]).toBe(accepted);
  });
  it('changes the sketch plane by picking a plane without rewriting imported local geometry/source and preserves Escape', async () => {
    await mount(); await click('Expand Reference'); const before = session.getSnapshot();
    await menu('Outline', 'Change sketch plane'); await escape();
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: before.canUndo, workflowOpen: false });
    // The sketch now lies on the picked plane, so its former plane offset no longer applies.
    await menu('Outline', 'Change sketch plane'); await click('Select YZ plane'); expect(session.getSnapshot().document.features[1]).toEqual({ ...sketch, plane: 'YZ', offset: 0 });
    const accepted = session.getSnapshot().document;
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document);
    await click('Redo'); expect(session.getSnapshot().document).toEqual(accepted);
    await click('Undo'); await open('Outline');
    expect(container.querySelector('.cad-plane-label')?.textContent).toBe('Mount');
    const world = cadFramePointToWorld(resolveCadWorldDatum(datum, {}), 4, [2, 3]);
    expect(world).toEqual([12, expect.closeTo(20.598076211353316, 10), expect.closeTo(34.96410161513775, 10)]);
    const circle = container.querySelector('.cad-profile circle'), canvas = container.querySelector('.cad-sketch-canvas');
    if (!circle || !canvas) throw new Error('Missing visible datum Sketch circle');
    expect(circle.getAttribute('cx')).toBe('0'); expect(circle.getAttribute('cy')).toBe('0'); expect(circle.getAttribute('r')).toBe('1');
    expect(circle.parentElement?.getAttribute('transform')).toBe('translate(0,0)');
    const [left, top, width, height] = canvas.getAttribute('viewBox')!.split(' ').map(Number);
    expect(left).toBeLessThanOrEqual(-1); expect(left + width).toBeGreaterThanOrEqual(1);
    expect(top).toBeLessThanOrEqual(-1); expect(top + height).toBeGreaterThanOrEqual(1);
    expect(session.getSnapshot()).toMatchObject({ document: before.document, workflowOpen: false, canUndo: before.canUndo, canRedo: true });
    expect(session.getSnapshot().document.features[1]).toEqual(sketch);
  });
  it('rejects an unavailable datum as the new plane while allowing an explicit principal replacement', async () => {
    await mount({ ...createCadDocument(), parameters: { lift: 8 }, features: [{ ...datum, suppressed: true }, { ...sketch, suppressed: true }] }); await click('Expand Reference');
    await menu('Outline', 'Change sketch plane'); await click('Mount'); expect(session.getSnapshot().document.features[1]).toMatchObject({ plane: { kind: 'datum-plane', featureId: 'mount' } });
    await click('Select XY plane'); expect(session.getSnapshot().document.features[1]).toMatchObject({ plane: 'XY', suppressed: true });
    const later = { ...datum, id: 'later', name: 'Later' };
    expect(cadPlacementOptions({ features: [datum, sketch, later], parameters: {} }, sketch.id, sketch.plane).some(option => option.value === 'datum:later')).toBe(false);
  });
});
