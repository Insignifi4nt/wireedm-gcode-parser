import { act, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature, CadScalar } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadFeatureEditor } from './CadFeatureEditor';
import { cadFeatureCandidateEdits, cadFeatureCandidateKey, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';
import { CadSession } from './cadSession';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function part(distance: CadScalar): CadDocument {
  return { ...createCadDocument('Scalar relations', 'scalar_relations'), parameters: { depth: 10 }, features: [
    { kind: 'sketch', id: 'outline', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }] },
    { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false, sketchId: 'outline', distance, symmetric: false, operation: 'new', targetId: null }
  ] };
}
function input(label = 'Length mm') { const control = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`); if (!control) throw new Error(`Missing ${label}`); return control; }
async function type(value: string, label = 'Length mm') {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { const control = input(label); setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
}
function button(label: string, scope: ParentNode = container) { const control = [...scope.querySelectorAll('button')].find(entry => entry.getAttribute('aria-label') === label || entry.textContent?.trim() === label); if (!control) throw new Error(`Missing ${label}`); return control; }
async function mount(distance: CadScalar, nativePreview = false, replacement?: CadFeature) {
  const initial = part(distance);
  const session = new CadSession(replacement ? { ...initial, features: [...initial.features, replacement] } : initial), before = session.getSnapshot(), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>(), applied = vi.fn();
  let publish: ((state: CadFeaturePreviewState) => void) | undefined;
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [state, setState] = useState<CadFeaturePreviewState>({ kind: 'idle' }), [visible, setVisible] = useState(true); publish = setState;
    return visible ? <CadFeatureEditor feature={snapshot.document.features[replacement ? 2 : 1]} document={snapshot.document} isNew={false} documentVersion={snapshot.version}
      onFeaturePreview={nativePreview ? preview : undefined} featurePreview={state} onPendingChange={session.setWorkflowOpen}
      onApply={(feature, parameters) => { applied(feature, parameters); session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters })); }}
      onCancel={() => { session.setWorkflowOpen(false); setVisible(false); }} /> : null;
  }
  await act(async () => root.render(<Harness />));
  const candidate = () => { const command = preview.mock.calls.at(-1)?.[0]; if (!command || command.kind !== 'candidate') throw new Error('Expected current candidate'); return command; };
  const ready = async (command: Extract<CadFeaturePreviewCommand, { kind: 'candidate' }>) => { await act(async () => publish?.({ kind: 'ready', owner: command.owner, baseVersion: command.expectedVersion, featureId: 'pad', candidateId: 'candidate', definitionKey: cadFeatureCandidateKey(command.edits), document: applyCadEdits(before.document, command.edits), result: { buildId: 'candidate', meshes: [], diagnostics: [], durationMs: 0 } })); };
  return { session, before, preview, applied, candidate, ready };
}

it.each([1.23456789012345, '1.23456789012345', ' 1.23456789012345e1 '])('preserves the exact literal %j and full precision when its displayed quantity is re-entered', async distance => {
  const { session, before, preview, applied } = await mount(distance, true), displayed = String(Number(distance));
  expect(input().value).toBe(displayed);
  await type(` ${displayed} `);
  expect(input().value).toBe(` ${displayed} `);
  expect(session.getSnapshot()).toEqual(before); expect(applied).not.toHaveBeenCalled();
  expect(preview.mock.calls.some(([command]) => command.kind === 'candidate')).toBe(false);
  expect(session.getSnapshot().document.features[1]).toMatchObject({ distance });
});

it('updates all Move inputs sharing a named driver together while retaining their exact bindings and full precision', async () => {
  const move = { id: 'move', name: 'Move', kind: 'transform', suppressed: false, sourceId: 'pad', translation: [' depth ', 'depth', 'depth * 2'], rotation: [0, 0, 0] } satisfies CadFeature;
  const { session, before, applied } = await mount('depth', false, move);
  expect(input('Translation X mm').value).toBe('10'); expect(input('Translation Y mm').value).toBe('10'); expect(input('Translation Z mm').value).toBe('20'); expect(input('Translation Z mm').readOnly).toBe(true);
  await type('12.3456789012345', 'Translation X mm');
  expect(input('Translation Y mm').value).toBe('12.3456789012345'); expect(input('Translation Z mm').value).toBe('24.691357802469');
  await type('13', 'Translation Y mm'); expect(input('Translation X mm').value).toBe('13'); expect(input('Translation Z mm').value).toBe('26');
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  await act(async () => button('Apply').click());
  expect(applied).toHaveBeenCalledExactlyOnceWith(move, { depth: 13 }); expect(session.getSnapshot().document.features).toEqual(before.document.features);
  expect(session.getSnapshot().document.parameters).toEqual({ depth: 13 });
  await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
});

it('derives a datum normal from the same provisional named rotation displayed in the form and preserves the original reference definition on Cancel', async () => {
  const datum = { id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [0, ' depth ', 0] } } satisfies CadFeature;
  const { session, before, applied } = await mount(10, false, datum);
  expect(input('Around Y deg').value).toBe('10'); expect(container.querySelector('.cad-topology-details dd')?.textContent).toBe('0.173648, 0, 0.984808');
  await type('90', 'Around Y deg');
  expect(container.querySelector('.cad-topology-details dd')?.textContent).toBe('1, 0, 0');
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  await act(async () => button('Cancel').click()); expect(session.getSnapshot()).toEqual(before); expect(applied).not.toHaveBeenCalled();
});

it('keeps an invalid numeric draft pending even when an older complete candidate is ready, and requires readiness for its corrected value', async () => {
  const { session, before, preview, applied, candidate, ready } = await mount(' depth ', true);
  await type('20'); const twenty = candidate(); await ready(twenty); expect(button('Apply').disabled).toBe(false);
  await type('-'); expect(input().value).toBe('-'); expect(input().getAttribute('aria-invalid')).toBe('true');
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'blocked', owner: twenty.owner, expectedVersion: twenty.expectedVersion, edits: twenty.edits }));
  await ready(twenty); expect(button('Apply').disabled).toBe(true);
  await act(async () => container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(applied).not.toHaveBeenCalled(); expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  await type('25'); const twentyFive = candidate(); expect(twentyFive.edits[1]).toEqual({ kind: 'set-parameter', name: 'depth', value: 25 });
  expect(cadFeatureCandidateKey(twentyFive.edits)).not.toBe(cadFeatureCandidateKey(twenty.edits));
  await ready(twenty); expect(button('Apply').disabled).toBe(true); await ready(twentyFive); expect(button('Apply').disabled).toBe(false);
  await act(async () => button('Cancel').click()); expect(session.getSnapshot()).toEqual(before); expect(applied).not.toHaveBeenCalled();
});

it('returns a named value draft to the exact accepted definition without creating an undo step or accepting a previous preview', async () => {
  const { session, before, applied, candidate, ready, preview } = await mount(' depth ', true);
  await type('20'); const twenty = candidate(); await ready(twenty); await type('10');
  expect(input().value).toBe('10'); expect(session.getSnapshot()).toEqual(before);
  expect(preview).toHaveBeenLastCalledWith({ kind: 'clear', owner: twenty.owner });
  await ready(twenty); expect(applied).not.toHaveBeenCalled(); expect(session.getSnapshot()).toEqual(before);
});

it('restores an independent literal representation when a numeric edit returns to its accepted quantity', async () => {
  const { session, before, applied, candidate, ready, preview } = await mount(' 1e1 ', true);
  await type('20'); const twenty = candidate(); await ready(twenty); await type('10');
  expect(input().value).toBe('10'); expect(session.getSnapshot()).toEqual(before);
  expect(preview).toHaveBeenLastCalledWith({ kind: 'clear', owner: twenty.owner });
  await ready(twenty); expect(applied).not.toHaveBeenCalled(); expect(session.getSnapshot().document.features[1]).toMatchObject({ distance: ' 1e1 ' });
});

it('keeps an intentional relation and unlink after numeric edits return to a former independent quantity', async () => {
  const { session, before } = await mount(' 1e1 ');
  await act(async () => button('Edit Length relation').click());
  const expression = document.querySelector<HTMLInputElement>('input[aria-label="Length expression"]'), setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  if (!expression) throw new Error('Missing relation field'); await act(async () => { setter.call(expression, 'depth / 2'); expression.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => button('Keep relation', document).click()); await act(async () => button('Use current value', document).click());
  await act(async () => button('Close Length relation help', document).click());
  expect(input().value).toBe('5'); await type('20'); await type('10');
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  await act(async () => button('Apply').click()); expect(session.getSnapshot().document.features[1]).toMatchObject({ distance: 10 });
  expect(session.getSnapshot().document.parameters).toEqual(before.document.parameters);
  await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document);
});

it('keeps a compound value read-only and detaches it only through the explicit relation action, with one reversible edit', async () => {
  const { session, before, applied } = await mount(' depth / 2 ');
  expect(input().value).toBe('5'); expect(input().readOnly).toBe(true); await type('20');
  expect(session.getSnapshot()).toEqual(before); expect(applied).not.toHaveBeenCalled();
  await act(async () => button('Edit Length relation').click());
  await act(async () => button('Use current value', document).click());
  await act(async () => button('Close Length relation help', document).click());
  expect(input().value).toBe('5'); expect(input().readOnly).toBe(false);
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  await act(async () => button('Apply').click());
  expect(session.getSnapshot().document.features[1]).toMatchObject({ distance: 5 }); expect(session.getSnapshot().document.parameters).toEqual({ depth: 10 });
  expect(session.getSnapshot()).toMatchObject({ canUndo: true, workflowOpen: false });
  await act(async () => session.undo()); expect(session.getSnapshot().document).toEqual(before.document); expect(session.getSnapshot().canUndo).toBe(false);
});
