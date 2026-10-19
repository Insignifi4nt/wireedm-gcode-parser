import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadSketchPlane } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';
import type { CadWorkbenchViewportControls } from './cadViewportControls';

let planePick: ((plane: CadSketchPlane) => void) | undefined;
let featurePick: ((id: string | null) => void) | undefined;
vi.mock('./CadViewport', () => ({ CadViewport: ({ hidden = false, references = [], onSelectPlane, onSelect }: {
  hidden?: boolean;
  references?: readonly { featureKind: string; name: string; plane?: CadSketchPlane }[];
  onSelectPlane?(plane: CadSketchPlane): void;
  onSelect(id: string | null): void;
}) => {
  if (hidden) return <div className="cad-viewport" hidden />;
  planePick = onSelectPlane; featurePick = onSelect;
  return <div aria-label="3D model viewport">{references.filter(reference => reference.plane).map(reference => <button key={reference.name}
    aria-label={`Select ${reference.name} in design area`} onClick={() => onSelectPlane?.(reference.plane!)}>{reference.name}</button>)}</div>;
} }));

let root: Root, container: HTMLDivElement, session: CadSession, controls: CadWorkbenchViewportControls | null;
const workflow = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  controls = null; planePick = undefined; container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(initial = createCadDocument()) {
  session = new CadSession(initial);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} build={null} buildState="idle" buildVersion={null}
      dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEdit={edit => session.edit([edit])} onEditMany={edits => session.edit(edits)}
      onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={open => { workflow(open); session.setWorkflowOpen(open); }}
      onBack={vi.fn()} onSendToCam={async () => undefined} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()}
      onImportDocument={async () => undefined} onExportDocument={vi.fn()} onExportSolid={async () => undefined} onViewportControlsReady={value => { controls = value; }} />;
  }
  await act(async () => root.render(<Harness />));
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  if (!found) throw new Error(`Missing ${label}`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
function state() { if (!controls) throw new Error('Missing viewport controls'); return controls.getState(); }
const datum: CadDocument['features'][number] = { kind: 'datum-plane', id: 'mount', name: 'Mount plane', suppressed: false,
  definition: { kind: 'world', basePlane: 'XZ', origin: [3, 4, 5], rotation: [20, 0, 0] } };

describe('Sketch reference-plane workflow', () => {
  it.each(['XY', 'XZ', 'YZ'] as const)('requests a design-area plane and creates one editable sketch on %s without a form or fallback', async plane => {
    await mount(); const before = session.getSnapshot();
    expect(container.querySelector('.cad-toolbar button')?.textContent?.trim()).toBe('Sketch');
    expect([...container.querySelectorAll('button')].some(button => button.textContent?.trim() === 'Create sketch')).toBe(false);
    await click('Sketch');
    expect(state()).toMatchObject({ awaitingSketchPlane: true, workflowOpen: true });
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().canUndo).toBe(false);
    expect(container.querySelector('[aria-label="Feature properties"]')).toBeNull();
    const duplicatePick = planePick;
    await act(async () => { button(`Select ${plane} plane in design area`).click(); duplicatePick?.(plane); });
    const after = session.getSnapshot();
    expect(after.document.features).toHaveLength(1);
    expect(after.document.features[0]).toMatchObject({ kind: 'sketch', plane, offset: 0, profiles: [] });
    expect(state()).toMatchObject({ awaitingSketchPlane: false, sketchId: after.document.features[0].id, workflowOpen: false });
    expect(button('Finish sketch').disabled).toBe(false); expect(container.querySelector('[aria-label="Sketch drawing canvas"]')).not.toBeNull();
    await act(async () => session.undo()); expect(session.getSnapshot().document.features).toHaveLength(0);
  });
  it.each(['XY', 'XZ', 'YZ'] as const)('selects a %s tree plane without editing and starts there directly', async plane => {
    await mount(); const before = session.getSnapshot(); await click('Expand Reference'); await click(`Select ${plane} plane`);
    expect(session.getSnapshot()).toEqual(before); expect(state()).toMatchObject({ selectedReferencePlane: plane, workflowOpen: false });
    await click('Sketch'); expect(session.getSnapshot().document.features[0]).toMatchObject({ kind: 'sketch', plane });
    expect(state()).toMatchObject({ awaitingSketchPlane: false, sketchId: session.getSnapshot().document.features[0].id });
  });
  it('clears a selected plane by clicking blank design space without editing and asks for a plane again', async () => {
    await mount(); const before = session.getSnapshot();
    await act(async () => controls?.apply({ kind: 'select-reference-plane', plane: 'XZ' }));
    expect(state()).toMatchObject({ selectedReferencePlane: 'XZ', selectedFeatureId: null, awaitingSketchPlane: false });
    await act(async () => featurePick?.(null)); expect(state()).toMatchObject({ selectedReferencePlane: null, workflowOpen: false });
    expect(session.getSnapshot()).toEqual(before);
    await click('Sketch'); expect(state()).toMatchObject({ awaitingSketchPlane: true }); expect(session.getSnapshot().document).toBe(before.document);
  });
  it('uses a selected active datum and never creates from a suppressed datum', async () => {
    await mount({ ...createCadDocument(), features: [datum] }); await click('Select Mount plane in history'); const before = session.getSnapshot();
    expect(state()).toMatchObject({ selectedReferencePlane: { kind: 'datum-plane', featureId: 'mount' } });
    await click('Sketch'); expect(session.getSnapshot().document.features[1]).toMatchObject({ kind: 'sketch', plane: { kind: 'datum-plane', featureId: 'mount' } });
    await act(async () => session.replace({ ...before.document, features: [{ ...datum, suppressed: true }] }));
    await click('Sketch'); expect(state()).toMatchObject({ selectedReferencePlane: null, awaitingSketchPlane: true });
    await act(async () => planePick?.({ kind: 'datum-plane', featureId: 'mount' }));
    expect(session.getSnapshot().document.features).toHaveLength(1);
  });
  it('cancels a plane request with Escape, ignores its stale callback and releases workflow guards', async () => {
    await mount(); await click('Sketch'); const stalePick = planePick;
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(state()).toMatchObject({ awaitingSketchPlane: false, workflowOpen: false });
    await act(async () => stalePick?.('XZ')); expect(session.getSnapshot().document.features).toHaveLength(0);
    await click('Sketch'); await click('Cancel plane selection'); expect(state().workflowOpen).toBe(false);
    expect(button('Sketch').disabled).toBe(false);
  });
  it('invalidates pending picks on document replacement rather than inserting into the replacement', async () => {
    await mount(); await click('Sketch'); const stalePick = planePick;
    await act(async () => session.replace(createCadDocument('Replacement')));
    await act(async () => stalePick?.('YZ'));
    expect(state()).toMatchObject({ awaitingSketchPlane: false, workflowOpen: false }); expect(session.getSnapshot().document.features).toHaveLength(0);
  });
  it('keeps a plane request authoritative over tree renaming, profile actions, parameters and the part name while leaving reference picks available', async () => {
    const outline = { kind: 'sketch' as const, id: 'outline', name: 'Outline', plane: 'XY' as const, offset: 0, suppressed: false,
      profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 2 } }] };
    await mount({ ...createCadDocument(), parameters: { wall: 2 }, features: [datum, outline] });
    await click('Expand Reference'); await click('Expand Parameters'); await click('Expand Outline'); await click('Sketch');
    const before = session.getSnapshot(); const row = button('Select Outline in history');
    await act(async () => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 100 })); });
    expect(state()).toMatchObject({ awaitingSketchPlane: true, workflowOpen: true });
    expect(container.querySelector('[role="menu"]')).toBeNull(); expect(container.querySelector('[aria-label="Feature name"]')).toBeNull();
    for (const label of ['Circle profile', 'Edit parameter wall', 'Create sketch on XY plane']) {
      expect(button(label).disabled, label).toBe(true); await click(label);
    }
    expect(container.querySelector<HTMLButtonElement>('.cad-tree-document')?.disabled).toBe(true);
    expect(session.getSnapshot()).toEqual(before);
    expect(button('Select XY plane').disabled).toBe(false); expect(button('Select Mount plane in history').disabled).toBe(false);
    await click('Select Mount plane in history'); expect(session.getSnapshot().document.features).toHaveLength(3);
    expect(session.getSnapshot().document.features[2]).toMatchObject({ kind: 'sketch', plane: { kind: 'datum-plane', featureId: 'mount' } });
    expect(state()).toMatchObject({ awaitingSketchPlane: false, workflowOpen: false });
  });
});
