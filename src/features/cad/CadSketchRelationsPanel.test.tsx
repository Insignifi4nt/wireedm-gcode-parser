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
  it('inspects point separation without edits and keeps a long constraint list deliberate while dimensions remain directly editable', async () => {
    const source=parseCadDocument({ ...createCadDocument('Measured plate','measured-plate'), schemaVersion:2, features:[{
      id:'sketch',kind:'sketch',name:'Plate',suppressed:false,plane:'XY',offset:0,profiles:[],graph:{
        points:[{id:'a',position:[' 0.00 ',0]},{id:'b',position:[50,0]},{id:'c',position:[50,25]},{id:'d',position:[0,25]},{id:'center',position:[25,12.5]}],
        entities:[{id:'ab',kind:'line',startPointId:'a',endPointId:'b',construction:false},{id:'bc',kind:'line',startPointId:'b',endPointId:'c',construction:false},
          {id:'cd',kind:'line',startPointId:'c',endPointId:'d',construction:false},{id:'da',kind:'line',startPointId:'d',endPointId:'a',construction:false},
          {id:'bore',kind:'circle',centerPointId:'center',radius:3,construction:false}],
        relations:[{id:'h0',kind:'horizontal',pointIds:['a','b']},{id:'v0',kind:'vertical',pointIds:['b','c']},{id:'h1',kind:'horizontal',pointIds:['c','d']},{id:'v1',kind:'vertical',pointIds:['d','a']},
          {id:'ax',kind:'fixed-axis',pointId:'a',axis:'x',value:0},{id:'ay',kind:'fixed-axis',pointId:'a',axis:'y',value:0},
          {id:'width',kind:'distance',pointIds:['a','b'],value:50},{id:'height',kind:'distance',pointIds:['a','d'],value:25},
          {id:'diameter',kind:'radial-size',entityId:'bore',quantity:'diameter',value:6},
          {id:'x',kind:'axis-distance',pointIds:['a','center'],axis:'x',value:25},{id:'y',kind:'axis-distance',pointIds:['a','center'],axis:'y',value:12.5}]
      }
    }] });
    const h=await mount(source,[{kind:'point',id:'a'},{kind:'point',id:'center'}]), accepted=h.session.getSnapshot();
    const values=()=>[...container.querySelectorAll('[aria-label="Selected geometry measurements"] dd')].map(e=>e.textContent);
    expect(values()).toEqual(['27.95085 mm','25 mm','12.5 mm']);
    const disclosure=container.querySelector<HTMLDetailsElement>('details.cad-sketch-relations-disclosure');
    expect(disclosure?.open).toBe(false);
    await act(async()=>{if(!disclosure)throw Error('Missing relation disclosure');disclosure.open=true;disclosure.dispatchEvent(new Event('toggle'));});
    await clickRelation('Inspect','Horizontal distance',10);
    expect(field('Horizontal distance mm').value).toBe('25');
    expect(h.session.getSnapshot().document).toBe(accepted.document); expect(h.edit).not.toHaveBeenCalled();
    await input('Horizontal distance mm','26'); expect(values()).toEqual([]);
    await click('Cancel'); expect(values()).toEqual(['27.95085 mm','25 mm','12.5 mm']);
    await h.render([{kind:'point',id:'center'},{kind:'point',id:'a'}]); expect(values()).toEqual(['27.95085 mm','-25 mm','-12.5 mm']);
    await clickRelation('Inspect','Horizontal distance',10);
    expect(values()).toEqual(['27.95085 mm','25 mm','12.5 mm']);
    await h.render({kind:'entity',id:'ab'}); expect(values()[0]).toBe('50 mm');
    expect(h.edit).not.toHaveBeenCalled(); expect(h.session.getSnapshot()).toEqual(accepted);
  });

  it('keeps a deliberate point-to-line midpoint local until Apply and removes only that relation', async () => {
    const source = parseCadDocument({ ...createCadDocument('Centered bore', 'centered-bore'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Bore and guide', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0.00 ', '0'] }, { id: 'b', position: ['20', '10'] }, { id: 'center', position: [10, 5] }],
        entities: [{ id: 'guide', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true },
          { id: 'bore', kind: 'circle', centerPointId: 'center', radius: ' 2.00 ', construction: false }], relations: []
      }
    }] });
    const h = await mount(source, [{ kind: 'point', id: 'center' }, { kind: 'entity', id: 'guide' }]);
    await act(async () => field('Midpoint').click());
    expect(h.session.getSnapshot().document).toBe(source);
    await click('Cancel'); expect(h.edit).not.toHaveBeenCalled();
    await act(async () => field('Midpoint').click()); await click('Apply');
    const edit = h.edit.mock.calls[0][0][0];
    expect(edit).toMatchObject({ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { kind: 'midpoint', pointId: 'center', lineId: 'guide' } });
    if (edit.kind !== 'set-sketch-relation') throw new Error('Midpoint relation edit missing.');
    const linked = h.session.getSnapshot().document, original = source.features[0];
    if (original.kind !== 'sketch' || !original.graph) throw new Error('Bore fixture missing.');
    expect(linked.features[0]).toEqual({ ...original, graph: { ...original.graph, relations: [edit.relation] } });
    await h.render([{ kind: 'entity', id: 'guide' }, { kind: 'point', id: 'center' }]);
    expect(field('Midpoint').checked).toBe(true);
    await act(async () => field('Midpoint').click()); await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: edit.relation.id }], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document.features).toEqual(source.features);
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(linked);
  });
  it('keeps generated Collinear support authoritative until its deliberate removal is applied', async () => {
    const source = parseCadDocument({ ...createCadDocument('Trimmed line', 'trimmed-line'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Survivors', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'cut0', position: [4, 0] }, { id: 'cut1', position: [6, 0] }, { id: 'b', position: [10, 0] }],
        entities: [{ id: 'before', kind: 'line', construction: true, startPointId: 'a', endPointId: 'cut0' },
          { id: 'after', kind: 'line', construction: true, startPointId: 'cut1', endPointId: 'b' }],
        relations: [{ id: 'support', kind: 'collinear', lineIds: ['before', 'after'] }]
      }
    }] });
    const h = await mount(source, [{ kind: 'entity', id: 'after' }, { kind: 'entity', id: 'before' }], { initialCommand: { kind: 'line-angle' } });
    expect(button('Add angle').disabled).toBe(true); expect(field('Parallel').disabled).toBe(true); expect(field('Perpendicular').disabled).toBe(true);
    expect(field('Parallel').getAttribute('aria-description')).toContain('Collinear'); expect(field('Perpendicular').getAttribute('aria-description')).toContain('Collinear');
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.prepare).not.toHaveBeenCalled();
    await clickRelation('Inspect', 'Collinear', 1); expect(h.inspect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'support', kind: 'collinear' }));
    await clickRelation('Remove', 'Collinear', 1);
    expect(button('Add angle').disabled).toBe(false); expect(field('Parallel').disabled).toBe(false); expect(field('Perpendicular').disabled).toBe(false);
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    const sketch = source.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Survivors missing.');
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ graph: { ...sketch.graph, relations: [] } })] }));
    await click('Cancel'); expect(h.session.getSnapshot().document).toBe(source); expect(h.edit).not.toHaveBeenCalled();
    expect(button('Add angle').disabled).toBe(true); expect(field('Parallel').disabled).toBe(true);
    await clickRelation('Remove', 'Collinear', 1); await click('Apply');
    expect(h.edit).toHaveBeenCalledExactlyOnceWith([{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'support' }], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { ...sketch.graph, relations: [] } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(source);
  });
  it('authors relative X/Y drivers deliberately, cancels privately and restores their exact accepted orientation after reverse selection', async () => {
    const source = parseCadDocument({ ...createCadDocument('Located bore', 'located-bore'), schemaVersion: 2, parameters: { boreX: 30 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Plate and bore', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'corner', position: [' 0.00 ', '0'] }, { id: 'center', position: [30, 20] }],
        entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: 4, construction: false }], relations: []
      }
    }] });
    const h = await mount(source, [{ kind: 'point', id: 'corner' }, { kind: 'point', id: 'center' }], { initialCommand: { kind: 'point-dimensions' } });
    expect(h.pending).toHaveBeenLastCalledWith(false);
    const offsets = async () => {
      await click('Horizontal distance'); expect(field('Horizontal distance mm').value).toBe('30');
      await click('Edit Horizontal distance relation'); await input('Horizontal distance expression', ' boreX ');
      await click('Keep relation'); await click('Close Horizontal distance relation help');
      await click('Vertical distance'); expect(field('Vertical distance mm').value).toBe('20');
    };
    await offsets(); expect(h.session.getSnapshot().document).toBe(source); await click('Cancel');
    expect(h.edit).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
    await offsets(); await click('Apply');
    expect(h.edit).toHaveBeenCalledExactlyOnceWith([
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'axis-distance', axis: 'x', pointIds: ['corner', 'center'], value: ' boreX ' }) },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'axis-distance', axis: 'y', pointIds: ['corner', 'center'], value: 20 }) }
    ], expect.any(AbortSignal));
    const accepted = h.session.getSnapshot().document.features[0];
    if (accepted.kind !== 'sketch' || !accepted.graph) throw new Error('Located bore missing.');
    const original = source.features[0]; if (original.kind !== 'sketch') throw new Error('Source sketch missing.');
    expect(accepted.graph.points).toEqual(original.graph?.points); expect(accepted.graph.entities).toEqual(original.graph?.entities);
    await h.render([{ kind: 'point', id: 'center' }, { kind: 'point', id: 'corner' }]);
    await click('Horizontal distance'); expect(h.inspect).toHaveBeenLastCalledWith(accepted.graph.relations[0]);
    expect(h.pending).toHaveBeenLastCalledWith(false);
    await clickRelation('Remove', 'Horizontal distance', 1); await click('Horizontal distance');
    expect(h.inspect).toHaveBeenLastCalledWith(accepted.graph.relations[0]); expect(h.pending).toHaveBeenLastCalledWith(false);
    expect(h.edit).toHaveBeenCalledOnce(); await act(async () => h.session.undo());
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false });
    await click('Horizontal distance'); expect(field('Horizontal distance mm').value).toBe('-30');
    await click('Vertical distance'); expect(field('Vertical distance mm').value).toBe('-20');
    await click('Cancel'); expect(h.session.getSnapshot().document).toBe(source);
  });

  it('dimensions the conventional obtuse corner despite incoming source order, cancels privately and accepts one undoable relation', async () => {
    const source = parseCadDocument({ ...createCadDocument('Corner angle', 'corner-angle'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'v', position: [' 0.00 ', '0'] }, { id: 'a', position: ['10', '0'] }, { id: 'b', position: [-5, Math.sqrt(75)] }],
        entities: [{ id: 'incoming', kind: 'line', construction: false, startPointId: 'a', endPointId: 'v' },
          { id: 'outgoing', kind: 'line', construction: true, startPointId: 'v', endPointId: 'b' }], relations: []
      }
    }] });
    const h = await mount(source, [{ kind: 'entity', id: 'incoming' }, { kind: 'entity', id: 'outgoing' }], { initialCommand: { kind: 'line-angle' } });
    expect(Number(field('Angle deg').value)).toBeCloseTo(120, 10); expect(h.pending).toHaveBeenLastCalledWith(true);
    expect(h.session.getSnapshot().document).toBe(source); await click('Cancel'); expect(h.edit).not.toHaveBeenCalled();
    await click('Add angle'); await act(async () => field('Angle deg').focus()); await input('Angle deg', '120'); await click('Apply');
    const accepted = h.session.getSnapshot().document.features[0];
    expect(accepted).toMatchObject({ graph: { points: source.features[0].kind === 'sketch' ? source.features[0].graph?.points : [],
      relations: [{ kind: 'line-angle', rays: [{ lineId: 'incoming', towardPointId: 'a' }, { lineId: 'outgoing', towardPointId: 'b' }], sense: 'ccw', value: 120 }] } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(source);
  });

  it('requires a deliberate sector for crossing lines and restores an existing angle with its exact reversed tuple and expression', async () => {
    const source = parseCadDocument({ ...createCadDocument('Crossing angle', 'crossing-angle'), schemaVersion: 2, parameters: { cornerAngle: 90 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [-10, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, -10] }, { id: 'd', position: [0, 10] }],
        entities: [{ id: 'first', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
          { id: 'second', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: []
      }
    }] });
    const h = await mount(source, [{ kind: 'entity', id: 'first' }, { kind: 'entity', id: 'second' }], { initialCommand: { kind: 'line-angle' } });
    const choices = container.querySelectorAll<HTMLButtonElement>('[data-cad-angle-sector]'); expect(choices).toHaveLength(4);
    expect(button('Apply').disabled).toBe(true); expect(h.pending).toHaveBeenLastCalledWith(true);
    await act(async () => choices[0].click()); expect(Number(field('Angle deg').value)).toBe(90); await click('Cancel');
    expect(h.session.getSnapshot().document).toBe(source); expect(h.edit).not.toHaveBeenCalled();
    await click('Add angle'); expect(container.querySelectorAll('[data-cad-angle-sector]')).toHaveLength(4);
    await act(async () => field('Perpendicular').click());
    expect(container.querySelectorAll('[data-cad-angle-sector]')).toHaveLength(0);
    expect(button('Add angle').disabled).toBe(true);
    await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { relations: [{ kind: 'perpendicular', lineIds: ['first', 'second'] }] } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(source);
    const sketch = source.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Graph unavailable.');
    const relation = { id: 'angle', kind: 'line-angle' as const, rays: [{ lineId: 'second', towardPointId: 'd' }, { lineId: 'first', towardPointId: 'b' }] as const, sense: 'cw' as const, value: ' cornerAngle ' };
    const saved = parseCadDocument({ ...source, features: [{ ...sketch, graph: { ...sketch.graph, relations: [relation] } }] });
    const existing = await mount(saved, [{ kind: 'entity', id: 'first' }, { kind: 'entity', id: 'second' }], { initialCommand: { kind: 'line-angle' } });
    expect(field('Angle deg').value).toBe('90'); expect(existing.pending).toHaveBeenLastCalledWith(false);
    await clickRelation('Remove', 'Angle', 1); await click('Add angle'); expect(existing.pending).toHaveBeenLastCalledWith(false);
    expect(existing.session.getSnapshot().document).toBe(saved); expect(existing.edit).not.toHaveBeenCalled();
  });

  it('owns a whole-selection Move from zero displacement, previews privately and accepts one exact translation', async () => {
    const source = parseCadDocument({ ...createCadDocument('Move edges', 'move-edges'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [20, 0] }, { id: 'outside', position: [' 30 ', '0'] }],
        entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true }],
        relations: [{ id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: ' 20 ' }]
      }
    }] });
    const selections = [{ kind: 'entity' as const, id: 'line' }, { kind: 'point' as const, id: 'a' }];
    const h = await mount(source, selections, { initialCommand: { kind: 'move' } });
    expect(field('Move X').value).toBe('0'); expect(field('Move Y').value).toBe('0');
    expect(h.pending).toHaveBeenLastCalledWith(true); expect(button('Apply').disabled).toBe(true);
    await input('Move X', '10.0000'); await input('Move Y', '5');
    await act(async () => new Promise(resolve => setTimeout(resolve, 125)));
    expect(h.session.getSnapshot().document).toBe(source);
    expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ features: [expect.objectContaining({ graph: expect.objectContaining({
      points: [{ id: 'a', position: [10, 5] }, { id: 'b', position: [30, 5] }, { id: 'outside', position: [' 30 ', '0'] }]
    }) })] }));
    await click('Cancel'); expect(h.edit).not.toHaveBeenCalled(); expect(h.pending).toHaveBeenLastCalledWith(false);
    await h.render([...selections].reverse()); await input('Move X', '10'); await input('Move Y', '5'); await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'translate-sketch-geometry', sketchId: 'sketch', selections: [...selections].reverse(), translation: [10, 5] }], expect.any(AbortSignal));
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: {
      points: [{ id: 'a', position: [10, 5] }, { id: 'b', position: [30, 5] }, { id: 'outside', position: [' 30 ', '0'] }],
      relations: [{ id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: ' 20 ' }]
    } });
    await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toBe(source);
  });

  it.each(['equal-length', 'equal-radius'] as const)('keeps %s pair edits private and restores their exact symmetric source identity', async kind => {
    const source = parseCadDocument({ ...createCadDocument('Equal sizes', 'equal-sizes'), schemaVersion: 2, parameters: { size: 10 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [' 0 ', '0'] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [0, 10] },
          { id: 'center', position: ['20', '0'] }, { id: 'start', position: [30, 0] }, { id: 'end', position: [20, 10] }],
        entities: kind === 'equal-length' ? [
          { id: 'first', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
          { id: 'second', kind: 'line', startPointId: 'c', endPointId: 'a', construction: true }
        ] : [
          { id: 'first', kind: 'circle', centerPointId: 'a', radius: ' size ', construction: false },
          { id: 'second', kind: 'arc', centerPointId: 'center', startPointId: 'start', endPointId: 'end', direction: 'cw', construction: true }
        ], relations: kind === 'equal-length' ? [{ id: 'driver', kind: 'distance', pointIds: ['a', 'b'], value: ' size ' }] : []
      }
    }] });
    const label = kind === 'equal-length' ? 'Equal length' : 'Equal radius';
    const pair = [{ kind: 'entity' as const, id: 'second' }, { kind: 'entity' as const, id: 'first' }];
    const h = await mount(source, pair);
    await act(async () => field(label).click()); await click('Cancel');
    expect(h.session.getSnapshot()).toMatchObject({ document: source, canUndo: false }); expect(h.edit).not.toHaveBeenCalled();
    await act(async () => field(label).click()); await click('Apply');
    const accepted = h.session.getSnapshot().document, sketch = accepted.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing equal-size sketch.');
    const relation = sketch.graph.relations.at(-1);
    expect(relation).toEqual({ id: expect.any(String), kind, [kind === 'equal-length' ? 'lineIds' : 'curveIds']: ['second', 'first'] });
    expect(h.edit).toHaveBeenLastCalledWith([{ kind: 'set-sketch-relation', sketchId: 'sketch', relation }], expect.any(AbortSignal));
    expect(sketch.graph.points).toEqual(source.features[0].kind === 'sketch' ? source.features[0].graph?.points : undefined);
    await h.render([...pair].reverse()); expect(field(label).checked).toBe(true);
    await act(async () => field(label).click()); await act(async () => field(label).click());
    expect(h.pending).toHaveBeenLastCalledWith(false); expect(h.edit).toHaveBeenCalledOnce();
    await clickRelation('Inspect', label, sketch.graph.relations.length); expect(h.inspect).toHaveBeenLastCalledWith(relation);
    await act(async () => field(label).click()); await click('Apply');
    expect(h.session.getSnapshot().document.features[0]).toMatchObject({ graph: { relations: source.features[0].kind === 'sketch' ? source.features[0].graph?.relations : undefined } });
    await act(async () => { h.session.undo(); h.session.undo(); }); expect(h.session.getSnapshot().document).toBe(source);
  });

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
    await click('Aligned distance'); await click('Edit Distance relation'); await input('Distance expression', ' span ');
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
    await clickRelation('Remove', 'Distance', 1); await click('Aligned distance');
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

  it('names relations that hold a point on the origin or an axis after that reference, and keeps the coordinate name for editing', async () => {
    const source = parseCadDocument({ ...createCadDocument('Point', 'point'), schemaVersion: 2, features: [{
      id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
        points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 4] }, { id: 'c', position: [0, 0] }],
        entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }],
        relations: [{ id: 'onX', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: 0 }, { id: 'onY', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: 0 },
          { id: 'fixB', kind: 'fixed-axis', pointId: 'b', axis: 'y', value: 4 }, { id: 'pin', kind: 'fixed-point', pointId: 'c', position: [0, 0] }]
      }
    }] });
    const h = await mount(source, [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }, { kind: 'point', id: 'c' }]);
    const rows = () => [...container.querySelectorAll('[aria-label="Sketch relations"] li button[aria-pressed]')].map(row => row.textContent?.trim());
    expect(rows()).toEqual(['On the X axis', 'On the Y axis', 'Fix Y4 mm', 'Fixed at the origin']);
    await clickRelation('Inspect', 'On the X axis', 1);
    expect(h.inspect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'onX' }));
    expect(field('Fix Y mm').value).toBe('0');
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

