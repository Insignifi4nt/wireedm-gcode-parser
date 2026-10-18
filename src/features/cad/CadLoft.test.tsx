import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDatumPlaneFeature, CadDocument, CadFeature, CadMesh, CadPlane, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import * as loftDomain from '@/domain/cad/cadLoft';
import { cadFeatureProducesBody, createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadWorkbench } from './CadWorkbench';
import { initialCadLoftSketchIds, inspectCadLoftCandidates } from './cadLoftUi';
import { CadSession } from './cadSession';

vi.mock('./CadViewport', () => ({ CadViewport: ({ hidden }: { hidden?: boolean }) => hidden ? <div className="cad-viewport" hidden /> : <div aria-label="3D model viewport" /> }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function sketch(id: string, offset: CadScalar, plane: CadPlane = 'XY'): CadSketchFeature {
  return { id, name: id, kind: 'sketch', suppressed: false, plane, offset, profiles: [
    { id: `${id}-profile`, name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 10 } }
  ] };
}
function sectionDocument(sections: readonly CadSketchFeature[] = [sketch('Base', 0), sketch('Middle', 'height / 2'), sketch('Top', 'height')], body = false): CadDocument {
  const pad: CadFeature = { id: 'pad', name: 'Pad 1', kind: 'extrude', suppressed: false, sketchId: sections[0].id, distance: 5, symmetric: false, operation: 'new', targetId: null };
  return parseCadDocument({ ...createCadDocument('Sections'), parameters: { height: 20 }, features: body ? [sections[0], pad, ...sections.slice(1)] : sections });
}
async function mount(initial = sectionDocument()) {
  const session = new CadSession(initial);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const meshes: CadMesh[] = snapshot.document.features.filter(cadFeatureProducesBody).map(feature => ({ featureId: feature.id, name: feature.name,
      positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 100, bounds: { min: [-10, -10, 0], max: [10, 10, 20] } }));
    return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} buildVersion={snapshot.version} buildState="ready"
      build={{ buildId: snapshot.version, meshes, durationMs: 0, diagnostics: [] }} dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
      onEditMany={edits => { session.edit(edits); }} onEdit={edit => session.edit([edit], snapshot.version)} onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen}
      onBack={vi.fn()} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined}
      onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />)); return session;
}
function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button ${label} missing`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
/** A history click only selects; double-click on the selected row opens its editor. */
async function openSelected() { await act(async () => { container.querySelector('.cad-tree-row[aria-pressed="true"]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); }
function select(label: string): HTMLSelectElement {
  const found = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`) ?? [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.childNodes[0]?.textContent === label)?.querySelector('select');
  if (!found) throw new Error(`Select ${label} missing`); return found;
}
async function choose(label: string, value: string) { await act(async () => { const field = select(label); field.value = value; field.dispatchEvent(new Event('change', { bubbles: true })); }); }
function loft(feature: CadFeature | undefined) { if (feature?.kind !== 'loft') throw new Error('Loft missing'); return feature; }
const ids = () => [...container.querySelectorAll<HTMLSelectElement>('.cad-loft-section-row select')].map(field => field.value);

