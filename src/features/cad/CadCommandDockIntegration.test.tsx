import { act, useEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { CadSession } from './cadSession';
import { CadWorkbench, type CadWorkbenchProps } from './CadWorkbench';

const viewportMounted = vi.fn(), viewportUnmounted = vi.fn(), fit = vi.fn();
// WebGL is unavailable in jsdom; keep the real drawer, Workbench and session.
vi.mock('./CadViewport', async () => {
  const { CadViewTools } = await import('./CadCommandDock');
  return { CadViewport: () => {
    useEffect(() => { viewportMounted(); return viewportUnmounted; }, []);
    return <div aria-label="3D model viewport"><CadViewTools label="Viewport controls"><button aria-label="Fit model" onClick={fit}>Fit</button></CadViewTools></div>;
  } };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const part: CadDocument = { ...createCadDocument('Drawer draft', 'drawer_draft'), features: [
  { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
  ] },
  { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
] };
function button(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label);
  if (!found) throw new Error(`Missing ${label}`); return found;
}
function length() { const control = container.querySelector<HTMLInputElement>('input[aria-label="Length mm"]'); if (!control) throw new Error('Missing Length'); return control; }
it.each(['View controls', 'Fit model'])('closes the drawer from %s without cancelling or remounting a pending CAD feature', async origin => {
  const session = new CadSession(part), before = session.getSnapshot();
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    const props: CadWorkbenchProps = { document: snapshot.document, documentVersion: snapshot.version, dirty: snapshot.dirty, canUndo: snapshot.canUndo, canRedo: snapshot.canRedo,
      build: null, buildVersion: null, buildState: 'idle', onEdit: edit => session.edit([edit]), onEditMany: edits => session.edit(edits), onWorkflowChange: session.setWorkflowOpen,
      onUndo: () => session.undo(), onRedo: () => session.redo(), onSave: async () => undefined, onBack: vi.fn(), onNewDocument: vi.fn(), onOpenDocument: vi.fn(),
      onImportDocument: async () => undefined, onExportDocument: vi.fn(), onExportSolid: async () => undefined, onSendToCam: async () => undefined };
    return <CadWorkbench {...props} />;
  }
  await act(async () => root.render(<Harness />));
  await act(async () => button('Select Pad in history').click());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(length(), '27');
    length().dispatchEvent(new Event('input', { bubbles: true }));
  });
  const pendingInput = length(); expect(pendingInput.value).toBe('27'); expect(session.getSnapshot().workflowOpen).toBe(true);
  await act(async () => button('View controls').click());
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await act(async () => { button(origin).focus(); button(origin).dispatchEvent(escape); });
  expect(length().value).toBe('27'); expect(length()).toBe(pendingInput);
  expect(escape.defaultPrevented).toBe(true); expect(button('View controls').getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(button('View controls'));
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  expect(viewportMounted).toHaveBeenCalledTimes(1); expect(viewportUnmounted).not.toHaveBeenCalled(); expect(fit).not.toHaveBeenCalled();
  await act(async () => button('Apply').click());
  expect(session.getSnapshot().document.features[1]).toMatchObject({ distance: 27 });
  await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
});