describe('dimensions from the sketch origin and axes', () => {
  const boreDocument = (relations: readonly unknown[] = []) => parseCadDocument({ ...createCadDocument('Located bore', 'located-bore'), schemaVersion: 2, features: [{
    id: 'sketch', kind: 'sketch', name: 'Bore', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'center', position: [30, -20] }], entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: 4, construction: false }], relations
    }
  }] });
  it('keeps signed coordinates from the origin and drives the one you change', async () => {
    const h = await mount(boreDocument(), { kind: 'point', id: 'center' }, { initialCommand: { kind: 'datum-distance', datum: 'origin' } });
    expect(field('X from origin mm').value).toBe('30'); expect(field('Y from origin mm').value).toBe('-20');
    expect(document.activeElement).toBe(field('X from origin mm'));
    await input('X from origin mm', '35'); await click('Apply');
    expect(h.edit).toHaveBeenCalledExactlyOnceWith([
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'fixed-axis', pointId: 'center', axis: 'x', value: 35 }) },
      { kind: 'set-sketch-relation', sketchId: 'sketch', relation: expect.objectContaining({ kind: 'fixed-axis', pointId: 'center', axis: 'y', value: -20 }) }
    ], expect.any(AbortSignal));
  });
  it('reuses the coordinate an axis already drives and explains a point that cannot take one', async () => {
    const h = await mount(boreDocument([{ id: 'level', kind: 'fixed-axis', pointId: 'center', axis: 'y', value: -20 }]), { kind: 'point', id: 'center' },
      { initialCommand: { kind: 'datum-distance', datum: 'x-axis' } });
    expect(field('Y from X axis mm').value).toBe('-20'); expect(container.querySelector('input[aria-label="X from Y axis mm"]')).toBeNull();
    await input('Y from X axis mm', '-25'); await click('Apply');
    expect(h.edit).toHaveBeenCalledExactlyOnceWith([{ kind: 'set-sketch-relation', sketchId: 'sketch', relation: { id: 'level', kind: 'fixed-axis', pointId: 'center', axis: 'y', value: -25 } }], expect.any(AbortSignal));
    await act(async () => root.unmount()); root = createRoot(container);
    await mount(boreDocument([{ id: 'pin', kind: 'fixed-point', pointId: 'center', position: [30, -20] }]), { kind: 'point', id: 'center' }, { initialCommand: { kind: 'datum-distance', datum: 'y-axis' } });
    expect(container.textContent).toContain('already has its position from a fixed point or an expression');
    expect(container.querySelector('input[aria-label="X from Y axis mm"]')).toBeNull();
  });
});


