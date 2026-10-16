import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits, type CadEdit } from '@/domain/cad/cadOperations';
import { pairedBoreMirrorPart } from '@/domain/cad/__tests__/cadSketchMirrorFixtures';
import { CadSketchMirrorEditor, type CadSketchMirrorInteraction } from './CadSketchMirrorEditor';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized.'); };
  const promise = new Promise<T>(complete => { resolve = complete; }); return { promise, resolve };
}
function button(label: string) {
  const found = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === label);
  if (!found) throw new Error(`Missing ${label} button.`); return found;
}
async function harness(prepare?: ComponentProps<typeof CadSketchMirrorEditor>['onPrepareEdits']) {
  const document = pairedBoreMirrorPart(), sketch = document.features[0];
  if (sketch.kind !== 'sketch') throw new Error('Bore sketch missing.');
  const editing = deferred<void>(), edit = vi.fn((_edits: readonly CadEdit[], _signal?: AbortSignal) => editing.promise);
  const preview = vi.fn(), interaction = vi.fn<(interaction: CadSketchMirrorInteraction | null) => void>(), cancelled = vi.fn(), accepted = vi.fn(), pending = vi.fn();
  let props: ComponentProps<typeof CadSketchMirrorEditor> = { document, documentVersion: 'one', sketch, entityIds: ['bore'], interactionLocked: false,
    onEditMany: edit, onPrepareEdits: prepare ?? (async edits => applyCadEdits(document, edits)), onPreviewDocument: preview,
    onInteractionChange: interaction, onPendingChange: pending, onCancel: cancelled, onAccepted: accepted };
  const render = async (next: Partial<typeof props> = {}) => { props = { ...props, ...next }; await act(async () => root.render(<CadSketchMirrorEditor {...props} />)); };
  const pick = async () => {
    const offered = interaction.mock.calls.at(-1)?.[0];
    if (offered?.kind !== 'choose-line') throw new Error('Line picker unavailable.');
    await act(async () => offered.pick.onPick('axis'));
    await act(async () => vi.advanceTimersByTimeAsync(100));
  };
  await render(); return { document, editing, edit, preview, interaction, cancelled, accepted, pending, render, pick };
}

it('clears preview before re-picking, ignores the old result, and accepts its own successful publication', async () => {
  const requests: { edits: readonly CadEdit[]; signal: AbortSignal; result: ReturnType<typeof deferred<CadDocument>> }[] = [];
  const h = await harness((edits, signal) => { const result = deferred<CadDocument>(); requests.push({ edits, signal, result }); return result.promise; });
  await h.pick(); expect(requests).toHaveLength(1); expect(button('Apply').disabled).toBe(true);
  await act(async () => button('Change line').click());
  expect(requests[0].signal.aborted).toBe(true); expect(h.preview).toHaveBeenLastCalledWith(null); expect(h.interaction.mock.calls.at(-1)?.[0]?.kind).toBe('choose-line');
  await act(async () => requests[0].result.resolve(applyCadEdits(h.document, requests[0].edits)));
  expect(h.preview).toHaveBeenLastCalledWith(null); expect(h.edit).not.toHaveBeenCalled();
  await h.pick(); const candidate = applyCadEdits(h.document, requests[1].edits);
  await act(async () => requests[1].result.resolve(candidate)); expect(button('Apply').disabled).toBe(false);
  expect(h.preview).toHaveBeenLastCalledWith(candidate);
  await act(async () => button('Apply').click()); expect(h.edit).toHaveBeenCalledExactlyOnceWith(requests[1].edits, expect.any(AbortSignal));
  const sketch = candidate.features[0]; if (sketch.kind !== 'sketch') throw new Error('Prepared sketch missing.');
  await h.render({ document: candidate, documentVersion: 'two', sketch }); expect(h.cancelled).not.toHaveBeenCalled();
  await act(async () => h.editing.resolve(undefined)); expect(h.accepted).toHaveBeenCalledExactlyOnceWith([expect.stringMatching(/^mirror_.*_e0$/)]);
});

it('aborts an outstanding Apply after a foreign source change without publishing a late selection', async () => {
  const h = await harness(); await h.pick(); expect(button('Apply').disabled).toBe(false);
  await act(async () => button('Apply').click());
  const signal = h.edit.mock.calls[0]?.[1]; if (!(signal instanceof AbortSignal)) throw new Error('Submission signal missing.');
  await h.render({ document: { ...h.document, name: 'Changed elsewhere' }, documentVersion: 'two' });
  expect(signal.aborted).toBe(true); expect(h.cancelled).toHaveBeenCalledOnce();
  await act(async () => h.editing.resolve(undefined)); expect(h.accepted).not.toHaveBeenCalled();
});
