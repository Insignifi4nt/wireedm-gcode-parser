import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadFeatureEditor } from './CadFeatureEditor';
import { cadFeatureCandidateEdits } from './cadFeaturePreview';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function input() { const control = container.querySelector<HTMLInputElement>('input[aria-label="Length mm"]'); if (!control) throw new Error('Missing Length'); return control; }
async function type(text: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text); input().dispatchEvent(new Event('input', { bubbles: true })); });
}
function apply() { const control = container.querySelector<HTMLButtonElement>('button[type="submit"]'); if (!control) throw new Error('Missing Apply'); return control; }
it('retains scientific notation during literal editing so another exponent digit cannot silently become a magnitude digit', async () => {
  const session = new CadSession({ ...createCadDocument(), features: [
    { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
  ] }), before = session.getSnapshot();
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} isNew={false} documentVersion={snapshot.version}
      onPendingChange={session.setWorkflowOpen} onCancel={vi.fn()} onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters }))} />;
  }
  await act(async () => root.render(<Harness />));
  await type('1'); await type(input().value + 'e'); expect(input().value).toBe('1e'); expect(apply().disabled).toBe(true);
  await type(input().value + '2'); expect(input().value).toBe('1e2'); expect(apply().disabled).toBe(false);
  await type(input().value + '0'); expect(input().value).toBe('1e20'); expect(apply().disabled).toBe(true);
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  await type('1e2'); expect(input().value).toBe('1e2'); expect(apply().disabled).toBe(false);
  await act(async () => apply().click()); expect(session.getSnapshot().document.features[1]).toMatchObject({ distance: 100 });
  await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
});
