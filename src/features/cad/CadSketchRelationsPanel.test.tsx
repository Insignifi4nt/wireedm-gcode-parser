import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSession } from './cadSession';
import { CadSketchRelationsPanel, type CadSketchRelationsPanelProps } from './CadSketchRelationsPanel';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function mount(document: CadDocument, initial: CadSketchGraphSelection, overrides: Partial<Pick<CadSketchRelationsPanelProps, 'onEditMany' | 'onPrepareEdits'>> = {}) {
  const session = new CadSession(document), preview = vi.fn(), inspect = vi.fn(), pending = vi.fn((open: boolean) => session.setWorkflowOpen(open));
  let selection = initial;
  const edit = vi.fn<NonNullable<CadSketchRelationsPanelProps['onEditMany']>>((edits, signal) => { signal?.throwIfAborted(); return session.edit(edits); });
  const prepare = vi.fn<NonNullable<CadSketchRelationsPanelProps['onPrepareEdits']>>(async (edits, signal) => { signal.throwIfAborted(); return applyCadEdits(session.getSnapshot().document, edits); });
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), sketch = snapshot.document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Sketch fixture missing.');
    return <CadSketchRelationsPanel document={snapshot.document} sketch={sketch} selection={selection} onEditMany={edit} onPrepareEdits={prepare}
      onPreviewDocument={preview} onInspectRelation={inspect} onPendingChange={pending} interactionLocked={false} cancelSignal={0} {...overrides} />;
  }
  const render = async (next = selection) => { selection = next; await act(async () => root.render(<Harness />)); };
  await render();
  return { session, preview, inspect, pending, edit, prepare, render };
}
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === name || button.textContent?.trim() === name);
  if (!found) throw new Error(`Missing button ${name}`); return found;
}
async function click(name: string) { await act(async () => button(name).click()); }
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
    await click('Inspect Fix Y relation fixY');
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
    await click('Remove Length relation length'); await click('Add length');
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