describe('saved reference dimension editing', () => {
  it('saves a passive diameter on expression-driven geometry and keeps its source owner explicit', async () => {
    const source=circleDocument(), h=await mount(source,{kind:'entity',id:'circle'}), exact=JSON.stringify(source);
    await click('Reference diameter');await act(async()=>{await vi.waitFor(()=>expect(h.prepare).toHaveBeenCalled());});
    expect(container.querySelector('[aria-label="Reference dimension value"]')?.textContent).toBe('10 mm');
    expect(button('Make driving').disabled).toBe(true);
    await click('Apply');
    const accepted=h.session.getSnapshot().document, sketch=accepted.features[0];if(sketch.kind!=='sketch')throw Error('Missing sketch');
    expect(sketch.graph?.relations).toEqual([expect.objectContaining({kind:'reference-dimension',measurement:{kind:'radial-size',entityId:'circle',quantity:'diameter'}})]);
    expect(sketch.graph?.entities).toEqual(source.features[0].kind==='sketch'?source.features[0].graph?.entities:[]);
    expect(JSON.stringify(source)).toBe(exact);await act(async()=>h.session.undo());expect(h.session.getSnapshot().document).toBe(source);
  });
  it('converts the same saved identity through the ordinary scalar form, with exact Cancel and Undo', async () => {
    const original=circleDocument(), first=original.features[0];if(first.kind!=='sketch'||!first.graph)throw Error('Missing graph');
    const source=parseCadDocument({...original,parameters:{radius:3},features:[{...first,graph:{...first.graph,entities:first.graph.entities.map(e=>e.id==='circle'?{...e,radius:3}:e),
      relations:[{id:'bore-size',kind:'reference-dimension',measurement:{kind:'radial-size',entityId:'circle',quantity:'diameter'}}]}}]});
    const h=await mount(source,{kind:'entity',id:'circle'},{initialCommand:{kind:'inspect',relationId:'bore-size'}});
    await click('Make driving');expect(field('Diameter mm').value).toBe('6');await act(async()=>field('Diameter mm').focus());await input('Diameter mm','8');await click('Cancel');
    expect(h.session.getSnapshot().document).toBe(source);expect(h.edit).not.toHaveBeenCalled();
    await clickRelation('Inspect','Reference dimension',1);await click('Make driving');await click('Edit Diameter relation');await input('Diameter expression',' radius * 2 ');await click('Keep relation');await click('Close Diameter relation help');await click('Apply');
    expect(h.edit).toHaveBeenLastCalledWith([{kind:'set-sketch-relation',sketchId:'sketch',relation:{id:'bore-size',kind:'radial-size',entityId:'circle',quantity:'diameter',value:' radius * 2 '}}],expect.any(AbortSignal));
    await act(async()=>h.session.undo());expect(h.session.getSnapshot().document).toBe(source);
  });
});


