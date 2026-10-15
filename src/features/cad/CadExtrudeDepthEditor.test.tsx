import { act, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDocument, CadScalar } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { CadFeatureEditor } from './CadFeatureEditor';
import { CadSession } from './cadSession';
import { cadFeatureCandidateEdits, cadFeatureCandidateKey, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';
import type { CadExtrudeDepthControl } from './cadExtrudeDepthInteraction';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function part(distance: CadScalar = ' depth ', offset: CadScalar = 0): CadDocument {
  return { ...createCadDocument('Linked depth', 'depth_editor'), parameters: { depth: 10 }, features: [
    { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset, profiles: [
      { id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance, symmetric: false, operation: 'new', targetId: null },
    { id: 'move', name: 'Move', kind: 'transform', suppressed: false, sourceId: 'pad', translation: [0, 0, 'depth'], rotation: [0, 0, 0] }
  ] };
}
function length() { const input = container.querySelector<HTMLInputElement>('[aria-label="Length mm"]'); if (!input) throw new Error('Missing Length'); return input; }
function button(label: string) { const control = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label); if (!control) throw new Error(`Missing ${label}`); return control; }
async function type(text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(length(), text); length().dispatchEvent(new Event('input', { bubbles: true })); }); }
async function mount(document = part()) {
  const session = new CadSession(document), before = session.getSnapshot(), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>();
  let depth: CadExtrudeDepthControl | null = null, publish: ((state: CadFeaturePreviewState) => void) | undefined;
  let setEnabled: ((enabled: boolean) => void) | undefined;
  const controls = (next: CadExtrudeDepthControl | null, released?: CadExtrudeDepthControl) => { if (next || depth === released) depth = next; };
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [state, setState] = useState<CadFeaturePreviewState>({ kind: 'idle' }),
      [enabled, updateEnabled] = useState(true), [visible, setVisible] = useState(true); publish = setState; setEnabled = updateEnabled;
    return visible ? <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} documentVersion={snapshot.version} isNew={false} previewEnabled={enabled}
      featurePreview={state} onFeaturePreview={preview} onDepthInteractionReady={controls} onPendingChange={session.setWorkflowOpen}
      onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters }))}
      onCancel={() => { session.setWorkflowOpen(false); setVisible(false); }} /> : null;
  }
  await act(async () => root.render(<Harness />));
  const control = () => { if (!depth) throw new Error('Missing depth control'); return depth; };
  const candidate = () => { const command = preview.mock.calls.at(-1)?.[0]; if (!command || command.kind !== 'candidate') throw new Error('Missing current candidate'); return command; };
  const ready = async (command = candidate()) => act(async () => publish?.({ kind: 'ready', owner: command.owner, baseVersion: command.expectedVersion, featureId: 'pad',
    candidateId: crypto.randomUUID(), definitionKey: cadFeatureCandidateKey(command.edits), document: applyCadEdits(session.getSnapshot().document, command.edits),
    result: { buildId: crypto.randomUUID(), meshes: [], diagnostics: [], durationMs: 0 } }));
  const begin = async () => { let token: string | null = null; await act(async () => { const state = control().getState(); if (!state) throw new Error('Missing depth state'); token = control().begin(state.definitionKey); }); if (!token) throw new Error('Gesture refused'); return token; };
  return { session, before, preview, control, candidate, ready, begin, setEnabled: async (enabled: boolean) => act(async () => setEnabled?.(enabled)) };
}

it('owns a provisional named-depth gesture, retains the exact alias and correlated Move, then accepts one Undo step only after release and current preview', async () => {
  const h = await mount(), initial = h.control(), changed = vi.fn(), unsubscribe = initial.subscribe(changed), token = await h.begin();
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
  await act(async () => expect(initial.setQuantity(token, 20)).toBe(true));
  expect(length().value).toBe('20'); expect(h.control()).toBe(initial); expect(changed).toHaveBeenCalled();
  const command = h.candidate(); expect(command.edits).toEqual([{ kind: 'update-feature', feature: h.before.document.features[1] }, { kind: 'set-parameter', name: 'depth', value: 20 }]);
  await h.ready(command); expect(button('Apply').disabled).toBe(true);
  await act(async () => expect(initial.release(token)).toBe(true)); expect(button('Apply').disabled).toBe(false);
  await act(async () => button('Apply').click());
  expect(h.session.getSnapshot().document.features).toEqual(h.before.document.features); expect(h.session.getSnapshot().document.parameters.depth).toBe(20);
  await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toEqual(h.before.document); expect(h.session.getSnapshot().canUndo).toBe(false);
  unsubscribe();
});

