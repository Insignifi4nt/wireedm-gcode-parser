import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature, CadMesh } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { resolveCadCircularPattern } from '@/domain/cad/cadPatterns';
import { CadPatternCommand } from './CadPatternCommand';
import { CadWorkbench } from './CadWorkbench';
import { CadSession } from './cadSession';

// WebGL pixels are verified in kernel/browser suites; these tests use real edits.
vi.mock('./CadViewport', () => ({ CadViewport: () => <div aria-label="3D model viewport" /> }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button ${label} missing`);
  return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function key(element: HTMLElement, value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  await act(async () => element.dispatchEvent(event)); return event;
}
function inputField(label: string): HTMLInputElement {
  const input = [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.childNodes[0]?.textContent === label)?.querySelector('input');
  if (!input) throw new Error(`Field ${label} missing`); return input;
}
async function input(element: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Native input setter missing');
  await act(async () => { setter.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function relation(label: string, value: string) {
  await click(`Edit ${label} relation`);
  const control = document.querySelector<HTMLInputElement>(`input[aria-label="${label} expression"]`); if (!control) throw new Error('Expression field missing'); await input(control, value);
  await click('Keep relation'); await click(`Close ${label} relation help`);
}
function solidDocument(): CadDocument {
  return parseCadDocument({ ...createCadDocument('Pattern part'), parameters: { offset: 5, sweep: 180 }, features: [
    { id: 'sketch', kind: 'sketch', name: 'Sketch 1', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'profile', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 20, y: 0, width: 5, height: 5, cornerRadius: 0 } }
    ] },
    { id: 'pad', kind: 'extrude', name: 'Pad 1', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
  ] });
}
async function mountWorkbench(initial = solidDocument()) {
  const session = new CadSession(initial);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const body = snapshot.document.features.at(-1);
    const meshes: CadMesh[] = body ? [{ featureId: body.id, name: body.name, positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 125, bounds: { min: [20, 0, 0], max: [25, 5, 5] } }] : [];
    return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} buildVersion={snapshot.version}
      build={{ buildId: `build-${snapshot.version}`, meshes, diagnostics: [], durationMs: 0 }} buildState="ready" dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
      onEditMany={edits => { session.edit(edits); }} onEdit={edit => session.edit([edit], snapshot.version)} onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen}
      onBack={vi.fn()} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined}
      onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined} />;
  }
  await act(async () => root.render(<Harness />)); return session;
}
function circular(feature: CadFeature | undefined) {
  if (feature?.kind !== 'circular-pattern') throw new Error('Circular pattern missing'); return feature;
}

describe('compact pattern command', () => {
  it('opens above a bottom dock trigger and preserves Escape and forward/backward Tab focus', async () => {
    vi.stubGlobal('innerHeight', 800); vi.stubGlobal('innerWidth', 1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? new DOMRect(0, 0, 182, 76) : new DOMRect(940, 740, 32, 36);
    });
    await act(async () => root.render(<div className="cad-toolbar"><button>Previous</button><CadPatternCommand disabled={false} onChoose={vi.fn()} /><button>Next</button></div>));
    const trigger = button('Pattern'); await key(trigger, 'ArrowUp');
    const popup = document.querySelector('[aria-label="Pattern commands"]'); if (!(popup instanceof HTMLElement)) throw new Error('Pattern menu missing');
    expect(Number.parseFloat(popup.style.top) + 76).toBeLessThanOrEqual(735);
    expect(Number.parseFloat(popup.style.left) + 182).toBeLessThanOrEqual(996);
    expect(document.activeElement).toBe(button('Circular pattern'));
    await key(button('Circular pattern'), 'Escape'); expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
    await key(trigger, 'ArrowDown'); await key(button('Linear pattern'), 'Tab'); expect(document.activeElement).toBe(button('Next'));
    await key(trigger, 'ArrowDown'); await key(button('Linear pattern'), 'Tab', true); expect(document.activeElement).toBe(button('Previous'));
  });
  it('supports keyboard opening, command navigation and Escape with focus restoration', async () => {
    const choose = vi.fn(); await act(async () => root.render(<CadPatternCommand disabled={false} onChoose={choose} />));
    const trigger = button('Pattern'); trigger.focus();
    expect((await key(trigger, 'ArrowDown')).defaultPrevented).toBe(true); expect(document.activeElement).toBe(button('Linear pattern'));
    await key(button('Linear pattern'), 'ArrowDown'); expect(document.activeElement).toBe(button('Circular pattern'));
    await key(button('Circular pattern'), 'Home'); expect(document.activeElement).toBe(button('Linear pattern'));
    await key(button('Linear pattern'), 'End'); expect(document.activeElement).toBe(button('Circular pattern'));
    expect((await key(button('Circular pattern'), 'Escape')).defaultPrevented).toBe(true);
    expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(choose).not.toHaveBeenCalled();
    await key(trigger, 'ArrowUp'); expect(document.activeElement).toBe(button('Circular pattern'));
    await click('Circular pattern'); expect(choose).toHaveBeenCalledExactlyOnceWith('circular-pattern');
  });
  it('dismisses on an outside pointer or focus departure and closes when a workflow locks it', async () => {
    const choose = vi.fn(); const render = (disabled = false) => root.render(<><CadPatternCommand disabled={disabled} onChoose={choose} /><button>Outside</button></>);
    await act(async () => render()); await click('Pattern');
    await act(async () => button('Outside').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull();
    await click('Pattern'); await act(async () => button('Outside').focus());
    expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull(); expect(document.activeElement).toBe(button('Outside'));
    await click('Pattern'); await act(async () => render(true));
    expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull(); expect(button('Pattern').disabled).toBe(true); expect(choose).not.toHaveBeenCalled();
  });
  it('lets the open trigger close the menu without its pointer focus reopening it', async () => {
    await act(async () => root.render(<CadPatternCommand disabled={false} onChoose={vi.fn()} />));
    await click('Pattern'); const trigger = button('Pattern');
    const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => trigger.dispatchEvent(pointer)); expect(pointer.defaultPrevented).toBe(true);
    await click('Pattern'); expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });
});

describe('circular pattern editing', () => {
  it('creates the tested circular defaults only on Apply and locks other commands while pending', async () => {
    const session = await mountWorkbench(); const before = session.getSnapshot();
    await click('Pattern'); expect(session.getSnapshot()).toBe(before); await click('Circular pattern');
    expect(inputField('Instances, including original').value).toBe('4'); expect(inputField('Angular extent').value).toBe('360'); expect(inputField('Center X').value).toBe('0');
    expect(container.querySelector('select')?.value).toBe('pad');
    expect([...container.querySelectorAll('select')].at(-1)?.value).toBe('z');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Pattern').disabled).toBe(true); expect(button('Move').disabled).toBe(true); expect(button('Undo').disabled).toBe(true);
    await click('Apply'); expect(circular(session.getSnapshot().document.features.at(-1))).toMatchObject({ sourceId: 'pad', count: 4, axis: 'z', center: [0, 0, 0], angle: 360 });
    expect(session.getSnapshot().workflowOpen).toBe(false); expect(session.getSnapshot().canUndo).toBe(true);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
  });
  it('retains linear pattern defaults through the same command', async () => {
    const session = await mountWorkbench(); await click('Pattern'); await click('Linear pattern'); await click('Apply');
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ kind: 'linear-pattern', sourceId: 'pad', count: 2, spacing: [30, 0, 0] });
  });
  it('exits the popup with Tab relative to the toolbar trigger', async () => {
    const session = await mountWorkbench(); const before = session.getSnapshot(); await click('Pattern');
    const popup = document.querySelector('[aria-label="Pattern commands"]');
    expect(popup?.parentElement).toBe(document.body);
    expect((await key(button('Linear pattern'), 'Tab')).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button('Mirror')); expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull();
    await click('Pattern'); await key(button('Linear pattern'), 'ArrowDown');
    await key(button('Circular pattern'), 'Tab', true); expect(document.activeElement).toBe(button('Move'));
    expect(document.querySelector('[aria-label="Pattern commands"]')).toBeNull(); expect(session.getSnapshot()).toBe(before);
  });
  it('applies signed extent and center expressions atomically, then edits the persisted pattern', async () => {
    const session = await mountWorkbench(); await click('Pattern'); await click('Circular pattern');
    await input(inputField('Instances, including original'), '5'); await relation('Angular extent', '-sweep');
    await relation('Center X', 'offset * 2'); await relation('Center Y', 'offset'); await relation('Center Z', 'offset / 2');
    const axis = [...container.querySelectorAll('select')].at(-1); if (!axis) throw new Error('Axis missing');
    await act(async () => { axis.value = 'x'; axis.dispatchEvent(new Event('change', { bubbles: true })); });
    await click('Apply'); const feature = circular(session.getSnapshot().document.features.at(-1));
    expect(feature).toMatchObject({ count: 5, axis: 'x', center: ['offset * 2', 'offset', 'offset / 2'], angle: '-sweep' });
    expect(resolveCadCircularPattern(feature, session.getSnapshot().document.parameters)).toMatchObject({ center: [10, 5, 2.5], angles: [0, -45, -90, -135, -180] });
    const before = session.getSnapshot(); await relation('Angular extent', '90');
    expect(session.getSnapshot().version).toBe(before.version); await click('Apply');
    expect(circular(session.getSnapshot().document.features.at(-1)).angle).toBe('90');
    expect(session.getSnapshot().document.features).toHaveLength(3);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
  });
  it('rejects invalid extent without altering the document and Escape cancels all pending fields', async () => {
    const session = await mountWorkbench(); const before = session.getSnapshot(); await click('Pattern'); await click('Circular pattern');
    await input(inputField('Angular extent'), '0'); await relation('Center X', 'offset'); await click('Apply');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('extent must be nonzero');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().version).toBe(before.version); expect(session.getSnapshot().canUndo).toBe(false);
    expect(session.getSnapshot().workflowOpen).toBe(true); await key(inputField('Center X'), 'Escape');
    expect(session.getSnapshot()).toEqual(before); expect(container.querySelector('.cad-property-form')).toBeNull(); expect(button('Pattern').disabled).toBe(false);
  });
  it('uses the visible body when a historical consumed feature is selected', async () => {
    const initial = parseCadDocument({ ...solidDocument(), features: [...solidDocument().features,
      { id: 'linear', name: 'Linear pattern 1', kind: 'linear-pattern', suppressed: false, sourceId: 'pad', count: 2, spacing: [30, 0, 0] }
    ] });
    const session = await mountWorkbench(initial);
    await click('Pad 1'); await click('Pattern'); await click('Circular pattern'); await click('Apply');
    expect(circular(session.getSnapshot().document.features.at(-1)).sourceId).toBe('linear');
  });
});
