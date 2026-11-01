import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature } from '@/domain/cad/cadDocument';
import { cadVisibleBodyIds, createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadFeatureEditor } from './CadFeatureEditor';
import { CadSession } from './cadSession';
import { cadFeatureCandidateEdits } from './cadFeaturePreview';

let root: Root; let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function part(operation: 'pocket' | 'move'): CadDocument {
  const body: CadFeature = operation === 'move'
    ? { id: 'result', name: 'Moved body', kind: 'transform', suppressed: false, sourceId: 'pad', translation: [20, 0, 0], rotation: [0, 0, 0] }
    : { id: 'result', name: 'Pocket', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 2, symmetric: false, operation: 'cut', targetId: 'pad' };
  return parseCadDocument({ ...createCadDocument('History targets'), parameters: { step: 10 }, features: [
    { id: 'sketch', name: 'Sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 10 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }, body
  ] });
}
async function mount(document: CadDocument) {
  const session = new CadSession(document);
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot); const feature = snapshot.document.features.at(-1);
    if (!feature) throw new Error('Feature missing');
    return <CadFeatureEditor feature={feature} document={snapshot.document} isNew={false} currentBodyIds={cadVisibleBodyIds(snapshot.document.features, snapshot.document)}
      onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, parameters, isNew: false }), snapshot.version)} onCancel={vi.fn()} onPendingChange={session.setWorkflowOpen} />;
  }
  await act(async () => root.render(<Harness />)); return session;
}
async function editScalar(label: string, value: string) {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="Edit ${label} relation"]`); if (!trigger) throw new Error('Relation action missing');
  await act(async () => trigger.click());
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${label} expression"]`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setter) throw new Error('Field missing');
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const keep = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Keep relation'), close = document.querySelector<HTMLButtonElement>(`button[aria-label="Close ${label} relation help"]`);
  if (!keep || !close) throw new Error('Relation actions missing'); await act(async () => keep.click()); await act(async () => close.click());
}
async function apply() { const button = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Apply'); if (!button) throw new Error('Apply missing'); await act(async () => button.click()); }
describe('editing consumed feature inputs', () => {
  it.each(['loft', 'transform'] satisfies ('loft' | 'transform')[])('shows a suppressed %s stored body truthfully and permits an explicit replacement', async kind => {
    const base = part('move'); const sketch = base.features[0], pad = base.features[1], move = base.features[2];
    if (sketch.kind !== 'sketch' || pad.kind !== 'extrude' || move.kind !== 'transform') throw new Error('Fixture inputs missing');
    const feature: CadFeature = kind === 'loft'
      ? { id: 'result', name: 'Dormant loft', kind, suppressed: true, sketchIds: ['sketch', 'top'], ruled: false, operation: 'join', targetId: 'pad' }
      : { ...move, suppressed: true };
    const initial = parseCadDocument({ ...base, features: [sketch, { ...pad, suppressed: true }, { ...sketch, id: 'top', name: 'Top', offset: 20 },
      { ...pad, id: 'other', name: 'Other body' }, feature] });
    const session = await mount(initial); const before = session.getSnapshot();
    const field = [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.textContent === (kind === 'loft' ? 'Target body' : 'Body'))?.querySelector('select');
    if (!field) throw new Error('Body selector missing');
    expect(field.value).toBe('pad'); expect(field.selectedOptions[0].textContent).toBe('Pad (unavailable)'); expect(field.selectedOptions[0].disabled).toBe(true);
    expect(field.querySelector<HTMLOptionElement>('option[value="other"]')?.disabled).toBe(false);
    expect(session.getSnapshot()).toBe(before);
    if (kind === 'transform') await editScalar('X', 'step / 2');
    else { const transition = container.querySelector<HTMLSelectElement>('select[aria-label="Transition"]'); if (!transition) throw new Error('Transition missing'); await act(async () => { transition.value = 'ruled'; transition.dispatchEvent(new Event('change', { bubbles: true })); }); }
    await apply();
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject(kind === 'loft' ? { targetId: 'pad', suppressed: true } : { sourceId: 'pad', suppressed: true });
    await act(async () => { field.value = 'other'; field.dispatchEvent(new Event('change', { bubbles: true })); }); await apply();
    const updated = session.getSnapshot().document.features.at(-1); if (!updated) throw new Error('Updated feature missing');
    expect(updated).toMatchObject(kind === 'loft' ? { targetId: 'other' } : { sourceId: 'other' });
    await act(async () => session.edit([{ kind: 'update-feature', feature: { ...updated, suppressed: false } }]));
    expect(cadVisibleBodyIds(session.getSnapshot().document.features, session.getSnapshot().document)).toEqual(['result']);
  });
  it('preserves a pocket target from its preceding model state rather than final meshes', async () => {
    const session = await mount(part('pocket')); const before = session.getSnapshot();
    const target = [...container.querySelectorAll('select')].at(-1); expect(target?.value).toBe('pad'); expect(target?.querySelector('option[value="pad"]')).not.toBeNull();
    expect(cadVisibleBodyIds(before.document.features, before.document)).toEqual(['result']);
    await editScalar('Length', 'step / 2'); await apply(); expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ kind: 'extrude', targetId: 'pad', distance: 'step / 2' });
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
  });
  it('preserves a transform source through editing while new operations still require current visible bodies', async () => {
    const initial = part('move'); const session = await mount(initial); const before = session.getSnapshot();
    expect(container.querySelector('select')?.value).toBe('pad'); await editScalar('X', 'step'); await apply();
    expect(session.getSnapshot().document.features.at(-1)).toMatchObject({ kind: 'transform', sourceId: 'pad', translation: ['step', 0, 0] });
    await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
    const feature: CadFeature = { id: 'new', name: 'New move', kind: 'transform', suppressed: false, sourceId: 'result', translation: [0, 0, 0], rotation: [0, 0, 0] };
    await act(async () => root.render(<CadFeatureEditor key="new" feature={feature} document={initial} isNew currentBodyIds={['result']}
      onApply={vi.fn()} onCancel={vi.fn()} onPendingChange={vi.fn()} />));
    expect(container.querySelector('select')?.value).toBe('result'); expect(container.querySelector('option[value="pad"]')).toBeNull();
  });
});
