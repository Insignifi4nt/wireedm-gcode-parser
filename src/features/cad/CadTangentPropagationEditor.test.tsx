import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature } from '@/domain/cad/cadDocument';
import type { CadEdgeSelection } from '@/domain/cad/cadTopology';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { CadFeatureEditor } from './CadFeatureEditor';
import { CadSession } from './cadSession';
import { cadFeatureCandidateEdits, cadFeatureCandidateKey, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const plate = (): CadDocument => parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'plate', name: 'Bored plate', units: 'mm', parameters: { edgeSize: .5 }, features: [
  { id: 'profile', name: 'Plate profile', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'outer', name: 'Plate', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 80, height: 50, cornerRadius: 3 } },
    { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 40, y: 25, radius: 5 } },
  ] },
  { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'profile', distance: 10, symmetric: false, operation: 'new', targetId: null },
] });
const seed = (kind: 'fillet' | 'chamfer'): CadEdgeSelection => ({ expectedCount: 1, queries: [{ kind: 'edges', expectedCount: 1, predicates: kind === 'fillet'
  ? [{ kind: 'line-endpoints', start: [3, 0, 10], end: [77, 0, 10] }]
  : [{ kind: 'circle', center: [40, 25, 10], radius: 5, axis: [0, 0, 1] },
    { kind: 'arc-points', start: [45, 25, 10], end: [35, 25, 10], midpoint: [40, 30, 10] }] }] });
async function mount(session: CadSession, feature: CadFeature, isNew = true) {
  const base = session.getSnapshot(), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>(), applied = vi.fn();
  let publish: ((state: CadFeaturePreviewState) => void) | undefined;
  let changeVersion: ((version: string) => void) | undefined;
  function Harness() {
    const [visible, setVisible] = useState(true), [state, setState] = useState<CadFeaturePreviewState>({ kind: 'idle' }), [version, setVersion] = useState(base.version);
    publish = setState; changeVersion = setVersion;
    return visible ? <CadFeatureEditor feature={feature} document={base.document} isNew={isNew} documentVersion={version}
      onFeaturePreview={preview} featurePreview={state} onPendingChange={session.setWorkflowOpen}
      onCancel={() => { session.setWorkflowOpen(false); setVisible(false); }}
      onApply={(next, parameters) => { session.edit(cadFeatureCandidateEdits({ feature: next, isNew, parameters }), base.version); applied(next); session.setWorkflowOpen(false); setVisible(false); }} /> : null;
  }
  await act(async () => root.render(<Harness />));
  const candidate = () => { const command = preview.mock.calls.at(-1)?.[0]; if (!command || command.kind !== 'candidate') throw new Error('Expected owned candidate'); return command; };
  return { base, preview, applied, candidate, changeVersion: async (version: string) => act(async () => changeVersion?.(version)), ready: async (command = candidate()) => act(async () => publish?.({ kind: 'ready', owner: command.owner,
    baseVersion: command.expectedVersion, featureId: feature.id, candidateId: 'owned-candidate', definitionKey: cadFeatureCandidateKey(command.edits),
    document: applyCadEdits(base.document, command.edits), result: { buildId: 'owned-build', meshes: [], diagnostics: [], durationMs: 1 } })) };
}
const checkbox = () => { const input = container.querySelector<HTMLInputElement>('input[aria-label="Follow tangent edges"]'); if (!input) throw new Error('Missing tangent continuation control'); return input; };
const apply = () => { const button = container.querySelector<HTMLButtonElement>('button[type="submit"]'); if (!button) throw new Error('Missing Apply'); return button; };