it.each([false,true])('switches an unaccepted Dimension command to Reference without a hidden driver, existing=%s',async(existing)=>{
  const original=lineDocument(), first=original.features[0];if(first.kind!=='sketch'||!first.graph)throw Error('Missing graph');
  const reference={id:'saved-length',kind:'reference-dimension',measurement:{kind:'line-length',entityId:'line'}};
  const source=existing?parseCadDocument({...original,features:[{...first,graph:{...first.graph,relations:[...first.graph.relations,reference]}}]}):original;
  const h=await mount(source,{kind:'entity',id:'line'},{initialCommand:{kind:'length'}});
  expect(field('Length mm').value).toBe('10');await click('Reference length');if(existing) expect(h.edit).not.toHaveBeenCalled();else await click('Apply');
  const sketch=h.session.getSnapshot().document.features[0];if(sketch.kind!=='sketch')throw Error('Missing sketch');
  expect(sketch.graph?.relations).toEqual([source.features[0].kind==='sketch'?source.features[0].graph?.relations[0]:null,
    expect.objectContaining({kind:'reference-dimension',measurement:{kind:'line-length',entityId:'line'}})]);
  expect(sketch.graph?.points).toEqual(source.features[0].kind==='sketch'?source.features[0].graph?.points:[]);
});


