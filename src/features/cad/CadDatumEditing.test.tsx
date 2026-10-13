import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDatumPlaneFeature, CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { cadFramePointToWorld, resolveCadWorldDatum } from '@/domain/cad/cadDatumPlanes';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';
import { cadPlacementOptions } from './cadPlacementUi';

vi.mock('./CadViewport', () => ({ CadViewport: () => <div aria-label="3D model viewport" /> }));
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
      dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo} onEdit={edit => session.edit([edit], state.version)}
      onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen} onSave={async () => undefined}
      onBack={vi.fn()} onNewDocument={vi.fn()} onOpenDocument={vi.fn()} onImportDocument={async () => undefined} onExportDocument={vi.fn()}
      onExportSolid={async () => undefined} onExportDxf={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />));
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
async function input(label: string, value: string) {
  const control = field(label).querySelector('input')!; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function choose(value: string) {
  await act(async () => { const control = field('Reference plane').querySelector('select')!; control.value = value; control.dispatchEvent(new Event('change', { bubbles: true })); });
}

describe('datum placement editing with shared Session history', () => {
  it('creates a datum only on Apply and uses the selected accepted plane for Sketch and Curve creation', async () => {
    await mount(createCadDocument()); const before = session.getSnapshot();
    await click('Plane'); await input('Origin Z', '25'); await click('Cancel');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: false });
    await click('Plane'); await input('Origin Z', '25'); await click('Apply');
    const accepted = session.getSnapshot().document.features[0]; expect(accepted).toMatchObject({ kind: 'datum-plane', definition: { origin: [0, 0, '25'] } });
    await click('Sketch'); expect(field('Reference plane').querySelector('select')?.value).toBe(`datum:${accepted.id}`);
    await click('Apply'); const created = session.getSnapshot().document.features[1]; expect(created).toMatchObject({ kind: 'sketch', plane: { kind: 'datum-plane', featureId: accepted.id } });
    await click('Finish sketch'); await click(accepted.name); await click('Curve');
    expect(field('Reference plane').querySelector('select')?.value).toBe(`datum:${accepted.id}`); await click('Cancel');
    expect(session.getSnapshot().document.features).toHaveLength(2); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Undo'); expect(session.getSnapshot().document.features).toEqual([accepted]); await click('Undo'); expect(session.getSnapshot().document.features).toEqual([]);
  });
  it('preserves expression drafts through fields, commits one frame edit and reverses it atomically', async () => {
    await mount(); await click('Mount'); const before = session.getSnapshot();
    await input('Origin X', 'lift * 3'); await input('Around X', 'tilt');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Sketch').disabled).toBe(true); await click('Apply');
    const accepted = session.getSnapshot().document.features[0]; expect(accepted).toMatchObject({ definition: { origin: ['lift * 3', 20, 30], rotation: ['tilt', 0, 0] } });
    expect(session.getSnapshot().document.features[1]).toEqual(before.document.features[1]); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); await click('Redo'); expect(session.getSnapshot().document.features[0]).toEqual(accepted);
    await input('Around Y', '1 / 0'); await click('Apply'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(session.getSnapshot().document.features[0]).toBe(accepted); await click('Cancel'); expect(session.getSnapshot().workflowOpen).toBe(false);
  });
  it('changes placement explicitly without rewriting imported local geometry/source and preserves Cancel', async () => {
    await mount(); await click('Outline'); const before = session.getSnapshot();
    expect(field('Reference plane').querySelector('select')?.value).toBe('datum:mount');
    await choose('XZ'); expect(session.getSnapshot().document).toBe(before.document); await click('Cancel');
    expect(field('Reference plane').querySelector('select')?.value).toBe('datum:mount');
    await choose('YZ'); await click('Apply'); expect(session.getSnapshot().document.features[1]).toEqual({ ...sketch, plane: 'YZ' });
    await click('Undo'); await click('Outline'); await click('Edit sketch');
    expect(container.querySelector('.cad-plane-label')?.textContent).toBe('Mount');
    const world = cadFramePointToWorld(resolveCadWorldDatum(datum, {}), 4, [2, 3]); expect(world[2]).not.toBe(4);
    expect(container.querySelector('.cad-profile circle')?.getAttribute('cx')).toBe('2');
  });
  it('keeps unavailable datum selected truthfully while allowing an explicit principal replacement', async () => {
    await mount({ ...createCadDocument(), parameters: { lift: 8 }, features: [{ ...datum, suppressed: true }, { ...sketch, suppressed: true }] }); await click('Outline');
    const control = field('Reference plane').querySelector('select')!;
    expect(control.selectedOptions[0].textContent).toBe('Mount (unavailable)'); expect(control.selectedOptions[0].disabled).toBe(true);
    await choose('XY'); await click('Apply'); expect(session.getSnapshot().document.features[1]).toMatchObject({ plane: 'XY', suppressed: true });
    const later = { ...datum, id: 'later', name: 'Later' };
    expect(cadPlacementOptions([datum, sketch, later], sketch.id, sketch.plane).some(option => option.value === 'datum:later')).toBe(false);
  });
});