describe('common-frame Loft section authoring', () => {
  const basePlane: CadDatumPlaneFeature = { id: 'mount', name: 'Mount', kind: 'datum-plane', suppressed: false,
    definition: { kind: 'world', basePlane: 'XY', origin: [10, 20, 30], rotation: [90, 0, 0] } };
  const upperPlane: CadDatumPlaneFeature = { ...basePlane, id: 'upper', name: 'Upper support', definition: { ...basePlane.definition, origin: [15, 0, 30] } };
  const twisted: CadDatumPlaneFeature = { ...basePlane, id: 'twisted', name: 'Twisted support', definition: { ...basePlane.definition, rotation: [90, 10, 0] } };
  const onPlane = (id: string, featureId: string, offset: CadScalar = 0): CadSketchFeature => ({ ...sketch(id, offset), plane: { kind: 'datum-plane', featureId },
    source: { format: 'dxf', fileName: `${id}.dxf`, text: 'Exact authored source', units: 'mm' } });
  function documentWithFrames() {
    return parseCadDocument({ ...createCadDocument('Mount transition'), features: [basePlane, upperPlane, twisted,
      onPlane('Base', 'mount'), onPlane('Top', 'upper'), onPlane('Twisted', 'twisted')] });
  }
  it('defaults to compatible authored history and displays actual normal stations instead of isolated zero offsets', async () => {
    const initial = documentWithFrames();
    expect(initialCadLoftSketchIds(inspectCadLoftCandidates(initial))).toEqual(['Base', 'Top']);
    const session = await mount(initial); const before = session.getSnapshot(); await click('Loft');
    expect(ids()).toEqual(['Base', 'Top']);
    const rows = [...container.querySelectorAll('.cad-loft-section-metadata')];
    expect(rows[0].textContent).toBe('Mount · station 0 mm'); expect(rows[1].textContent).toBe('Upper support · station 20 mm');
    expect(rows[1].getAttribute('aria-description')).toContain('Authored offset: 0 mm'); expect(rows[1].getAttribute('aria-description')).toContain('5, 0 mm');
    expect(select('Section 2').querySelector<HTMLOptionElement>('option[value="Twisted"]')?.disabled).toBe(true);
    expect(select('Section 2').querySelector('option[value="Twisted"]')?.textContent).toContain('Incompatible frame');
    await click('Apply'); expect(loft(session.getSnapshot().document.features.at(-1)).sketchIds).toEqual(['Base', 'Top']);
    expect(session.getSnapshot().document.features.slice(0, before.document.features.length)).toEqual(before.document.features);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
    await act(async () => session.redo()); expect(loft(session.getSnapshot().document.features.at(-1)).sketchIds).toEqual(['Base', 'Top']);
  });
  it('uses the first placed section as station zero for tilted frames and retains invalid drafts for explicit correction', async () => {
    const tilted = { ...basePlane, definition: { ...basePlane.definition, rotation: [30, 0, 0] as const } };
    const initial = parseCadDocument({ ...createCadDocument(), parameters: { height: 20 }, features: [tilted,
      onPlane('Base', 'mount', 7), onPlane('Middle', 'mount', '7 + height / 2'), onPlane('Top', 'mount', '7 + height')] });
    const session = await mount(initial); const before = session.getSnapshot(); await click('Loft'); await click('Add section');
    expect([...container.querySelectorAll('.cad-loft-section-metadata')].map(row => row.textContent)).toEqual(['Mount · station 0 mm', 'Mount · station 10 mm', 'Mount · station 20 mm']);
    await click('Move section 3 up'); expect(ids()).toEqual(['Base', 'Top', 'Middle']);
    expect(container.querySelectorAll('.cad-loft-section-metadata')).toHaveLength(0);
    await click('Apply'); const message = container.querySelector('[role="alert"]')?.textContent ?? '';
    expect(message).toContain('increase or decrease strictly'); expect(container.textContent?.split(message).length).toBe(2);
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version);
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });
  it('preserves a now-incompatible selected section after changing the first frame and shows no fabricated station', async () => {
    const session = await mount(documentWithFrames()); const before = session.getSnapshot(); await click('Loft'); await choose('Section 1', 'Twisted');
    expect(ids()).toEqual(['Twisted', 'Top']); expect(select('Section 2').selectedOptions[0].textContent).toBe('Top — Incompatible frame');
    expect(select('Section 2').getAttribute('aria-invalid')).toBe('true'); expect(container.querySelectorAll('.cad-loft-section-metadata')).toHaveLength(0);
    await click('Apply'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version);
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });
});