it('reads and converts reference values only from accepted geometry or its matching solved preview',async()=>{
  const original=lineDocument(), first=original.features[0];if(first.kind!=='sketch'||!first.graph)throw Error('Missing graph');
  const graph={...first.graph,points:[...first.graph.points.map(p=>p.id==='b'?{...p,position:[0,50]}:p),{id:'q',position:['20','0']}],relations:[...first.graph.relations,
    {id:'driver',kind:'distance',pointIds:['a','b'],value:' width '},{id:'measured',kind:'reference-dimension',measurement:{kind:'point-distance',pointIds:['b','q']}}]};
  const source=parseCadDocument({...original,parameters:{width:50},features:[{...first,graph}]}), settled=parseCadDocument({...source,parameters:{width:60},features:[{...first,graph:{...graph,points:graph.points.map(p=>p.id==='b'?{...p,position:[0,60]}:p)}}]});
  let resolve!:(document:CadDocument)=>void;const prepare=vi.fn(()=>new Promise<CadDocument>(done=>{resolve=done;}));
  const h=await mount(source,[{kind:'point',id:'b'},{kind:'point',id:'q'}],{initialCommand:{kind:'inspect',relationId:'driver'},onPrepareEdits:prepare});
  const row=()=>container.querySelector('[aria-label^="Inspect Reference dimension"] span')?.textContent;
  expect(row()).toBe('(53.851648 mm)');await act(async()=>field('Length mm').focus());await input('Length mm','60');
  expect(row()).toBe('(—)');await act(async()=>{await vi.waitFor(()=>expect(prepare).toHaveBeenCalled());});
  await act(async()=>resolve(settled));expect(row()).toBe('(63.245553 mm)');expect(h.session.getSnapshot().document).toBe(source);
  await clickRelation('Inspect','Reference dimension',3);await click('Make driving');
  await act(async()=>field('Distance mm').focus());expect(Number(field('Distance mm').value)).toBe(Math.hypot(60,20));
  await click('Cancel');expect(row()).toBe('(53.851648 mm)');expect(h.edit).not.toHaveBeenCalled();
});


