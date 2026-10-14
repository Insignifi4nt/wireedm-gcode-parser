import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CAD_GEAR_V2_PLUGIN, createCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { cadProfileToEntities, resolveCadProfile } from '@/domain/cad/cadSketchGeometry';
import { CadSession } from './cadSession';
import { CadWorkbench } from './CadWorkbench';

// The real DOM/SVG sketch and numeric geometry run; jsdom has no native WebGL context.
vi.mock('./CadViewport', () => ({ CadViewport: () => <div>Native solid viewport</div> }));
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('cad-body') ? 1400 : 1000; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function gearDocument(linkModule = false): CadDocument {
  const geometry = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
  geometry.inputs.module = linkModule ? 'module' : 3; geometry.inputs.teeth = 'teeth'; geometry.inputs.pressureAngle = 'pressureAngle';
  return { ...createCadDocument(), parameters: { module: linkModule ? 3 : 4, teeth: 18, pressureAngle: 20 }, features: [{ kind: 'sketch', id: 'gear_sketch', name: 'Gear sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'gear', name: 'Gear', construction: false, geometry }, { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 6 } }
  ] }] };
}
async function mount(document = gearDocument()) {
  const session = new CadSession(document), edits = vi.fn((batch: readonly CadEdit[]) => { session.edit(batch); });
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={state.document} documentVersion={state.version} buildVersion={null} build={null} buildState="idle" dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo}
      onEdit={edit => session.edit([edit])} onEditMany={edits} onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen}
      onBack={vi.fn()} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined} onExportDocument={vi.fn()}
      onExportSolid={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />)); return { session, edits };
}
function button(label: string) {
  const match = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(element => element.getAttribute('aria-label') === label || element.textContent?.trim() === label);
  if (!match) throw new Error(`Missing button ${label}`); return match;
}
async function click(label: string) { await act(async () => button(label).click()); }
function field(label: string) { const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); if (!input) throw new Error(`Missing field ${label}`); return input; }
async function input(label: string, value: string) {
  const element = field(label), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Missing input setter');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function openGear() { await click('Select Gear sketch in history'); await click('Gear profile'); }
function circleRadius(label: string) { const circle = container.querySelector<SVGCircleElement>(`.cad-gear-inspection circle[aria-label="${label}"]`); if (!circle) throw new Error(`Missing ${label}`); return Number(circle.getAttribute('r')); }
function profileModule(session: CadSession) { const sketch = session.getSnapshot().document.features[0]; if (sketch.kind !== 'sketch' || sketch.profiles[0].geometry.kind !== 'plugin') throw new Error('Missing gear'); return sketch.profiles[0].geometry.inputs.module; }
describe('gear configuration and canvas integration', () => {
  it('renders a selected gear as one closed boundary while retaining all exact export entities', async () => {
    const { session } = await mount(); const original = session.getSnapshot().document;
    const sketch = original.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Missing sketch');
    const before = cadProfileToEntities(resolveCadProfile(sketch.profiles[0].geometry, original.parameters));
    await openGear();
    const group = container.querySelector('[aria-label="Select Gear profile"]');
    const paths = group?.querySelectorAll('path');
    expect(paths?.length).toBe(1);
    const data = paths?.[0].getAttribute('d') ?? '';
    expect(data.match(/M /g)).toHaveLength(1);
    expect(data.match(/L /g)).toHaveLength(before.filter(entity => entity.type === 'line').length);
    expect(data.match(/A /g)).toHaveLength(before.filter(entity => entity.type === 'arc').length);
    expect(data.endsWith(' Z')).toBe(true);
    expect(session.getSnapshot().document).toBe(original);
    expect(cadProfileToEntities(resolveCadProfile(sketch.profiles[0].geometry, original.parameters))).toEqual(before);
  });
  it('distinguishes an unused named module from literal local inputs and scopes the geometry overlay to the selected profile', async () => {
    const { session } = await mount(); const before = session.getSnapshot().document;
    const columns = container.querySelector<HTMLElement>('.cad-body')?.style.gridTemplateColumns;
    await click('Parameters');
    expect(button('Edit parameter module').textContent).toContain('Unused'); expect(button('Edit parameter module').textContent).toContain('4');
    expect(button('Inspect Gear Module').textContent).toContain('3'); await click('Inspect Gear Module');
    expect(circleRadius('Pitch circle')).toBe(27); expect(container.querySelector('[data-cad-parameter-highlight="gear"]')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.cad-body')?.style.gridTemplateColumns).toBe(columns);
    await click('Collapse Parameters'); await click('Bore profile'); expect(container.querySelector('.cad-gear-inspection')).toBeNull();
    await click('Gear profile'); await act(async () => field('Module').focus()); expect(circleRadius('Pitch circle')).toBe(27);
    expect(session.getSnapshot().document).toBe(before); expect(profileModule(session)).toBe(3);
  });
  it('highlights the actual pressure-angle geometry when inspecting its named parameter', async () => {
    const { session } = await mount(); await click('Parameters'); await click('Edit parameter pressureAngle');
    expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(container.querySelector('[data-cad-gear-inspection="pressureAngle"]')).not.toBeNull();
    expect(circleRadius('Base circle')).toBeCloseTo(27 * Math.cos(20 * Math.PI / 180), 10);
    await click('Close parameter editor'); expect(session.getSnapshot().workflowOpen).toBe(false);
  });
  it('previews a numeric linked edit without changing the document, then cancels and applies it as one undo step', async () => {
    const { session, edits } = await mount(gearDocument(true)); const original = session.getSnapshot().document;
    await openGear(); expect(field('Module').value).toBe('3'); await act(async () => field('Module').focus());
    await input('Module', '4');
    expect(container.textContent).toContain('Preview · Apply to keep changes'); expect(circleRadius('Pitch circle')).toBe(36);
    expect(session.getSnapshot().document).toBe(original); expect(session.getSnapshot().workflowOpen).toBe(true); expect(profileModule(session)).toBe('module');
    await click('Cancel'); expect(session.getSnapshot().workflowOpen).toBe(false); expect(field('Module').value).toBe('3'); expect(session.getSnapshot().document).toBe(original);
    await act(async () => field('Module').focus()); await input('Module', '4'); await click('Apply');
    expect(edits).toHaveBeenCalledTimes(1); expect(session.getSnapshot().document.parameters.module).toBe(4); expect(profileModule(session)).toBe('module'); expect(session.getSnapshot().workflowOpen).toBe(false);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(original); expect(session.getSnapshot().canUndo).toBe(false);
  });
  it('locks the workflow while an fx draft is dirty before keeping its relation', async () => {
    const { session, edits } = await mount(gearDocument(true)); const original = session.getSnapshot().document;
    await openGear(); await click('Edit Module relation'); expect(session.getSnapshot().workflowOpen).toBe(false);
    await input('Module expression', 'module * 2');
    expect(session.getSnapshot().workflowOpen).toBe(true); expect(button('Parameters').disabled).toBe(true); expect(button('Edit Module').disabled).toBe(true);
    expect(session.getSnapshot().document).toBe(original); expect(edits).not.toHaveBeenCalled();
    await click('Close Module relation help'); expect(session.getSnapshot().workflowOpen).toBe(false); expect(profileModule(session)).toBe('module');
  });
  it('isolates the plugin library from a clean relation portal when opened by keyboard', async () => {
    const { session, edits } = await mount(gearDocument(true));
    await openGear(); await click('Edit Module relation');
    const expression = field('Module expression'), original = session.getSnapshot();
    expect(original.workflowOpen).toBe(false);
    // Keyboard activation has no outside pointerdown to dismiss the pinned help.
    await act(async () => { const plugins = button('Plugins'); plugins.focus(); plugins.click(); });
    expect(expression.isConnected).toBe(false);
    expect(document.querySelector('[aria-label="Module relation help"]')).toBeNull();
    expect(container.querySelector('.cad-body')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('.cad-toolbar')?.hasAttribute('inert')).toBe(true);
    expect(container.querySelector('.cad-header')?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(field('Search plugins'));
    await input('Search plugins', 'spur');
    expect(button('Add Spur gear').disabled).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ document: original.document, version: original.version, workflowOpen: true });
    expect(session.getSnapshot().document).toBe(original.document);
    expect(edits).not.toHaveBeenCalled();
    await click('Close');
    expect(session.getSnapshot()).toMatchObject({ document: original.document, version: original.version, workflowOpen: false });
    expect(session.getSnapshot().document).toBe(original.document);
    expect(container.querySelector('.cad-body')?.hasAttribute('inert')).toBe(false);
    expect(profileModule(session)).toBe('module');
  });
  it('keeps an on-part editor usable through its own lock while blocking other workflow races', async () => {
    const { session, edits } = await mount(gearDocument(true)); await openGear();
    await click('Edit Module relation'); await click('Edit Module');
    expect(session.getSnapshot().workflowOpen).toBe(true); expect(field('Module value').disabled).toBe(false);
    await input('Module expression', 'module * 2');
    expect(field('Module value').disabled).toBe(true); const onPartApply = container.querySelector<HTMLButtonElement>('.cad-dimension-edit button[type="submit"]'); expect(onPartApply?.disabled).toBe(true);
    expect(edits).not.toHaveBeenCalled();
  });
  it('edits on-part teeth and module with domain validation and one atomic history step each', async () => {
    const { session, edits } = await mount(gearDocument(true)); await openGear();
    const original = session.getSnapshot().document;
    await click('Edit Teeth'); expect(field('Teeth value').disabled).toBe(false); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Circle').disabled).toBe(true); await click('Circle'); expect(field('Teeth value').disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('.cad-sketch-options input')?.disabled).toBe(true);
    await input('Teeth value', '12.5'); expect(container.querySelector('.cad-dimension-error')?.textContent).toContain('integer');
    const apply = container.querySelector<HTMLButtonElement>('.cad-dimension-edit button[type="submit"]'); expect(apply?.disabled).toBe(true); expect(session.getSnapshot().document).toBe(original);
    await input('Teeth value', '12'); await click('Apply'); expect(session.getSnapshot().document.parameters.teeth).toBe(12); expect(session.getSnapshot().workflowOpen).toBe(false); expect(edits).toHaveBeenCalledTimes(1);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(original); expect(session.getSnapshot().canUndo).toBe(false);
    await click('Edit Module'); await input('Module value', '4'); await click('Apply'); expect(session.getSnapshot().document.parameters.module).toBe(4); expect(profileModule(session)).toBe('module'); expect(edits).toHaveBeenCalledTimes(2);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(original); expect(session.getSnapshot().canUndo).toBe(false);
  });
});
