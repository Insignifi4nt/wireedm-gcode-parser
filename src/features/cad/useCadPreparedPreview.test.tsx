import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';

const source = () => parseCadDocument({ ...createCadDocument('Line', 'line'), schemaVersion: 2, features: [{
  id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }],
    entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }], relations: []
  }
}] });
const edits: readonly CadEdit[] = [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'attempt', kind: 'distance', pointIds: ['a', 'b'], value: 20 } }];

let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('prepared sketch preview feedback ownership', () => {
  it('publishes the current candidate structured rejection without flattening its subjects', async () => {
    const document = source(), sketch = document.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing graph fixture.');
    const failure = new CadSketchPreparationError({ sketchId: sketch.id, sketchName: sketch.name, graph: sketch.graph,
      rejection: { kind: 'rejected', reason: 'conflicting', message: 'Native conflict', diagnostics: {
        status: 'success', degreesOfFreedom: 0, conflictingIds: ['a'], redundantIds: [], partiallyRedundantIds: [], issues: []
      } } });
    const prepare = vi.fn<CadPrepareEdits>(async () => { throw failure; });
    const observed: { current: ReturnType<typeof useCadPreparedPreview> | null } = { current: null };
    function Probe() { observed.current = useCadPreparedPreview(document, edits, prepare, true); return null; }
    await act(async () => root.render(<Probe />));
    expect(observed.current).toEqual({ kind: 'waiting' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(observed.current).toEqual({ kind: 'error', message: failure.message, feedback: failure.feedback });
    expect(prepare).toHaveBeenCalledOnce();
  });

  it.each(['document', 'edits'] as const)('discards late feedback after the owning %s changes or the preview is disabled', async owner => {
    const document = source(), other = parseCadDocument({ ...document, name: 'Next source' });
    const otherEdits: readonly CadEdit[] = [{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'attempt', kind: 'distance', pointIds: ['a', 'b'], value: 30 } }];
    const requests: { signal: AbortSignal; reject: (error: unknown) => void }[] = [];
    const prepare: CadPrepareEdits = (_edits, signal) => new Promise<CadDocument>((_resolve, reject) => { requests.push({ signal, reject }); });
    const observed: { current: ReturnType<typeof useCadPreparedPreview> | null } = { current: null };
    function Probe({ source, edits, enabled = true }: { source: CadDocument; edits: readonly CadEdit[]; enabled?: boolean }) {
      observed.current = useCadPreparedPreview(source, edits, prepare, enabled); return null;
    }
    await act(async () => root.render(<Probe source={document} edits={edits} />));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(requests).toHaveLength(1);
    const nextSource = owner === 'document' ? other : document, nextEdits = owner === 'edits' ? otherEdits : edits;
    await act(async () => root.render(<Probe source={nextSource} edits={nextEdits} />));
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => { requests[0].reject(new Error('Unaccepted old result')); });
    expect(observed.current).toEqual({ kind: 'waiting' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(requests).toHaveLength(2);
    await act(async () => root.render(<Probe source={nextSource} edits={nextEdits} enabled={false} />));
    expect(requests[1].signal.aborted).toBe(true);
    await act(async () => { requests[1].reject(new Error('Unaccepted disabled result')); });
    expect(observed.current).toEqual({ kind: 'idle' });
  });
});