it('cancels back to the precise starting provisional batch rather than losing a previous typed edit', async () => {
  const h = await mount(); await type('20'); await h.ready(); const beforeDrag = h.control().getState()?.definitionKey, token = await h.begin();
  await act(async () => h.control().setQuantity(token, 35)); expect(length().value).toBe('35');
  await act(async () => h.control().cancel(token)); expect(length().value).toBe('20');
  expect(h.control().getState()?.definitionKey).toBe(beforeDrag); expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
  expect(h.candidate().edits[1]).toEqual({ kind: 'set-parameter', name: 'depth', value: 20 });
});

it('keeps an invalid latest depth pending after release and cannot authorize it with an older ready preview', async () => {
  const h = await mount(), token = await h.begin(); await act(async () => h.control().setQuantity(token, 20)); const twenty = h.candidate(); await h.ready(twenty);
  await act(async () => h.control().setQuantity(token, Infinity)); expect(length().getAttribute('aria-invalid')).toBe('true');
  await act(async () => h.control().release(token)); await h.ready(twenty); expect(button('Apply').disabled).toBe(true);
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false });
});

it('rejects stale candidate starts, expired tokens and an accepted-version replacement without promoting a gesture', async () => {
  const h = await mount(), control = h.control(); expect(control.begin('obsolete')).toBeNull(); const token = await h.begin();
  await act(async () => control.setQuantity(token, 20)); await act(async () => control.cancel(token));
  expect(control.setQuantity(token, 30)).toBe(false); expect(h.session.getSnapshot()).toEqual(h.before);
  const later = await h.begin(); await act(async () => h.session.replace({ ...h.before.document, name: 'Replaced part' }));
  expect(control.setQuantity(later, 30)).toBe(false); expect(h.session.getSnapshot().document.parameters.depth).toBe(10);
  expect(h.session.getSnapshot().document.name).toBe('Replaced part'); expect(h.session.getSnapshot().canUndo).toBe(false);
});

it.each(['depth / 2', ' depth '])('publishes locked %s depth geometry while leaving correlated numeric editing accurate', async distance => {
  const h = await mount(part(distance, distance === ' depth ' ? 'depth' : 0)), state = h.control().getState();
  expect(state?.capability.kind).toBe('locked'); expect(h.control().begin(state?.definitionKey ?? '')).toBeNull();
  if (distance === ' depth ') { expect(length().readOnly).toBe(false); await type('20'); expect(h.control().getState()?.model.endMm).toEqual([0, 0, 40]); }
  else expect(length().readOnly).toBe(true);
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false });
});

it('returns an unchanged high-precision literal gesture without creating a candidate or history', async () => {
  const source = ' 1.23456789012345e1 ', h = await mount(part(source)), token = await h.begin();
  await act(async () => h.control().setQuantity(token, Number(source))); await act(async () => h.control().release(token));
  expect(h.preview.mock.calls.some(([command]) => command.kind === 'candidate')).toBe(false); expect(h.session.getSnapshot()).toEqual(h.before);
  expect(h.session.getSnapshot().document.features[1]).toMatchObject({ distance: source });
});

it('restores the starting draft on interaction disable and does not let a late gesture continue', async () => {
  const h = await mount(); await type('20'); await h.ready(); const control = h.control(), token = await h.begin();
  await act(async () => control.setQuantity(token, 35)); await h.setEnabled(false);
  expect(length().value).toBe('20'); expect(control.getState()?.gestureActive).toBe(false); expect(control.setQuantity(token, 40)).toBe(false);
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
});

it('allows the owned gesture to cross a pending zero into a valid negative signed depth, but cannot apply zero or a previous ready result', async () => {
  const h = await mount(), token = await h.begin(); await act(async () => h.control().setQuantity(token, 20)); const twenty = h.candidate(); await h.ready(twenty);
  await act(async () => h.control().setQuantity(token, 0)); await h.ready(twenty); expect(button('Apply').disabled).toBe(true);
  await act(async () => h.control().setQuantity(token, -5)); const negative = h.candidate(); await h.ready(negative);
  expect(h.control().getState()?.model.endMm).toEqual([0, 0, -5]); await act(async () => h.control().release(token));
  await act(async () => button('Apply').click()); expect(h.session.getSnapshot().document.parameters.depth).toBe(-5);
  expect(h.session.getSnapshot().document.features[1]).toMatchObject({ distance: ' depth ' });
});

it('disposes its gesture and clears its preview on full feature Cancel without touching the accepted draft', async () => {
  const h = await mount(), control = h.control(), token = await h.begin(); await act(async () => control.setQuantity(token, 20));
  await act(async () => button('Cancel').click());
  expect(control.getState()).toBeNull(); expect(control.setQuantity(token, 30)).toBe(false); expect(h.session.getSnapshot()).toEqual(h.before);
  expect(h.preview).toHaveBeenLastCalledWith({ kind: 'clear', owner: control.owner });
});
