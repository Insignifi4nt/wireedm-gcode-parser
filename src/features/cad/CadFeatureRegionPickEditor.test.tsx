import { act, useState, useSyncExternalStore, type ContextType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { prepareCadSketchCells, type CadPreparedSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import { prepareCadDatumFrames, resolveCadSketchPlacement } from '@/domain/cad/cadDatumPlanes';
import { CadFeatureReferencePickingContext, type CadFeatureReferencePickCommand, type CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import { CadFeatureEditor } from './CadFeatureEditor';
import { CadSession } from './cadSession';
import { cadFeatureCandidateEdits, cadFeatureCandidateKey, type CadFeaturePreviewCommand, type CadFeaturePreviewState } from './cadFeaturePreview';

type FieldsProps = Parameters<typeof import('./CadExtrudeFields').CadExtrudeFields>[0];
const observed = vi.hoisted(() => ({ context: null as ContextType<typeof CadFeatureReferencePickingContext>, props: null as FieldsProps | null }));
// Observe the form-owned context while retaining the actual fields and operations.
vi.mock('./CadExtrudeFields', async original => {
  const module = await original<typeof import('./CadExtrudeFields')>(), react = await import('react');
  return { ...module, CadExtrudeFields(props: FieldsProps) {
    observed.context = react.useContext(CadFeatureReferencePickingContext); observed.props = props;
    return react.createElement(module.CadExtrudeFields, props);
  } };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); observed.context = null; observed.props = null; vi.unstubAllGlobals(); });
function part(): CadDocument {
  return { ...createCadDocument('Area picking', 'area_picking'), parameters: { depth: 10 }, features: [
    { id: 'outline', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 'depth / 2', profiles: [
      { id: 'outer', name: 'Outer', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } },
      { id: 'hole', name: 'Inner circle', construction: false, geometry: { kind: 'circle', x: 10, y: 5, radius: 2 } }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'outline', distance: ' depth ', symmetric: false, operation: 'new', targetId: null }
  ] };
}
function length() { const input = container.querySelector<HTMLInputElement>('[aria-label="Length mm"]'); if (!input) throw new Error('Missing Length'); return input; }
async function type(text: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(length(), text); length().dispatchEvent(new Event('input', { bubbles: true })); }); }
function assertContourCommand(command: CadFeatureRegionPickCommand): asserts command is CadFeatureRegionPickCommand & { cells: CadPreparedSketchCells } {
  if (command.cells.mode !== 'contours') throw new Error('Expected whole-contour catalog for this legacy fixture.');
}
async function mount(forcePreviewEnabled = false) {
  const session = new CadSession(part()), before = session.getSnapshot(), preview = vi.fn<(command: CadFeaturePreviewCommand) => void>();
  let picker: CadFeatureReferencePickCommand = { kind: 'clear', owner: '' }, publish: ((state: CadFeaturePreviewState) => void) | undefined,
    setReference: ((command: CadFeatureReferencePickCommand) => void) | undefined;
  const reference = (command: CadFeatureReferencePickCommand) => { picker = command; setReference?.(command); };
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [state, setState] = useState<CadFeaturePreviewState>({ kind: 'idle' }),
      [selection, select] = useState<CadFeatureReferencePickCommand>({ kind: 'clear', owner: '' }); publish = setState; setReference = select;
    return <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} documentVersion={snapshot.version} isNew={false}
      onPendingChange={session.setWorkflowOpen} onReferencePick={reference} onFeaturePreview={preview} featurePreview={state} previewEnabled={forcePreviewEnabled || selection.kind !== 'pick'}
      onCancel={() => session.setWorkflowOpen(false)} onApply={(feature, parameters) => session.edit(cadFeatureCandidateEdits({ feature, isNew: false, parameters }))} />;
  }
  await act(async () => root.render(<Harness />));
  const command = () => { if (picker.kind !== 'pick-regions') throw new Error('Expected region command'); assertContourCommand(picker); return picker; };
  const candidate = () => { const latest = preview.mock.calls.at(-1)?.[0]; if (!latest || latest.kind !== 'candidate') throw new Error('Expected candidate'); return latest; };
  const ready = async () => { const next = candidate(); await act(async () => publish?.({ kind: 'ready', owner: next.owner, baseVersion: next.expectedVersion, featureId: 'pad', candidateId: 'region_preview',
    definitionKey: cadFeatureCandidateKey(next.edits), document: applyCadEdits(session.getSnapshot().document, next.edits), result: { buildId: 'region_preview', meshes: [], diagnostics: [], durationMs: 0 } })); };
  const begin = async () => {
    const props = observed.props; if (!props) throw new Error('Fields unavailable');
    const sketch = props.document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch');
    const cells = prepareCadSketchCells(sketch, props.document.parameters), placement = resolveCadSketchPlacement(sketch, props.document.parameters, prepareCadDatumFrames(props.document.features, props.document.parameters));
    await act(async () => observed.context?.beginRegions?.(sketch.id, cells, placement, props.feature.regionSelection,
      selection => props.onChange({ ...props.feature, regionSelection: selection })));
    return command();
  };
  return { session, before, preview, command, candidate, ready, begin };
}