it.each(['fillet', 'chamfer'] as const)('previews explicit %s continuation, cancels exactly and accepts it as one undoable feature', async kind => {
  const session = new CadSession(plate()), before = session.getSnapshot(), original = JSON.stringify(before.document);
  const feature: CadFeature = { kind, id: 'finished', name: kind, targetId: 'pad', suppressed: false, radius: ' edgeSize ', selection: seed(kind) };
  const first = await mount(session, feature);
  expect(checkbox().checked).toBe(false); expect(first.candidate().edits[0]).toEqual({ kind: 'add-feature', feature });
  await first.ready(); expect(apply().disabled).toBe(false);
  await act(async () => checkbox().click());
  const followed = first.candidate();
  expect(followed.edits[0]).toEqual({ kind: 'add-feature', feature: { ...feature, tangentPropagation: true } });
  expect(apply().disabled).toBe(true); // The older strict preview cannot authorize the changed chain intent.
  expect(container.textContent).toContain('Picked edges (1) + tangent chains');
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: true });
  const cancel = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Cancel'); if (!cancel) throw new Error('Missing Cancel');
  await act(async () => cancel.click());
  expect(first.preview).toHaveBeenLastCalledWith({ kind: 'clear', owner: followed.owner });
  expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, workflowOpen: false });
  expect(JSON.stringify(session.getSnapshot().document)).toBe(original);
  const second = await mount(session, feature);
  await act(async () => checkbox().click()); await second.ready();
  await act(async () => apply().click());
  expect(second.applied).toHaveBeenCalledOnce();
  const accepted = session.getSnapshot(); expect(accepted.document.features.at(-1)).toEqual({ ...feature, tangentPropagation: true });
  expect(accepted).toMatchObject({ canUndo: true, workflowOpen: false });
  expect(accepted.document.features.slice(0, 2)).toEqual(before.document.features); expect(accepted.document.parameters).toEqual(before.document.parameters);
  await act(async () => session.undo()); expect(JSON.stringify(session.getSnapshot().document)).toBe(original); expect(session.getSnapshot().canUndo).toBe(false);
  await act(async () => session.redo()); expect(session.getSnapshot().document).toEqual(accepted.document);
});

it.each(['absent', 'false before selection', 'false after selection', 'true before selection', 'true after selection'] as const)('returns a toggle roundtrip to accepted %s intent and clears it when selecting all body edges', async policy => {
  const stored = policy === 'absent' ? undefined : policy.startsWith('true');
  const feature: CadFeature = { kind: 'chamfer', id: 'finished', name: 'Chamfer', targetId: 'pad', suppressed: false, radius: .5,
    ...(stored !== undefined && policy.includes('before') ? { tangentPropagation: stored } : {}), selection: seed('chamfer'),
    ...(stored !== undefined && policy.includes('after') ? { tangentPropagation: stored } : {}) };
  const session = new CadSession({ ...plate(), features: [...plate().features, feature] });
  const editor = await mount(session, session.getSnapshot().document.features.at(-1)!, false);
  expect(session.getSnapshot().workflowOpen).toBe(false);
  await act(async () => checkbox().click()); expect(checkbox().checked).toBe(stored !== true); editor.candidate();
  await act(async () => checkbox().click());
  expect(editor.preview).toHaveBeenLastCalledWith({ kind: 'clear', owner: expect.any(String) });
  expect(session.getSnapshot().workflowOpen).toBe(false); expect(session.getSnapshot().canUndo).toBe(false);
  await act(async () => checkbox().click());
  const scope = container.querySelector<HTMLSelectElement>('select[aria-label="Scope"]'); if (!scope) throw new Error('Missing edge scope');
  await act(async () => { scope.value = 'all'; scope.dispatchEvent(new Event('change', { bubbles: true })); });
  const { tangentPropagation: _flag, ...strict } = feature;
  expect(editor.candidate().edits[0]).toEqual({ kind: 'update-feature', feature: { ...strict, selection: null } });
  await editor.ready(); await act(async () => apply().click());
  expect(session.getSnapshot().document.features.at(-1)).toEqual({ ...strict, selection: null });
});

it('keeps tangent continuation gated by the current preview owner and accepted document version', async () => {
  const session = new CadSession(plate()), feature: CadFeature = { kind: 'chamfer', id: 'finished', name: 'Chamfer', targetId: 'pad', suppressed: false, radius: .5, selection: seed('chamfer') };
  const editor = await mount(session, feature);
  await act(async () => checkbox().click());
  const command = editor.candidate();
  await editor.ready({ ...command, owner: 'other-editor' }); expect(apply().disabled).toBe(true);
  await editor.ready(command); expect(apply().disabled).toBe(false);
  await act(async () => session.replace({ ...session.getSnapshot().document, name: 'Replaced part' }));
  const replacement = session.getSnapshot(); await editor.changeVersion(replacement.version);
  expect(checkbox().matches(':disabled')).toBe(true); expect(apply().disabled).toBe(true);
  await act(async () => apply().click());
  expect(editor.applied).not.toHaveBeenCalled(); expect(session.getSnapshot()).toBe(replacement);
  expect(container.textContent).toContain('The part changed');
});
