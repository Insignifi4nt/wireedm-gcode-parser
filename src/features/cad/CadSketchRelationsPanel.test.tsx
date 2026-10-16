import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { CadSession } from './cadSession';
import { CadSketchRelationsPanel, type CadSketchRelationsPanelProps } from './CadSketchRelationsPanel';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { CadSketchPreparationError } from './cadSketchConstraintFeedback';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

const selectionSet = (selection: CadSketchGraphSelection | readonly CadSketchGraphSelection[]) => 'kind' in selection ? [selection] : selection;
async function mount(document: CadDocument, initial: CadSketchGraphSelection | readonly CadSketchGraphSelection[], overrides: Partial<Pick<CadSketchRelationsPanelProps, 'onEditMany' | 'onPrepareEdits' | 'initialCommand'>> = {}) {
  const session = new CadSession(document), preview = vi.fn(), inspect = vi.fn(), inspectSubject = vi.fn(), pending = vi.fn((open: boolean) => session.setWorkflowOpen(open));
  let selection = selectionSet(initial);
  const edit = vi.fn<NonNullable<CadSketchRelationsPanelProps['onEditMany']>>((edits, signal) => { signal?.throwIfAborted(); return session.edit(edits); });
  const prepare = vi.fn<NonNullable<CadSketchRelationsPanelProps['onPrepareEdits']>>(async (edits, signal) => { signal.throwIfAborted(); return applyCadEdits(session.getSnapshot().document, edits); });
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = snapshot.document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Sketch fixture missing.');
    return <CadSketchRelationsPanel document={snapshot.document} sketch={sketch} selection={selection} onEditMany={edit} onPrepareEdits={prepare}
      onPreviewDocument={preview} onInspectRelation={inspect} onInspectSubject={inspectSubject} onPendingChange={pending} interactionLocked={false} cancelSignal={0} {...overrides} />;
  }
  const render = async (next: CadSketchGraphSelection | readonly CadSketchGraphSelection[] = selection) => { selection = selectionSet(next); await act(async () => root.render(<Harness />)); };
  await render();
  return { session, preview, inspect, inspectSubject, pending, edit, prepare, render };
}
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === name || button.textContent?.trim() === name);
  if (!found) throw new Error(`Missing button ${name}`); return found;
}
async function click(name: string) { await act(async () => button(name).click()); }
async function clickRelation(action: 'Inspect' | 'Remove', label: string, ordinal: number) {
  const control = [...container.querySelectorAll<HTMLButtonElement>('button')].find(control => control.getAttribute('aria-label')?.startsWith(`${action} ${label} relation ${ordinal} · `));
  if (!control) throw new Error(`Missing ${action} ${label} relation ${ordinal}`);
  await act(async () => control.click());
}
function field(name: string) { const found = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`); if (!found) throw new Error(`Missing input ${name}`); return found; }
async function input(name: string, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Native input setter missing.');
  await act(async () => { const control = field(name); setter.call(control, value); control.dispatchEvent(new Event('input', { bubbles: true })); });
}
const circleDocument = () => parseCadDocument({ ...createCadDocument('Circles', 'circles'), schemaVersion: 2, parameters: { radius: 5 }, features: [{
  id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'center', position: ['0', '0'] }], relations: [], entities: [
      { id: 'circle', kind: 'circle', centerPointId: 'center', radius: ' radius ', construction: false },
      { id: 'linked', kind: 'circle', centerPointId: 'center', radius: 'radius * 2', construction: true }
    ]
  }
}] });
const lineDocument = () => parseCadDocument({ ...createCadDocument('Line', 'line'), schemaVersion: 2, features: [{
  id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [0, 10] }],
    entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
    relations: [{ id: 'vertical', kind: 'vertical', pointIds: ['a', 'b'] }]
  }
}] });

describe('selected sketch entity relations', () => {
  it('authors a radial dimension with an explicit quantity, previews privately and releases it without changing source geometry', async () => {
    const source = parseCadDocument({ ...createCadDocument('Radial size', 'radial-size'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'center', position: [' 0 ', '0'] }], entities: [{ id: 'circle', kind: 'circle', centerPointId: 'center', radius: 5, construction: false }], relations: []
      }
    }] });
    const h = await mount(source, { kind: 'entity', id: 'circle' }, { initialCommand: { kind: 'radial-size' } });
    expect(field('Diameter mm').value).toBe('10');
    const quantity = container.querySelector<HTMLSelectElement>('select[aria-label="Dimension quantity"]');
    if (!quantity) throw new Error('Missing radial quantity selector.');
    await act(async () => { quantity.value = 'radius'; quantity.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(field('Radius mm').value).toBe('5');
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
    await click('Apply'); const accepted = h.session.getSnapshot().document, sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing accepted graph.');
    const relation = sketch.graph.relations[0];
    expect(relation).toMatchObject({ kind: 'radial-size', entityId: 'circle', quantity: 'radius', value: 5 });
    expect(sketch.graph.entities).toEqual(source.features[0].kind === 'sketch' ? source.features[0].graph?.entities : undefined);
    await clickRelation('Remove', 'Radius', 1); await click('Restore radius');
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edit).toHaveBeenCalledOnce();
    await clickRelation('Remove', 'Radius', 1); await click('Cancel'); expect(h.session.getSnapshot().document).toBe(accepted);
    await clickRelation('Remove', 'Radius', 1); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { entities: sketch.graph.entities, relations: [] } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(accepted);
  });

  it('opens an existing circle expression driver without silently transferring it into a redundant dimension', async () => {
    const source = circleDocument(), h = await mount(source, { kind: 'entity', id: 'circle' }, { initialCommand: { kind: 'radial-size' } });
    expect(field('Radius mm').value).toBe('5'); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.session.getSnapshot().document).toBe(source); expect(h.edit).not.toHaveBeenCalled();
  });

  it.each(['parallel', 'perpendicular'] as const)('authors a %s line pair as one cancellable edit and restores its exact accepted relation', async kind => {
    const source = parseCadDocument({ ...createCadDocument('Line pair', 'line-pair'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [20, 0] },
          { id: 'c', position: kind === 'parallel' ? [0, 10] : [20, 10] }, { id: 'd', position: [20, 10] }],
        entities: [{ id: 'first', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
          { id: 'second', kind: 'line', startPointId: kind === 'parallel' ? 'c' : 'b', endPointId: kind === 'parallel' ? 'd' : 'c', construction: true }], relations: []
      }
    }] });
    const label = kind === 'parallel' ? 'Parallel' : 'Perpendicular', opposite = kind === 'parallel' ? 'Perpendicular' : 'Parallel';
    const h = await mount(source, [{ kind: 'entity', id: 'second' }, { kind: 'entity', id: 'first' }]);
    await act(async () => field(label).click());
    expect(field(opposite).disabled).toBe(true);
    await click('Cancel'); expect(h.session.getSnapshot().document).toBe(source); expect(h.edit).not.toHaveBeenCalled();
    await act(async () => field(label).click());
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ graph: expect.objectContaining({
      relations: [expect.objectContaining({ kind, lineIds: ['second', 'first'] })]
    }) })] }));
    await click('Apply');
    const accepted = h.session.getSnapshot().document, sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing accepted graph.');
    const relation = sketch.graph.relations[0];
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'set-sketch-relation', sketchId: 'sketch', relation }], expect.any(AbortSignal));
    expect(sketch.graph.points).toEqual(source.features[0].kind === 'sketch' ? source.features[0].graph?.points : undefined);
    await clickRelation('Inspect', label, 1); expect(h.inspect).toHaveBeenLastCalledWith(relation);
    await act(async () => field(label).click()); await act(async () => field(label).click());
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edit).toHaveBeenCalledOnce();
    await act(async () => field(label).click()); expect(field(opposite).disabled).toBe(false); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { relations: [] } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(accepted);
  });

  it('adds and releases declared coincidence without merging point identities, and restores the accepted relation exactly', async () => {
    const source = parseCadDocument({ ...createCadDocument('Joined points', 'joined-points'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', ' 0 '] }, { id: 'b', position: [0, 0] }], entities: [], relations: []
      }
    }] });
    const h = await mount(source, [{ kind: 'point', id: 'b' }, { kind: 'point', id: 'a' }]);
    await act(async () => field('Coincident').click());
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ graph: {
      points: [{ id: 'a', position: [' 0 ', ' 0 '] }, { id: 'b', position: [0, 0] }], entities: [],
      relations: [expect.objectContaining({ kind: 'coincident', pointIds: ['b', 'a'] })]
    } })] }));
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
    await click('Apply'); const accepted = h.session.getSnapshot().document;
    await act(async () => field('Coincident').click()); await act(async () => field('Coincident').click());
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edit).toHaveBeenCalledOnce();
    await act(async () => field('Coincident').click()); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { points: [{ id: 'a', position: [' 0 ', ' 0 '] }, { id: 'b', position: [0, 0] }], relations: [] } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(accepted);
  });

  it.each(['cancel', 'source change', 'other sketch'] as const)('inspects rejected candidate operands without changing the exact draft, and handles %s', async ending => {
    const source = lineDocument(), sketch = source.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing graph.');
    const graph = sketch.graph;
    const prepare = vi.fn<NonNullable<CadSketchRelationsPanelProps['onPrepareEdits']>>(async edits => {
      const edit = edits.find(edit => edit.kind === 'set-sketch-relation');
      if (edit?.kind !== 'set-sketch-relation') throw new Error('Missing attempted relation.');
      throw new CadSketchPreparationError({ sketchId: ending === 'other sketch' ? 'other-sketch' : sketch.id, sketchName: sketch.name, graph: { ...graph, relations: [...graph.relations, edit.relation] },
        rejection: { kind: 'rejected', reason: 'conflicting', message: `Failure in ${edit.relation.id}`, diagnostics: {
          status: 'failed', degreesOfFreedom: null, conflictingIds: [edit.relation.id], redundantIds: [], partiallyRedundantIds: [], issues: []
        } } });
    });
    const h = await mount(source, { kind: 'entity', id: 'line' }, { initialCommand: { kind: 'length' }, onPrepareEdits: prepare });
    await input('Length mm', '12.5000');
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    const subject = container.querySelector<HTMLButtonElement>('[data-cad-diagnostic-source]');
    expect(subject).not.toBeNull();
    if (ending === 'other sketch') {
      expect(subject!.disabled).toBe(true); await act(async () => subject!.click());
      expect(h.inspectSubject).toHaveBeenLastCalledWith(null); expect(field('Length mm').value).toBe('12.5000');
      await click('Cancel'); expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
      return;
    }
    await act(async () => subject!.click());
    expect(h.inspectSubject).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'conflicting', source: { kind: 'relation', id: expect.any(String) }, pointIds: ['a', 'b'] }));
    expect(field('Length mm').value).toBe('12.5000'); expect(button('Apply').disabled).toBe(true);
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false }); expect(h.edit).not.toHaveBeenCalled();
    if (ending === 'source change') {
      await act(async () => h.session.edit([{ kind: 'rename-document', name: 'Current source' }]));
      expect(h.inspectSubject).toHaveBeenLastCalledWith(null); expect(container.querySelector('[data-cad-diagnostic-source]')).toBeNull();
      expect(h.session.getSnapshot().document.name).toBe('Current source');
      await click('Cancel');
      expect(h.session.getSnapshot().document.features).toEqual(source.features);
      return;
    }
    await click('Cancel');
    expect(h.inspectSubject).toHaveBeenLastCalledWith(null); expect(container.querySelector('[data-cad-diagnostic-source]')).toBeNull();
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
  });

  it('aborts the old pair owner on selection change without clearing a mixed selection relation draft', async () => {
    let resolve: () => void = () => { throw new Error('No pending pair application.'); };
    const pending = new Promise<void>(accept => { resolve = accept; });
    const edit = vi.fn<CadSketchRelationsPanelProps['onEditMany']>().mockReturnValueOnce(pending);
    const source = lineDocument();
    const h = await mount(source, [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }], {
      initialCommand: { kind: 'distance' }, onEditMany: edit
    });
    await click('Apply'); const signal = edit.mock.calls[0]?.[1];
    expect(signal?.aborted).toBe(false);
    await h.render([{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'line' }]);
    expect(signal?.aborted).toBe(true);
    await clickRelation('Inspect', 'Vertical', 1);
    expect(h.inspect).toHaveBeenLastCalledWith({ id: 'vertical', kind: 'vertical', pointIds: ['a', 'b'] });
    await clickRelation('Remove', 'Vertical', 1);
    await act(async () => resolve());
    expect(h.pending).toHaveBeenLastCalledWith(true); expect(button('Apply').disabled).toBe(false);
    expect(container.querySelector('input[aria-label="Distance mm"]')).toBeNull();
    expect(container.querySelector('input[aria-label="Fix X"]')).toBeNull();
    expect(h.session.getSnapshot().document).toBe(source);
    edit.mockImplementationOnce((edits, signal) => { signal?.throwIfAborted(); return h.session.edit(edits); });
    await click('Apply');
    expect(edit).toHaveBeenLastCalledWith([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'vertical' }], expect.any(AbortSignal));
    await act(async () => h.session.undo()); expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
  });

  it.each(['horizontal', 'vertical'] as const)('previews pair %s alignment and rejects an opposite relation without replacing accepted drivers', async kind => {
    const source = parseCadDocument({ ...createCadDocument('Aligned pair', 'aligned-pair'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: kind === 'horizontal' ? ['10', '0'] : ['0', '10'] }], entities: [], relations: []
      }
    }] });
    const label = kind === 'horizontal' ? 'Horizontal' : 'Vertical', opposite = kind === 'horizontal' ? 'Vertical' : 'Horizontal';
    const h = await mount(source, [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }]);
    await act(async () => field(label).click());
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ graph: expect.objectContaining({
      relations: [expect.objectContaining({ kind, pointIds: ['a', 'b'] })]
    }) })] }));
    expect(h.session.getSnapshot().document).toBe(source);
    await click('Apply'); const accepted = h.session.getSnapshot().document;
    await act(async () => field(opposite).click());
    expect(field(label).checked).toBe(true); expect(field(opposite).checked).toBe(true);
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.prepare).toHaveBeenLastCalledWith([{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({
      kind: kind === 'horizontal' ? 'vertical' : 'horizontal', pointIds: ['a', 'b']
    }) }], expect.any(AbortSignal));
    expect(button('Apply').disabled).toBe(true); expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(h.session.getSnapshot().document).toBe(accepted); expect(h.edit).toHaveBeenCalledTimes(1);
    await click('Cancel'); expect(field(label).checked).toBe(true); expect(field(opposite).checked).toBe(false);
    await act(async () => h.session.undo()); expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
  });

  it('authors an arbitrary point-pair distance through fx, cancels trials and preserves exact links on apply, restore and undo', async () => {
    const source = parseCadDocument({ ...createCadDocument('Pair', 'pair'), schemaVersion: 2, parameters: { span: 10 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: ['span', '0'] }], entities: [], relations: []
      }
    }] });
    const h = await mount(source, [{ kind: 'point', id: 'b' }, { kind: 'point', id: 'a' }], { initialCommand: { kind: 'distance' } });
    expect(field('Distance mm').value).toBe('10');
    await click('Edit Distance relation'); await input('Distance expression', ' span ');
    await click('Keep relation'); await click('Close Distance relation help');
    await input('Distance mm', '12.5000');
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ parameters: { span: 12.5 } }));
    expect(h.session.getSnapshot().document).toBe(source);
    await click('Cancel'); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.edit).not.toHaveBeenCalled();
    await click('Add distance'); await click('Edit Distance relation'); await input('Distance expression', ' span ');
    await click('Keep relation'); await click('Close Distance relation help');
    await input('Distance mm', '12.5000'); await click('Apply');
    const edits = h.edit.mock.calls[0]?.[0];
    expect(edits).toEqual([
      { kind: 'set-parameter', name: 'span', value: 12.5 },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'distance', pointIds: ['b', 'a'], value: ' span ' }) }
    ]);
    const accepted = h.session.getSnapshot().document, sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Pair sketch missing.');
    const relation = sketch.graph.relations[0];
    expect(sketch.graph.points).toEqual([{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: ['span', '0'] }]);
    await h.render([{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }]);
    await clickRelation('Remove', 'Distance', 1); await click('Add distance');
    expect(h.inspect).toHaveBeenLastCalledWith(relation);
    expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.edit).toHaveBeenCalledTimes(1);
    await act(async () => h.session.undo());
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
  });

  it('sends linked parameter and corner intent to awaited preparation before inspecting unsolved geometry', async () => {
    const document = parseCadDocument({ ...createCadDocument('Linked corner', 'linked-corner'), schemaVersion: 2, parameters: { size: 2 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'v', position: ['0', '0'] }, { id: 'a', position: [20, '0'] }, { id: 'b', position: ['0', '16'] }],
        entities: [{ id: 'a-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'a' },
          { id: 'b-line', kind: 'line', construction: false, startPointId: 'v', endPointId: 'b' }],
        relations: [{ id: 'width', kind: 'distance', pointIds: ['v', 'a'], value: 'size * 10' }]
      }
    }] });
    const prepare = vi.fn(async () => document);
    const h = await mount(document, { kind: 'point', id: 'v' }, { initialCommand: { kind: 'fillet' }, onPrepareEdits: prepare });
    await click('Edit Fillet radius relation'); await input('Fillet radius expression', ' size ');
    await click('Keep relation'); await click('Close Fillet radius relation help');
    await input('Fillet radius mm', '3');
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(prepare).toHaveBeenLastCalledWith([
      { kind: 'set-parameter', name: 'size', value: 3 },
      expect.objectContaining({ kind: 'create-sketch-corner', sketchId: 'sketch', pointId: 'v', treatment: expect.objectContaining({ kind: 'fillet', radius: ' size ' }) })
    ], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document).toBe(document);
    expect(button('Apply').disabled).toBe(false);
  });

  it.each(['fillet', 'chamfer'] as const)('prepares one selected %s corner without rewriting its original drivers and accepts one undoable change', async kind => {
    const document = parseCadDocument({ ...createCadDocument('Plate', 'plate'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Plate', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [20, 0] }, { id: 'c', position: [20, 10] }, { id: 'd', position: [0, 10] }],
        entities: [
          { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
          { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
          { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
          { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
        ], relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }]
      }
    }] });
    const h = await mount(document, { kind: 'point', id: 'a' }, { initialCommand: { kind } });
    if (kind === 'fillet') await input('Fillet radius mm', '2');
    else { await input('Setback 1 mm', '2'); await input('Setback 2 mm', '3'); }
    expect(h.session.getSnapshot()).toMatchObject({ document, canUndo: false, workflowOpen: true });
    await click('Apply');
    expect(h.edit).toHaveBeenCalledTimes(1);
    const accepted = h.session.getSnapshot().document, sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Corner sketch missing.');
    expect(sketch.graph.points[0]).toEqual({ id: 'a', position: [' 0 ', '0'] });
    expect(sketch.graph.relations[0]).toEqual({ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] });
    expect(sketch.graph.relations[1]).toMatchObject({ kind: `${kind}-corner`, pointId: 'a', lineIds: ['ab', 'da'] });
    expect(measureCadSketch(accepted, sketch.id).materialAreaMm2).toBeCloseTo(kind === 'fillet' ? 196 + Math.PI : 197, 9);
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(document);
  });

  it('previews the whole candidate, retains a radius parameter link on numeric edits and changes formulas only through fx', async () => {
    const h = await mount(circleDocument(), { kind: 'entity', id: 'circle' }), accepted = h.session.getSnapshot().document;
    await input('Radius mm', '7.25');
    expect(h.session.getSnapshot().document).toBe(accepted);
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ parameters: { radius: 7.25 }, features: expect.any(Array) }));
    await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'set-parameter', name: 'radius', value: 7.25 }], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { entities: [{ radius: ' radius ' }, { radius: 'radius * 2' }] } });
    await click('Edit Radius relation'); await input('Radius expression', 'radius + 1'); await click('Keep relation'); await click('Close Radius relation help');
    await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { entities: [{ radius: 'radius + 1' }, { radius: 'radius * 2' }] } });
    await click('Edit Radius relation'); await input('Radius expression', ' 1e1 '); await click('Keep relation'); await click('Close Radius relation help'); await click('Apply');
    await input('Radius mm', '11.5'); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { entities: [{ radius: '11.5' }, { radius: 'radius * 2' }] } });
    expect(h.session.getSnapshot().document.parameters.radius).toBe(7.25);
  });

  it('replaces only the direct opposite axis in one batch and retains raw Length input after rejection while cancelling a late selection owner', async () => {
    let reject: (error: Error) => void = () => { throw new Error('No application'); };
    let resolve: () => void = () => { throw new Error('No retry'); };
    const first = new Promise<void>((_accept, fail) => { reject = fail; }), retry = new Promise<void>(accept => { resolve = accept; });
    void first.catch(() => undefined);
    const edit = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(retry);
    const h = await mount(lineDocument(), { kind: 'entity', id: 'line' }, { onEditMany: edit, onPrepareEdits: undefined });
    const before = h.session.getSnapshot().document;
    expect(field('Vertical').checked).toBe(true);
    await act(async () => field('Horizontal').click()); await click('Add length'); await input('Length mm', '15.5000');
    expect(field('Vertical').checked).toBe(false);
    await click('Apply');
    expect(edit.mock.calls[0]?.[0]).toEqual([
      { kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'vertical' },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'horizontal', pointIds: ['a', 'b'] }) },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'distance', pointIds: ['a', 'b'], value: 15.5 }) }
    ]);
    await act(async () => reject(new Error('The sketch relations conflict.')));
    expect(field('Length mm').value).toBe('15.5000');
    expect(h.session.getSnapshot().document).toBe(before);
    await click('Apply');
    const signal: unknown = edit.mock.calls[1]?.[1];
    await h.render({ kind: 'point', id: 'a' });
    expect(signal instanceof AbortSignal && signal.aborted).toBe(true);
    await act(async () => resolve());
    expect(field('Fix X').disabled).toBe(true);
    expect(h.session.getSnapshot().document).toBe(before);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('releases and restores an owned numeric axis fix without adding a driver over an exact coordinate expression', async () => {
    const source = parseCadDocument({ ...createCadDocument('Point', 'point'), schemaVersion: 2, parameters: { origin: 2, height: 4 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' origin ', 4] }, { id: 'b', position: [10, 4] }],
        entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
        relations: [{ id: 'level', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'fixY', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: ' height ' }]
      }
    }] });
    const h = await mount(source, { kind: 'point', id: 'a' });
    expect(field('Fix X').disabled).toBe(true); expect(field('Fix Y').checked).toBe(true);
    await clickRelation('Inspect', 'Fix Y', 2);
    expect(h.inspect).toHaveBeenLastCalledWith({ id: 'fixY', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: ' height ' });
    expect(field('Fix Y mm').value).toBe('4');
    await act(async () => field('Fix Y').click());
    await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'fixY' }], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { points: [{ position: [' origin ', 4] }, { position: [10, 4] }], relations: [{ id: 'level' }] } });
    await act(async () => field('Fix Y').click());
    expect(field('Fix Y mm').value).toBe('4');
    await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 4 }) }], expect.any(AbortSignal));
    await act(async () => { h.session.undo(); h.session.undo(); });
    expect(h.session.getSnapshot().document).toBe(source);
    expect(h.session.getSnapshot().canUndo).toBe(false);
  });

  it('restores a removed length with its exact source identity and link before accepting any edit', async () => {
    const base = lineDocument(), sketch = base.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Line fixture missing.');
    const source = parseCadDocument({ ...base, parameters: { plateWidth: 10 }, features: [{ ...sketch, graph: { ...sketch.graph,
      points: sketch.graph.points.map(point => point.id === 'b' ? { ...point, position: [0, 'plateWidth'] } : point),
      relations: [...sketch.graph.relations, { id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' plateWidth ' }]
    } }] });
    const h = await mount(source, { kind: 'entity', id: 'line' });
    await clickRelation('Remove', 'Distance', 2); await click('Add length');
    expect(h.inspect).toHaveBeenLastCalledWith({ id: 'length', kind: 'distance', pointIds: ['a', 'b'], value: ' plateWidth ' });
    expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false, workflowOpen: false });
    expect(h.edit).not.toHaveBeenCalled();
    await input('Length mm', '12.500'); await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'set-parameter', name: 'plateWidth', value: 12.5 }], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { relations: [
      { id: 'vertical' }, { id: 'length', kind: 'distance', value: ' plateWidth ' }
    ] } });
    await act(async () => h.session.undo());
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
  });

  it('keeps invalid shared-parameter trials editable when a related expression becomes undefined', async () => {
    const source = circleDocument(), sketch = source.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Circle fixture missing.');
    const document = parseCadDocument({ ...source, features: [{ ...sketch, graph: { ...sketch.graph,
      points: [{ id: 'center', position: [0.2, '0'] }], relations: [{ id: 'fixX', kind: 'fixed-axis', pointId: 'center', axis: 'x', value: '1 / radius' }]
    } }] });
    const h = await mount(document, { kind: 'entity', id: 'circle' });
    await input('Radius mm', '0');
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(field('Radius mm').value).toBe('0');
    expect(button('Apply').disabled).toBe(true);
    expect(h.session.getSnapshot().document).toBe(document);
    await click('Cancel');
    expect(field('Radius mm').value).toBe('5');
    expect(h.edit).not.toHaveBeenCalled();
  });

  it('edits only string point drivers, keeps aliases and exact revert text, and explicitly unlinks through fx', async () => {
    const source = parseCadDocument({ ...createCadDocument('Point drivers', 'point_drivers'), schemaVersion: 2, parameters: { origin: 2 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' origin ', ' 1e1 '] }], entities: [], relations: []
      }
    }] });
    const h = await mount(source, { kind: 'point', id: 'a' });
    expect(field('Fix X').checked).toBe(true); expect(field('Fix X').disabled).toBe(true);
    expect(field('Fix Y').checked).toBe(true); expect(field('Fix Y').disabled).toBe(true);
    await input('X mm', '4'); await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'set-parameter', name: 'origin', value: 4 }], expect.any(AbortSignal));
    await input('Y mm', '12.5'); await input('Y mm', '10');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { points: [{ id: 'a', position: [' origin ', ' 1e1 '] }] } });
    expect(h.session.getSnapshot().workflowOpen).toBe(false);
    await input('Y mm', '12.5000'); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { points: [{ id: 'a', position: [' origin ', '12.5'] }] } });
    await act(async () => { h.session.undo(); h.session.undo(); });
    expect(h.session.getSnapshot().document).toBe(source); expect(h.session.getSnapshot().canUndo).toBe(false);
    await click('Edit Y relation'); await click('Use current value'); await click('Close Y relation help'); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { points: [{ id: 'a', position: [' origin ', 10] }] } });
    expect(document.querySelector('input[aria-label="Y mm"]')).toBeNull();
    expect(field('Fix Y').checked).toBe(false); expect(field('Fix Y').disabled).toBe(false);
  });
});