it('waits for explicit intersection areas before requesting a native preview, then publishes only the deliberate choice', async () => {
  const document: CadDocument = { ...createCadDocument(), schemaVersion: 2, features: [{ id: 'overlap', kind: 'sketch', name: 'Overlap', suppressed: false,
    plane: 'XY', offset: 0, profiles: [], graph: { points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [6, 0] }], entities: [
      { id: 'left', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
      { id: 'right', kind: 'circle', construction: false, centerPointId: 'b', radius: 5 }], relations: [] } }] };
  const feature = { id: 'pad', kind: 'extrude', name: 'Lens', suppressed: false, sketchId: 'overlap', distance: 5,
    symmetric: false, operation: 'new', targetId: null } as const;
  const preview = vi.fn<(command: CadFeaturePreviewCommand) => void>(), apply = vi.fn();
  let owned: CadFeatureReferencePickCommand | undefined;
  await act(async () => root.render(<CadFeatureEditor feature={feature} document={document} documentVersion="accepted" isNew
    onPendingChange={vi.fn()} onReferencePick={command => { owned = command; }} onFeaturePreview={preview} onApply={apply} onCancel={vi.fn()} />));
  expect(preview.mock.calls.every(([command]) => command.kind === 'clear')).toBe(true);
  const pick = container.querySelector<HTMLButtonElement>('[aria-label="Pick closed areas from model"]'); if (!pick) throw new Error('Area action missing.');
  await act(async () => pick.click());
  const picker = owned; if (picker?.kind !== 'pick-regions') throw new Error('Owned area selection missing.');
  const lens = picker.cells.pick({ x: 3, y: 0 }); if (!lens) throw new Error('Lens missing.');
  const selection = picker.cells.pack([lens.id]);
  await act(async () => picker.onSelect(selection)); await act(async () => picker.onFinish());
  expect(preview).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'candidate', edits: [expect.objectContaining({ feature: { ...feature, regionSelection: selection } })] }));
  expect(apply).not.toHaveBeenCalled(); expect(document.features).toHaveLength(1);
});

it('publishes actual provisional placement and live area selection, then Cancel restores only the pre-picker feature while retaining the typed shared depth', async () => {
  const h = await mount(); await type('20'); await h.ready(); const picker = await h.begin();
  expect(picker.placement.offsetMm).toBe(10); expect(container.querySelector<HTMLFieldSetElement>('.cad-feature-fields')?.disabled).toBe(true);
  const cell = picker.cells.cells.find(cell => cell.reference.boundaryProfileId === 'hole'); if (!cell) throw new Error('Inner region unavailable');
  await act(async () => picker.onSelect([cell.reference])); expect(h.command().selection).toEqual([cell.reference]);
  expect(h.candidate().edits[0].feature).toMatchObject({ regionSelection: [cell.reference] });
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false, workflowOpen: true });
  await act(async () => h.command().onCancel()); expect(length().value).toBe('20');
  expect(h.candidate().edits[0].feature).toEqual(h.before.document.features[1]); expect(h.candidate().edits[1]).toEqual({ kind: 'set-parameter', name: 'depth', value: 20 });
  expect(h.session.getSnapshot().canUndo).toBe(false);
});

it('pauses a whole-source preview even if its caller leaves general previews enabled, then resumes the same numeric draft after cancellation', async () => {
  const h = await mount(true); await type('20'); await h.ready();
  await act(async () => observed.context?.begin('Profile sketch', ['outline'], () => undefined));
  expect(h.preview).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'clear' }));
  const cancel = container.querySelector<HTMLButtonElement>('[aria-label="Cancel source selection"]'); if (!cancel) throw new Error('Source cancellation unavailable');
  await act(async () => cancel.click()); expect(length().value).toBe('20');
  expect(h.candidate().edits[1]).toEqual({ kind: 'set-parameter', name: 'depth', value: 20 });
  expect(h.session.getSnapshot()).toMatchObject({ document: h.before.document, version: h.before.version, canUndo: false });
});

it('keeps Done-selected area plus the named quantity draft provisional until current readiness and one atomic Apply/Undo', async () => {
  const h = await mount(); await type('20'); await h.ready(); const picker = await h.begin(), cell = picker.cells.cells.find(cell => cell.reference.boundaryProfileId === 'hole');
  if (!cell) throw new Error('Inner region unavailable'); await act(async () => picker.onSelect([cell.reference])); await act(async () => h.command().onFinish());
  expect(h.candidate().edits[0].feature).toMatchObject({ distance: ' depth ', regionSelection: [cell.reference] });
  expect(h.session.getSnapshot().document).toEqual(h.before.document); await h.ready();
  const apply = [...container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Apply'); if (!apply) throw new Error('Apply unavailable');
  expect(apply.disabled).toBe(false); await act(async () => apply.click());
  expect(h.session.getSnapshot().document.parameters.depth).toBe(20); expect(h.session.getSnapshot().document.features[1]).toMatchObject({ distance: ' depth ', regionSelection: [cell.reference] });
  await act(async () => h.session.undo()); expect(h.session.getSnapshot().document).toEqual(h.before.document); expect(h.session.getSnapshot().canUndo).toBe(false);
});

it('leaves a newer picker and a replacement document untouched by late select/finish/cancel callbacks', async () => {
  const h = await mount(), first = await h.begin(); await act(async () => first.onCancel()); const second = await h.begin();
  await act(async () => { first.onSelect(first.cells.cells.map(cell => cell.reference)); first.onFinish(); first.onCancel(); });
  expect(h.command()).toBe(second); expect(h.command().selection).toBeUndefined();
  await act(async () => h.session.replace({ ...h.before.document, name: 'Replacement' })); h.preview.mockClear();
  await act(async () => { second.onSelect(second.cells.cells.map(cell => cell.reference)); second.onFinish(); second.onCancel(); });
  expect(h.session.getSnapshot().document.name).toBe('Replacement'); expect(h.session.getSnapshot().document.features[1]).toEqual(h.before.document.features[1]);
  expect(h.preview.mock.calls.some(([command]) => command.kind === 'candidate')).toBe(false); expect(length().value).toBe('10');
});