describe('contextual concentric curve centers',()=>{
  const source=(shared=false)=>parseCadDocument({...createCadDocument('Concentric','concentric'),schemaVersion:2,features:[{
    id:'sketch',kind:'sketch',name:'Sketch',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{
      points:[{id:'origin',position:[' 0.00 ','0']},{id:'center',position:[0,0]},{id:'start',position:[3,0]},{id:'end',position:[0,3]}],
      entities:[{id:'rim',kind:'circle',centerPointId:'origin',radius:' 10 ',construction:false},
        {id:'arc',kind:'arc',centerPointId:shared?'origin':'center',startPointId:'start',endPointId:'end',direction:'cw',construction:true}],relations:[]}
  }]});
  const pair=[{kind:'entity' as const,id:'arc'},{kind:'entity' as const,id:'rim'}];
  it('keeps preview/cancel private and reuses exact center coincidence through reversed selection and toggles',async()=>{
    const original=source(),h=await mount(original,pair);
    await act(async()=>field('Concentric').click());await click('Cancel');expect(h.session.getSnapshot().document).toBe(original);expect(h.edit).not.toHaveBeenCalled();
    await act(async()=>field('Concentric').click());await click('Apply');
    const accepted=h.session.getSnapshot().document,sketch=accepted.features[0];if(sketch.kind!=='sketch'||!sketch.graph)throw Error('Missing graph');
    expect(sketch.graph.relations).toEqual([{id:expect.any(String),kind:'coincident',pointIds:['center','origin']}]);
    expect(sketch.graph.entities).toEqual(original.features[0].kind==='sketch'?original.features[0].graph?.entities:[]);
    expect(sketch.graph.points).toEqual(original.features[0].kind==='sketch'?original.features[0].graph?.points:[]);
    await h.render([...pair].reverse());expect(field('Concentric').checked).toBe(true);
    await act(async()=>field('Concentric').click());await act(async()=>field('Concentric').click());
    expect(h.pending).toHaveBeenLastCalledWith(false);expect(h.session.getSnapshot().document).toBe(accepted);
    await act(async()=>h.session.undo());expect(h.session.getSnapshot().document).toBe(original);
  });
  it.each(['shared','chain'])('recognizes %s centers without a redundant relation or editable false freedom',async(kind)=>{
    const base=source(kind==='shared'),first=base.features[0];if(first.kind!=='sketch'||!first.graph)throw Error('Missing graph');
    const original=kind==='shared'?base:parseCadDocument({...base,features:[{...first,graph:{...first.graph,points:[...first.graph.points,{id:'bridge',position:[0,0]}],
      relations:[{id:'first-link',kind:'coincident',pointIds:['origin','bridge']},{id:'second-link',kind:'coincident',pointIds:['bridge','center']}]}}]});
    const h=await mount(original,pair);
    expect(field('Concentric').checked).toBe(true);expect(field('Concentric').disabled).toBe(true);
    expect(h.pending).toHaveBeenLastCalledWith(false);expect(h.prepare).not.toHaveBeenCalled();expect(h.edit).not.toHaveBeenCalled();expect(h.session.getSnapshot().document).toBe(original);
  });
});


