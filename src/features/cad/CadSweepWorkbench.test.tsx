import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadCurveFeature, CadDatumPlaneFeature, CadDocument, CadSketchFeature, CadSweepFeature } from '@/domain/cad/cadDocument';
import { cadVisibleBodyIds, createCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';

vi.mock('./CadViewport', () => ({ CadViewport: ({ hidden }: { hidden?: boolean }) => hidden ? <div className="cad-viewport" hidden /> : <div aria-label="3D model viewport" /> }));
let root: Root; let container: HTMLDivElement; let session: CadSession;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const section: CadSketchFeature = { id: 'section', name: 'Section', kind: 'sketch', suppressed: false, plane: 'YZ', offset: 0,
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 'radius' } }] };
const rail: CadCurveFeature = { id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: 'XY', offset: 0,
  segments: [{ kind: 'line', start: [0, 0], end: ['length', 0] }] };
const sweep: CadSweepFeature = { id: 'sweep', name: 'Sweep', kind: 'sweep', suppressed: false, sketchId: section.id, curveId: rail.id, operation: 'new', targetId: null };
function part(features: CadDocument['features'] = [section, rail]): CadDocument { return { ...createCadDocument(), parameters: { radius: 1, length: 20 }, features }; }
const baseSketch: CadSketchFeature = { ...section, id: 'base', name: 'Base', plane: 'XY', profiles: [{ id: 'base_circle', name: 'Base circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 10 } }] };
const pad = { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: baseSketch.id, distance: 10, symmetric: true, operation: 'new', targetId: null } satisfies CadDocument['features'][number];
async function mount(document = part()) {
  session = new CadSession(document);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot); const ids = cadVisibleBodyIds(snapshot.document.features);
    const build: CadBuildResult = { buildId: snapshot.version, durationMs: 0, diagnostics: [], meshes: ids.map(id => ({ featureId: id, name: id,
      positions: [], indices: [], normals: [], edges: [], faceGroups: [], edgeGroups: [], volume: 1, bounds: { min: [0, 0, 0], max: [10, 10, 10] } })) };
    return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} buildVersion={snapshot.version} build={build} buildState="ready"
      dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEditMany={edits => { session.edit(edits); }} onEdit={edit => { session.edit([edit]); }} onUndo={session.undo} onRedo={session.redo}
      onWorkflowChange={session.setWorkflowOpen} onBack={vi.fn()} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()}
      onImportDocument={async () => undefined} onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />));
}
function button(label: string) { const element = [...container.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label); if (!element) throw new Error(`Missing ${label}`); return element; }
async function click(label: string) { await act(async () => button(label).click()); }
function select(label: string) { const element = [...container.querySelectorAll('select')].find(entry => entry.closest('label')?.querySelector('span')?.textContent === label); if (!element) throw new Error(`Missing ${label}`); return element; }
async function choose(label: string, value: string) { await act(async () => { const element = select(label); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function rename(row: HTMLButtonElement, value: string) {
  await act(async () => row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true })));
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Feature name"]'); if (!input) throw new Error('Tree rename missing');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await click('Apply name');
}