describe('ordered loft section authoring', () => {
  it('uses history order, preserves an eligible selected section and never sorts offsets', () => {
    const document = sectionDocument([sketch('Base', 20), sketch('Middle', 0), sketch('Top', 10)]);
    const candidates = inspectCadLoftCandidates(document);
    expect(initialCadLoftSketchIds(candidates)).toEqual(['Base', 'Middle']);
    expect(initialCadLoftSketchIds(candidates, 'Top')).toEqual(['Middle', 'Top']);
  });
  it('creates smooth/new defaults and resolved plane metadata without editing its sketches', async () => {
    const session = await mount(); const before = session.getSnapshot(); await click('Loft');
    expect(ids()).toEqual(['Base', 'Middle']); expect(select('Transition').value).toBe('smooth'); expect(select('Operation').value).toBe('new');
    expect(container.querySelectorAll('.cad-loft-section-metadata')[1]?.textContent).toBe('XY · 10 mm');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Sketch').disabled).toBe(true); expect(button('Undo').disabled).toBe(true);
    await click('Apply'); expect(loft(session.getSnapshot().document.features.at(-1))).toMatchObject({ sketchIds: ['Base', 'Middle'], ruled: false, operation: 'new', targetId: null });
    expect(session.getSnapshot().document.features.slice(0, 3)).toEqual(before.document.features); expect(session.getSnapshot().workflowOpen).toBe(false);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
  });
  it('adds, moves and removes explicit sections while retaining keyboard focus and rejecting a folded order atomically', async () => {
    const session = await mount(); const before = session.getSnapshot(); await click('Loft'); await click('Add section');
    expect(ids()).toEqual(['Base', 'Middle', 'Top']); expect(document.activeElement).toBe(select('Section 3'));
    await click('Move section 3 up'); expect(ids()).toEqual(['Base', 'Top', 'Middle']); expect(document.activeElement).toBe(select('Section 2'));
    await click('Apply'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('increase or decrease strictly');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version); expect(session.getSnapshot().canUndo).toBe(false);
    await click('Move section 2 down'); await click('Remove section 2'); expect(ids()).toEqual(['Base', 'Top']); expect(document.activeElement).toBe(select('Section 2'));
    expect(button('Remove section 1').disabled).toBe(true); expect(button('Remove section 2').disabled).toBe(true);
    await click('Apply'); expect(loft(session.getSnapshot().document.features.at(-1)).sketchIds).toEqual(['Base', 'Top']);
  });
  it('replaces a section without duplicate choices, focuses the replacement and supports ruled Join/Cut with an explicit target', async () => {
    const session = await mount(sectionDocument(undefined, true)); await click('Loft');
    expect(select('Section 2').querySelector<HTMLOptionElement>('option[value="Base"]')?.disabled).toBe(true);
    await choose('Section 2', 'Base'); expect(ids()).toEqual(['Base', 'Middle']);
    await choose('Section 2', 'Top'); expect(ids()).toEqual(['Base', 'Top']); expect(document.activeElement).toBe(select('Section 2'));
    await choose('Transition', 'ruled'); await choose('Operation', 'join'); expect(select('Target body').value).toBe('pad');
    await click('Apply'); const before = session.getSnapshot(); expect(loft(before.document.features.at(-1))).toMatchObject({ ruled: true, operation: 'join', targetId: 'pad' }); await openSelected();
    expect(select('Target body').value).toBe('pad'); expect(select('Target body').querySelector('option[value="pad"]')).not.toBeNull();
    await choose('Operation', 'cut'); await click('Apply'); expect(loft(session.getSnapshot().document.features.at(-1)).operation).toBe('cut');
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
  });
  it('excludes holes, suppressed and construction-only sections using the shared analytic eligibility checks', async () => {
    const hole = sketch('Hole', 30); const original = hole.profiles[0];
    const holeSketch = { ...hole, profiles: [...hole.profiles, { ...original, id: 'inner', geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } satisfies CadSketchFeature['profiles'][number]['geometry'] }] };
    const guide = sketch('Guide', 40); const suppressed = { ...sketch('Suppressed', 50), suppressed: true };
    await mount(sectionDocument([sketch('Base', 0), sketch('Top', 20), holeSketch, { ...guide, profiles: guide.profiles.map(profile => ({ ...profile, construction: true })) }, suppressed]));
    await click('Loft'); const field = select('Section 2');
    for (const id of ['Hole', 'Guide', 'Suppressed']) expect(field.querySelector<HTMLOptionElement>(`option[value="${id}"]`)?.disabled).toBe(true);
    expect(field.querySelector('option[value="Hole"]')?.textContent).toContain('without holes'); expect(ids()).toEqual(['Base', 'Top']);
  });
  it('keeps candidates cached through transition and ordering changes', async () => {
    const inspect = vi.spyOn(loftDomain, 'inspectCadLoftSketch'); await mount(); await click('Loft'); const calls = inspect.mock.calls.length;
    await choose('Transition', 'ruled'); await click('Add section'); await click('Move section 3 up');
    expect(inspect.mock.calls).toHaveLength(calls);
  });
  it('treats an authored sketch ID named add as a section when restoring focus', async () => {
    await mount(sectionDocument([sketch('Base', 0), sketch('Middle', 10), sketch('add', 20)])); await click('Loft'); await click('Add section');
    expect(select('Section 3').value).toBe('add'); expect(document.activeElement).toBe(select('Section 3'));
    await click('Remove section 2'); expect(document.activeElement).toBe(select('Section 2')); expect(select('Section 2').value).toBe('add');
  });
  it('cancels from a verified collapsed section select while preserving open-picker Escape, native undo and IME', async () => {
    vi.stubGlobal('CSS', { supports: () => true }); const session = await mount(); const before = session.getSnapshot();
    await click('Loft'); await click('Move section 1 down'); const field = select('Section 2'); expect(document.activeElement).toBe(field);
    const matches = vi.spyOn(field, 'matches').mockReturnValue(true);
    const opened = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(opened)); expect(opened.defaultPrevented).toBe(false); expect(session.getSnapshot().workflowOpen).toBe(true);
    const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(undo)); expect(undo.defaultPrevented).toBe(false);
    matches.mockReturnValue(false);
    const composing = new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(composing)); expect(composing.defaultPrevented).toBe(false); expect(ids()).toEqual(['Middle', 'Base']);
    const collapsed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(collapsed)); expect(collapsed.defaultPrevented).toBe(true);
    expect(session.getSnapshot()).toEqual(before); expect(container.querySelector('.cad-loft-sections')).toBeNull();
  });
  it('retains a select-focused draft when native popup state cannot be verified', async () => {
    vi.stubGlobal('CSS', { supports: () => false }); const session = await mount(); const before = session.getSnapshot();
    await click('Loft'); await click('Move section 1 down'); const field = select('Section 2');
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => field.dispatchEvent(escape)); expect(escape.defaultPrevented).toBe(false); expect(ids()).toEqual(['Middle', 'Base']);
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version); expect(session.getSnapshot().workflowOpen).toBe(true);
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });
  it('rejects mixed planes and cancelling leaves the exact document, version and history intact', async () => {
    const session = await mount(sectionDocument([sketch('Base', 0), sketch('Top', 20), sketch('Side', 40, 'XZ')])); const before = session.getSnapshot();
    await click('Loft'); await choose('Section 1', 'Side'); expect(select('Section 2').getAttribute('aria-invalid')).toBe('true');
    await click('Apply'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('same principal sketch plane');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version); expect(session.getSnapshot().canUndo).toBe(false);
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before); expect(container.querySelector('.cad-loft-sections')).toBeNull();
  });
  it('bounds the list at sixteen and omits forward references when editing an existing loft', async () => {
    const sections = Array.from({ length: 17 }, (_, index) => ({ ...sketch(`s${index}`, index * 10), name: `Sketch ${index}` })); await mount(sectionDocument(sections)); await click('Loft');
    for (let count = 2; count < 16; count++) await click('Add section');
    expect(ids()).toHaveLength(16); expect(new Set(ids()).size).toBe(16); expect(button('Add section').disabled).toBe(true);
    await click('Cancel');
    const initial = parseCadDocument({ ...sectionDocument(), features: [sketch('Base', 0), sketch('Top', 20),
      { id: 'loft', name: 'Loft 1', kind: 'loft', suppressed: false, sketchIds: ['Base', 'Top'], ruled: false, operation: 'new', targetId: null }, sketch('Later', 30)] });
    await mount(initial); await click('Loft 1'); await openSelected(); expect(select('Section 1').querySelector('option[value="Later"]')).toBeNull(); expect(ids()).toEqual(['Base', 'Top']);
  });
});
