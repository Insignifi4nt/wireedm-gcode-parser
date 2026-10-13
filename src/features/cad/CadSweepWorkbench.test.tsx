import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadCurveFeature, CadDocument, CadSketchFeature, CadSweepFeature } from '@/domain/cad/cadDocument';
import { cadVisibleBodyIds, createCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';

vi.mock('./CadViewport', () => ({ CadViewport: () => <div aria-label="3D model viewport" /> }));
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
      dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} onEdit={edit => { session.edit([edit]); }} onUndo={session.undo} onRedo={session.redo}
      onWorkflowChange={session.setWorkflowOpen} onBack={vi.fn()} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()}
      onImportDocument={async () => undefined} onExportDocument={vi.fn()} onExportSolid={async () => undefined} onExportDxf={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />));
}
function button(label: string) { const element = [...container.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label); if (!element) throw new Error(`Missing ${label}`); return element; }
async function click(label: string) { await act(async () => button(label).click()); }
function select(label: string) { const element = [...container.querySelectorAll('select')].find(entry => entry.closest('label')?.querySelector('span')?.textContent === label); if (!element) throw new Error(`Missing ${label}`); return element; }
async function choose(label: string, value: string) { await act(async () => { const element = select(label); element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }); }
async function name(value: string) {
  const input = [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.textContent === 'Name')?.querySelector('input'); if (!input) throw new Error('Name field missing');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Sweep workbench workflow', () => {
  it('uses selected reference sources, preserves expression geometry and creates one undoable feature', async () => {
    await mount(); const before = session.getSnapshot(); await click('Rail'); await click('Sweep');
    expect(select('Profile sketch').value).toBe(section.id); expect(select('Curve').value).toBe(rail.id); expect(select('Operation').value).toBe('new');
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    expect(button('Save').disabled).toBe(true); expect(button('Sketch').disabled).toBe(true);
    await name('Pipe'); await click('Apply');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ kind: 'sweep', name: 'Pipe', sketchId: section.id, curveId: rail.id, operation: 'new', targetId: null });
    expect(session.getSnapshot().document.features.slice(0, 2)).toEqual(before.document.features); expect(session.getSnapshot().workflowOpen).toBe(false);
    await click('Undo'); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
  });

  it('retains invalid placement and name edits until Cancel, with exact document/version/history unchanged', async () => {
    const flat = { ...section, id: 'flat', name: 'Flat', plane: 'XY' } satisfies CadSketchFeature;
    await mount(part([section, rail, flat])); await click('Flat'); const before = session.getSnapshot(); await click('Sweep'); await name('Pending Sweep');
    expect(select('Profile sketch').value).toBe('flat'); expect(container.querySelector('[role="status"]')?.textContent).toContain('YZ sketch at offset 0');
    await click('Apply'); expect(container.querySelector('[role="alert"]')?.textContent).toContain('perpendicular');
    const diagnostic = container.querySelector('[role="alert"]')?.textContent;
    expect([...container.querySelectorAll('p')].filter(element => element.textContent === diagnostic)).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
    expect(select('Profile sketch').value).toBe('flat'); expect(container.querySelector<HTMLInputElement>('label input')?.value).toBe('Pending Sweep');
    await click('Cancel'); expect(session.getSnapshot()).toEqual(before);
  });

  it('permits repairing source selection without losing a pending name or relocating either sketch', async () => {
    const flat = { ...section, id: 'flat', name: 'Flat', plane: 'XY' } satisfies CadSketchFeature;
    await mount(part([section, rail, flat])); const before = session.getSnapshot(); await click('Flat'); await click('Sweep'); await name('Repaired Sweep');
    await choose('Profile sketch', 'section'); expect(container.querySelector('[role="status"]')).toBeNull(); await click('Apply');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ name: 'Repaired Sweep', sketchId: 'section' });
    expect(session.getSnapshot().document.features.slice(0, 3)).toEqual(before.document.features);
  });

  it.each(['join', 'cut'] satisfies CadSweepFeature['operation'][])('keeps the consumed target available when editing a saved %s Sweep', async operation => {
    const saved = { ...sweep, operation, targetId: pad.id };
    await mount(part([baseSketch, pad, section, rail, saved])); const before = session.getSnapshot();
    const row = [...container.querySelectorAll<HTMLButtonElement>('.cad-feature-list button')].find(element => element.textContent?.trim() === 'Sweep');
    if (!row) throw new Error('Saved Sweep missing'); await act(async () => row.click());
    expect(select('Target body').value).toBe(pad.id); expect(select('Target body').selectedOptions[0].textContent).toBe('Pad');
    expect(select('Target body').selectedOptions[0].disabled).toBe(false); await name('Edited Sweep'); await click('Apply');
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