describe('Sweep workbench workflow', () => {
  it('uses selected reference sources, preserves expression geometry and separates feature creation from tree renaming', async () => {
    await mount(); const before = session.getSnapshot(); await click('Rail'); await click('Sweep');
    expect(select('Profile sketch').value).toBe(section.id); expect(select('Curve').value).toBe(rail.id); expect(select('Operation').value).toBe('new');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    expect(button('Save').disabled).toBe(true); expect(button('Sketch').disabled).toBe(true);
    await click('Apply');
    const created = session.getSnapshot();
    expect(created.document.features.at(-1)).toMatchObject({ kind: 'sweep', name: 'Sweep 1', sketchId: section.id, curveId: rail.id, operation: 'new', targetId: null });
    expect(session.getSnapshot().document.features.slice(0, 2)).toEqual(before.document.features); expect(session.getSnapshot().workflowOpen).toBe(false);
    await rename(button('Select Sweep 1 in history'), 'Pipe');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ kind: 'sweep', name: 'Pipe', sketchId: section.id, curveId: rail.id, operation: 'new', targetId: null });
    await click('Undo'); expect(session.getSnapshot().document).toEqual(created.document);
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('retains invalid placement until Cancel, with exact document/version/history unchanged', async () => {
    const flat = { ...section, id: 'flat', name: 'Flat', plane: 'XY' } satisfies CadSketchFeature;
    await mount(part([section, rail, flat])); await click('Flat'); const before = session.getSnapshot(); await click('Sweep');
    expect(select('Profile sketch').value).toBe('flat'); expect(container.querySelector('[role="status"]')?.textContent).toContain('YZ sketch at offset 0');
    await click('Apply'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('perpendicular');
    const diagnostic = container.querySelector('[role="alert"]')?.textContent;
    expect([...container.querySelectorAll('p')].filter(element => element.textContent === diagnostic)).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    expect(select('Profile sketch').value).toBe('flat'); expect(select('Curve').value).toBe('rail');
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });

  it('permits repairing source selection without changing its default name or relocating either sketch', async () => {
    const flat = { ...section, id: 'flat', name: 'Flat', plane: 'XY' } satisfies CadSketchFeature;
    await mount(part([section, rail, flat])); const before = session.getSnapshot(); await click('Flat'); await click('Sweep');
    await choose('Profile sketch', 'section'); expect(container.querySelector('[role="status"]')).toBeNull(); await click('Apply');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ name: 'Sweep 1', sketchId: 'section' });
    expect(session.getSnapshot().document.features.slice(0, 3)).toEqual(before.document.features);
  });

  it.each(['join', 'cut'] satisfies CadSweepFeature['operation'][])('keeps the consumed target available when editing a saved %s Sweep', async operation => {
    const saved = { ...sweep, operation, targetId: pad.id };
    await mount(part([baseSketch, pad, section, rail, saved])); const before = session.getSnapshot();
    const row = [...container.querySelectorAll<HTMLButtonElement>('.cad-feature-list button')].find(element => element.textContent?.trim() === 'Sweep');
    if (!row) throw new Error('Saved Sweep missing'); await act(async () => row.click()); await act(async () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    expect(select('Target body').value).toBe(pad.id); expect(select('Target body').selectedOptions[0].textContent).toBe('Pad');
    expect(select('Target body').selectedOptions[0].disabled).toBe(false); await rename(row, 'Edited Sweep');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ name: 'Edited Sweep', operation, targetId: pad.id });
    expect(session.getSnapshot().document.features.slice(0, 4)).toEqual(before.document.features.slice(0, 4));
  });

  it('uses current bodies for a new target and drops the target when changing back to New body', async () => {
    await mount(part([baseSketch, pad, section, rail])); const before = session.getSnapshot(); await click('Sweep');
    await choose('Operation', 'join'); expect(select('Target body').value).toBe(pad.id);
    await choose('Operation', 'cut'); expect(select('Target body').value).toBe(pad.id);
    await choose('Operation', 'new'); expect([...container.querySelectorAll('select')].some(entry => entry.closest('label')?.textContent?.startsWith('Target body'))).toBe(false);
    await click('Apply'); expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ operation: 'new', targetId: null });
    expect(session.getSnapshot().document.features.slice(0, 4)).toEqual(before.document.features);
  });
});


