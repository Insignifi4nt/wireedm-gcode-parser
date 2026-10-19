import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadMesh } from '@/domain/cad/cadDocument';
import { CadEdgeTreatmentCommand } from './CadEdgeTreatmentCommand';
import { CadWorkbench } from './CadWorkbench';
import { CadSession } from './cadSession';

// Geometry is covered by real OpenCascade tests; jsdom has no WebGL context.
vi.mock('./CadViewport', () => ({ CadViewport: ({ hidden }: { hidden?: boolean }) => hidden ? <div className="cad-viewport" hidden /> : <div aria-label="3D model viewport" /> }));
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Button ${label} missing`); return found;
}
async function click(label: string) { await act(async () => button(label).click()); }
async function key(element: HTMLElement, value: string, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true });
  await act(async () => element.dispatchEvent(event)); return event;
}
function menu() { return document.querySelector('[aria-label="Edge treatment commands"]'); }

describe('grouped fillet and chamfer command', () => {
  it('uses the same command family for supported sketch corners without offering an unsupported chamfer', async () => {
    const choose = vi.fn(); await act(async () => root.render(<CadEdgeTreatmentCommand context="sketch" disabled={false} onChoose={choose} />));
    await click('Sketch corner tools');
    expect(document.querySelectorAll('[role="menuitem"]')).toHaveLength(1);
    await click('Fillet'); expect(choose).toHaveBeenCalledExactlyOnceWith('fillet'); expect(menu()).toBeNull();
  });
  it('opens above a bottom dock trigger without losing keyboard navigation or toolbar Tab order', async () => {
    vi.stubGlobal('innerHeight', 800); vi.stubGlobal('innerWidth', 1000);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'menu' ? new DOMRect(0, 0, 182, 76) : new DOMRect(940, 740, 32, 36);
    });
    await act(async () => root.render(<div className="cad-toolbar"><button>Previous</button><CadEdgeTreatmentCommand disabled={false} onChoose={vi.fn()} /><button>Next</button></div>));
    const trigger = button('Fillet / Chamfer'); await key(trigger, 'ArrowUp');
    const popup = menu(); if (!(popup instanceof HTMLElement)) throw new Error('Edge treatment menu missing');
    expect(Number.parseFloat(popup.style.top) + 76).toBeLessThanOrEqual(735);
    expect(Number.parseFloat(popup.style.left) + 182).toBeLessThanOrEqual(996);
    expect(document.activeElement).toBe(button('Chamfer'));
    await key(button('Chamfer'), 'Escape'); expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger);
    await key(trigger, 'ArrowDown'); await key(button('Fillet'), 'Tab');
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(button('Next'));
    await key(trigger, 'ArrowDown'); await key(button('Fillet'), 'Tab', true);
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(button('Previous'));
  });
  it('opens from the keyboard, navigates commands and restores focus on Escape', async () => {
    const choose = vi.fn(); await act(async () => root.render(<CadEdgeTreatmentCommand disabled={false} onChoose={choose} />));
    const trigger = button('Fillet / Chamfer'); await act(async () => trigger.focus());
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect((await key(trigger, 'ArrowDown')).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button('Fillet')); expect(menu()?.parentElement).toBe(document.body);
    await key(button('Fillet'), 'ArrowUp'); expect(document.activeElement).toBe(button('Chamfer'));
    await key(button('Chamfer'), 'Home'); expect(document.activeElement).toBe(button('Fillet'));
    await key(button('Fillet'), 'End'); expect(document.activeElement).toBe(button('Chamfer'));
    expect((await key(button('Chamfer'), 'Escape')).defaultPrevented).toBe(true);
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger); expect(choose).not.toHaveBeenCalled();
    await key(trigger, 'ArrowUp'); expect(document.activeElement).toBe(button('Chamfer'));
    await click('Chamfer'); expect(choose).toHaveBeenCalledExactlyOnceWith('chamfer'); expect(menu()).toBeNull();
  });
  it('dismisses outside, on focus departure and when the workbench locks commands', async () => {
    const choose = vi.fn(); const render = (disabled = false) => root.render(<><CadEdgeTreatmentCommand disabled={disabled} onChoose={choose} /><button>Outside</button></>);
    await act(async () => render()); await click('Fillet / Chamfer');
    await act(async () => button('Outside').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(menu()).toBeNull();
    await click('Fillet / Chamfer'); await act(async () => button('Outside').focus());
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(button('Outside'));
    await click('Fillet / Chamfer'); await act(async () => render(true));
    expect(menu()).toBeNull(); expect(button('Fillet / Chamfer').disabled).toBe(true); expect(choose).not.toHaveBeenCalled();
  });
  it('lets the trigger close its own menu and Tab continue in toolbar order', async () => {
    await act(async () => root.render(<div className="cad-toolbar"><button>Previous</button><CadEdgeTreatmentCommand disabled={false} onChoose={vi.fn()} /><button>Next</button></div>));
    await click('Fillet / Chamfer'); const trigger = button('Fillet / Chamfer');
    const pointer = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    await act(async () => trigger.dispatchEvent(pointer)); expect(pointer.defaultPrevented).toBe(true);
    await click('Fillet / Chamfer'); expect(menu()).toBeNull(); expect(document.activeElement).toBe(trigger);
    await click('Fillet / Chamfer'); await key(button('Fillet'), 'Tab');
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(button('Next'));
    await click('Fillet / Chamfer'); await key(button('Fillet'), 'Tab', true);
    expect(menu()).toBeNull(); expect(document.activeElement).toBe(button('Previous'));
  });
  it.each(['fillet', 'chamfer'] as const)('starts %s through the real workbench, commits only on Apply and supports Undo', async kind => {
    const initial = parseCadDocument({ ...createCadDocument('Edge treatment'), features: [
      { id: 'sketch', kind: 'sketch', name: 'Sketch 1', suppressed: false, plane: 'XY', offset: 0, profiles: [
        { id: 'profile', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
      ] },
      { id: 'pad', kind: 'extrude', name: 'Pad 1', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
    ] });
    const session = new CadSession(initial);
    function Harness() {
      const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
      const body = snapshot.document.features.at(-1);
      const meshes: CadMesh[] = body ? [{ featureId: body.id, name: body.name, positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 1000, bounds: { min: [0, 0, 0], max: [20, 10, 5] } }] : [];
      return <CadWorkbench document={snapshot.document} documentVersion={snapshot.version} buildVersion={snapshot.version} build={{ buildId: `build-${snapshot.version}`, meshes, diagnostics: [], durationMs: 0 }} buildState="ready" dirty={snapshot.dirty} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo}
        onEditMany={edits => { session.edit(edits); }} onEdit={edit => session.edit([edit], snapshot.version)} onUndo={() => session.undo()} onRedo={() => session.redo()} onWorkflowChange={session.setWorkflowOpen}
        onBack={vi.fn()} onSave={async () => undefined} onOpenDocument={vi.fn()} onNewDocument={vi.fn()} onImportDocument={async () => undefined}
        onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined} />;
    }
    await act(async () => root.render(<Harness />)); const before = session.getSnapshot();
    await click('Fillet / Chamfer'); expect(session.getSnapshot()).toBe(before);
    await click(kind === 'fillet' ? 'Fillet' : 'Chamfer');
    expect(session.getSnapshot().document).toBe(before.document); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Fillet / Chamfer').disabled).toBe(true); expect(button('Pattern').disabled).toBe(true);
    await click('Apply'); expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ kind, targetId: 'pad', radius: 1 });
    expect(session.getSnapshot().workflowOpen).toBe(false); expect(session.getSnapshot().canUndo).toBe(true);
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
  });
});