describe('point symmetry about a selected sketch line',()=>{
  const pairedBores=()=>parseCadDocument({...createCadDocument('Paired bores'),schemaVersion:2,features:[{
    id:'sketch',kind:'sketch',name:'Layout',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{
      points:[{id:'left',position:[' 15.00 ','10']},{id:'right',position:[55,10]},{id:'axis-a',position:['35','0']},{id:'axis-b',position:['35','20']}],
      entities:[{id:'left-bore',kind:'circle',centerPointId:'left',radius:' 3.00 ',construction:false},{id:'right-bore',kind:'circle',centerPointId:'right',radius:' 4.000 ',construction:false},
        {id:'axis',kind:'line',startPointId:'axis-a',endPointId:'axis-b',construction:true}],relations:[]}}]});
  it.each(['point','entity'] as const)('authors %s position symmetry, cancels and preserves the accepted tuple on reversed selection',async(kind)=>{
    const original=pairedBores(),selection:readonly CadSketchGraphSelection[]=[{kind,id:kind==='point'?'right':'right-bore'},{kind:'entity',id:'axis'},{kind,id:kind==='point'?'left':'left-bore'}];
    const label=kind==='point'?'Symmetric points':'Symmetric centers',h=await mount(original,selection);
    await act(async()=>field(label).click());await click('Cancel');expect(h.session.getSnapshot().document).toBe(original);expect(h.edit).not.toHaveBeenCalled();
    await act(async()=>field(label).click());await click('Apply');
    const edit=h.edit.mock.calls[0]?.[0][0];expect(edit).toMatchObject({kind:'set-sketch-relation',sketchId:'sketch',relation:{kind:'symmetric',pointIds:['right','left'],lineId:'axis'}});
    if(edit?.kind!=='set-sketch-relation')throw Error('Missing symmetry');const owner=edit.relation,accepted=h.session.getSnapshot().document,sketch=accepted.features[0];
    expect(sketch).toEqual({...original.features[0],graph:{...(original.features[0].kind==='sketch'?original.features[0].graph:{}),relations:[owner]}});
    await h.render([...selection].reverse());expect(field(label).checked).toBe(true);await act(async()=>field(label).click());await act(async()=>field(label).click());expect(h.pending).toHaveBeenLastCalledWith(false);expect(h.edit).toHaveBeenCalledTimes(1);
    await act(async()=>field(label).click());await click('Apply');expect(h.session.getSnapshot().document.features).toEqual(original.features);
    await act(async()=>h.session.undo());expect(h.session.getSnapshot().document).toEqual(accepted);
  });
  it('does not offer symmetry when a selected point is an endpoint of the axis',async()=>{
    await mount(pairedBores(),[{kind:'point',id:'axis-a'},{kind:'point',id:'right'},{kind:'entity',id:'axis'}]);
    expect(document.querySelector('input[aria-label="Symmetric points"]')).toBeNull();
  });
});