describe('datum Sweep atomic authoring', () => {
  const railPlane: CadDatumPlaneFeature = { id: 'rail_mount', name: 'Rail mount', kind: 'datum-plane', suppressed: false,
    definition: { kind: 'world', basePlane: 'XY', origin: [10, 20, 30], rotation: ['tilt', 0, 0] } };
  const sectionPlane: CadDatumPlaneFeature = { ...railPlane, id: 'section_mount', name: 'Section mount',
    definition: { ...railPlane.definition, basePlane: 'YZ', rotation: ['tilt + roll', 0, 0] } };
  const datumSection: CadSketchFeature = { ...section, plane: { kind: 'datum-plane', featureId: sectionPlane.id },
    source: { format: 'dxf', fileName: 'section.dxf', text: 'Exact section source', units: 'mm' } };
  const datumRail: CadCurveFeature = { ...rail, plane: { kind: 'datum-plane', featureId: railPlane.id },
    source: { format: 'dxf', fileName: 'rail.dxf', text: 'Exact rail source', units: 'mm' } };
  function authored(features: CadDocument['features'] = [railPlane, sectionPlane, datumSection, datumRail]) {
    return { ...part(features), parameters: { radius: 1, length: 20, tilt: 30, roll: 37 } };
  }

  it.each([false, true])('creates one undoable Sweep while preserving authored roll, source expressions and normal reversal=%s', async reversed => {
    const frame = reversed ? { ...sectionPlane, definition: { ...sectionPlane.definition, rotation: ['tilt + roll', 0, 180] as const } } : sectionPlane;
    await mount(authored([railPlane, frame, datumSection, datumRail])); const before = session.getSnapshot();
    await click('Rail'); await click('Sweep'); expect(select('Profile sketch').value).toBe('section'); expect(select('Curve').value).toBe('rail');
    expect(container.querySelector('[role="status"]')).toBeNull(); expect(session.getSnapshot().workflowOpen).toBe(true);
    await click('Apply'); const applied = session.getSnapshot();
    expect(applied.document.features.at(-1)).toMatchObject({ kind: 'sweep', name: 'Sweep 1', sketchId: 'section', curveId: 'rail', operation: 'new', targetId: null });
    expect(applied.document.features.slice(0, 4)).toEqual(before.document.features); expect(applied.workflowOpen).toBe(false);
    await click('Undo'); expect(session.getSnapshot().document).toBe(before.document);
    await click('Redo'); expect(session.getSnapshot().document).toBe(applied.document);
  });

  it('retains a misplaced selected section after invalid Apply, then Cancel restores exact history', async () => {
    const wrong = { ...datumSection, id: 'wrong', name: 'Misplaced section', offset: 3 };
    await mount(authored([railPlane, sectionPlane, datumSection, datumRail, wrong])); await click('Misplaced section'); const before = session.getSnapshot();
    await click('Sweep'); await click('Apply');
    const diagnostic = container.querySelector('[role="alert"]')?.textContent;
    expect(diagnostic).toContain('Curve starts at (10, 20, 30) mm'); expect([...container.querySelectorAll('p')].filter(element => element.textContent === diagnostic)).toHaveLength(1);
    expect(select('Profile sketch').value).toBe('wrong'); expect(select('Curve').value).toBe('rail');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, workflowOpen: true, canUndo: false });
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });

  it('repairs only the selected source in an existing Sweep and supports cancelling before atomic Apply', async () => {
    const other = { ...datumSection, id: 'other', name: 'Other section' };
    await mount(authored([railPlane, sectionPlane, datumSection, datumRail, other, sweep])); const before = session.getSnapshot();
    const row = [...container.querySelectorAll<HTMLButtonElement>('.cad-feature-list button')].find(element => element.textContent?.trim() === 'Sweep');
    if (!row) throw new Error('Saved Sweep missing'); await act(async () => row.click()); await act(async () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await choose('Profile sketch', 'other');
    expect(session.getSnapshot().workflowOpen).toBe(true); await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
    // Cancel closes the editor; the selected row reopens it.
    await act(async () => row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    await choose('Profile sketch', 'other'); await click('Apply');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ ...sweep, sketchId: 'other' });
    expect(session.getSnapshot().document.features.slice(0, 5)).toEqual(before.document.features.slice(0, 5));
    await click('Undo'); expect(session.getSnapshot().document).toBe(before.document);
  });
});