describe('point incidence on a selected line',()=>{
  const layout=()=>parseCadDocument({...createCadDocument('Guided bore'),schemaVersion:2,features:[{
    id:'sketch',kind:'sketch',name:'Layout',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{
      points:[{id:'a',position:[' 0.00 ','0']},{id:'b',position:['40','20']},{id:'center',position:[10,5]}],
      entities:[{id:'guide',kind:'line',startPointId:'a',endPointId:'b',construction:true},{id:'bore',kind:'circle',centerPointId:'center',radius:' 3.00 ',construction:false}],relations:[]}}]});
  it('authors incidence without fixing the point or size, cancels and reuses its exact identity after reversed picking',async()=>{
    const original=layout(),selection:readonly CadSketchGraphSelection[]=[{kind:'point',id:'center'},{kind:'entity',id:'guide'}],h=await mount(original,selection);
    await act(async()=>field('Point on line').click());await click('Cancel');expect(h.session.getSnapshot().document).toBe(original);expect(h.edit).not.toHaveBeenCalled();
    await act(async()=>field('Point on line').click());await click('Apply');
    const edit=h.edit.mock.calls[0]?.[0][0];expect(edit).toMatchObject({kind:'set-sketch-relation',sketchId:'sketch',relation:{kind:'point-on-line',pointId:'center',lineId:'guide'}});
    if(edit?.kind!=='set-sketch-relation')throw Error('Missing incidence');const owner=edit.relation,accepted=h.session.getSnapshot().document;
    expect(accepted.features[0]).toEqual({...original.features[0],graph:{...(original.features[0].kind==='sketch'?original.features[0].graph:{}),relations:[owner]}});
    await h.render([...selection].reverse());expect(field('Point on line').checked).toBe(true);expect(field('Midpoint').disabled).toBe(true);await act(async()=>field('Point on line').click());expect(field('Midpoint').disabled).toBe(false);await act(async()=>field('Point on line').click());expect(h.pending).toHaveBeenLastCalledWith(false);expect(h.edit).toHaveBeenCalledTimes(1);
    await act(async()=>field('Point on line').click());await click('Apply');expect(h.session.getSnapshot().document.features).toEqual(original.features);
    await act(async()=>h.session.undo());expect(h.session.getSnapshot().document).toEqual(accepted);
  });
});

describe('declared smooth line–arc joints',()=>{
  const rounded=()=>parseCadDocument({...createCadDocument('Rounded detail'),schemaVersion:2,parameters:{bendRadius:5},features:[{
    id:'sketch',kind:'sketch',name:'Detail',plane:'XY',offset:0,suppressed:false,profiles:[],graph:{
      points:[{id:'a',position:[' -10 ','0']},{id:'joint',position:[' 0 ','0']},{id:'center',position:[0,5]},{id:'end',position:[5,' bendRadius ']}],
      entities:[{id:'line',kind:'line',startPointId:'a',endPointId:'joint',construction:false},{id:'arc',kind:'arc',centerPointId:'center',startPointId:'joint',endPointId:'end',direction:'ccw',construction:false}],
      relations:[{id:'radius',kind:'radial-size',entityId:'arc',quantity:'radius',value:' bendRadius '}]}}]});
  it('keeps a tangent joint private and restores its exact endpoint tuple across reversed selection',async()=>{
    const original=rounded(),selection:readonly CadSketchGraphSelection[]=[{kind:'entity',id:'arc'},{kind:'entity',id:'line'}],h=await mount(original,selection);
    await act(async()=>field('Tangent').click());await click('Cancel');expect(h.session.getSnapshot().document).toBe(original);expect(h.edit).not.toHaveBeenCalled();
    await act(async()=>field('Tangent').click());await click('Apply');const edit=h.edit.mock.calls[0]?.[0][0];
    expect(edit).toMatchObject({kind:'set-sketch-relation',sketchId:'sketch',relation:{kind:'tangent-joint',endpoints:[{entityId:'arc',pointId:'joint'},{entityId:'line',pointId:'joint'}]}});
    if(edit?.kind!=='set-sketch-relation')throw Error('Missing tangent joint');const accepted=h.session.getSnapshot().document;
    expect(accepted.features[0]).toEqual({...original.features[0],graph:{...(original.features[0].kind==='sketch'?original.features[0].graph:{}),relations:[original.features[0].kind==='sketch'?original.features[0].graph?.relations[0]:null,edit.relation]}});
    await h.render([...selection].reverse());expect(field('Tangent').checked).toBe(true);await act(async()=>field('Tangent').click());await act(async()=>field('Tangent').click());expect(h.pending).toHaveBeenLastCalledWith(false);expect(h.edit).toHaveBeenCalledTimes(1);
    await act(async()=>field('Tangent').click());await click('Apply');expect(h.session.getSnapshot().document.features).toEqual(original.features);await act(async()=>h.session.undo());expect(h.session.getSnapshot().document).toEqual(accepted);
  });
  it('requires a declared joint even when the separate endpoints have equal coordinates',async()=>{
    const source=rounded(),first=source.features[0];if(first.kind!=='sketch'||!first.graph)throw Error('Missing sketch');
    const detached=parseCadDocument({...source,features:[{...first,graph:{...first.graph,points:[...first.graph.points,{id:'separate',position:[0,0]}],
      entities:first.graph.entities.map(entity=>entity.kind==='arc'?{...entity,startPointId:'separate'}:entity)}}]});
    const h=await mount(detached,[{kind:'entity',id:'arc'},{kind:'entity',id:'line'}]);expect(field('Tangent').disabled).toBe(true);expect(h.pending).toHaveBeenLastCalledWith(false);expect(h.edit).not.toHaveBeenCalled();
  });
});
