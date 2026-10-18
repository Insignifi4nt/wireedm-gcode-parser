import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { prepareCadSketchCells } from '@/domain/cad/cadSketchRegionInspection';
import type { CadFeatureReferencePickCommand, CadFeatureRegionPickCommand } from './cadFeatureReferencePicking';
import type { CadSketchAreaRepairInspection } from './cadSketchEditDraft';
import { CadSketchAreaRepairPanel, type CadSketchAreaRepairPanelProps } from './CadSketchAreaRepairPanel';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function fixture() {
  const document = parseCadDocument({ ...createCadDocument(), features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'new-boundary', name: 'Plate', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
  ] }] });
  const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Sketch fixture missing.');
  const cells = prepareCadSketchCells(sketch, document.parameters);
  const inspection: CadSketchAreaRepairInspection = { sketchId: 'sketch', localVersion: 'local', consumers: ['pad', 'second-pad'].map(id => ({ cells,
    feature: { id, name: id, kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null,
      regionSelection: [{ boundaryProfileId: 'old-boundary', voidProfileIds: [], ancestorProfileIds: [] }] }, issue: 'Boundary replaced'
  })) };
  const ready = vi.fn(), finish = vi.fn<CadSketchAreaRepairPanelProps['onFinish']>(), cancel = vi.fn();
  let pick: CadFeatureRegionPickCommand | null = null;
  const onPick = vi.fn((command: CadFeatureReferencePickCommand) => { pick = command.kind === 'pick-regions' ? command : null; });
  await act(async () => root.render(<CadSketchAreaRepairPanel formId="repair" document={document} documentVersion="local" inspection={inspection}
    onReferencePick={onPick} onReadyChange={ready} onFinish={finish} onCancel={cancel} interactionLocked={false} />));
  const choose = async (id: string) => {
    const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Choose areas for ${id}"]`);
    if (!button) throw new Error('Consumer area action missing.'); await act(async () => button.click());
  };
  const picker = () => { if (!pick) throw new Error('Region picker missing.'); return pick; };
  return { ready, finish, cancel, choose, picker, inspection, cells, onPick };
}

it('requires explicit areas for every stale consumer and restores the previous choice when picking is cancelled', async () => {
  const h = await fixture(), reference = h.cells.cells[0].reference;
  expect(h.ready).toHaveBeenLastCalledWith(false);
  await h.choose('pad'); expect(h.picker().selection).toEqual([]);
  await act(async () => { h.picker().onSelect([reference]); });
  await act(async () => { h.picker().onCancel(); });
  expect(h.ready).toHaveBeenLastCalledWith(false);
  await h.choose('pad'); expect(h.picker().selection).toEqual([]);
  await act(async () => { h.picker().onSelect([reference]); }); await act(async () => h.picker().onFinish());
  expect(h.ready).toHaveBeenLastCalledWith(false);
  await h.choose('second-pad'); await act(async () => h.picker().onSelect([reference])); await act(async () => h.picker().onFinish());
  expect(h.ready).toHaveBeenLastCalledWith(true);
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(h.finish).toHaveBeenCalledExactlyOnceWith({ localVersion: 'local', selections: [{ featureId: 'pad', selection: [reference] }, { featureId: 'second-pad', selection: [reference] }] }, expect.any(AbortSignal));
});

it('aborts a pending final application on unmount and ignores its late completion', async () => {
  const h = await fixture(), reference = h.cells.cells[0].reference;
  for (const id of ['pad', 'second-pad']) { await h.choose(id); await act(async () => h.picker().onSelect([reference])); await act(async () => h.picker().onFinish()); }
  let resolve: () => void = () => undefined;
  h.finish.mockReturnValueOnce(new Promise<void>(accept => { resolve = accept; }));
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const signal: unknown = h.finish.mock.calls[0]?.[1]; expect(signal).toBeInstanceOf(AbortSignal);
  await act(async () => root.render(null));
  expect((signal as AbortSignal).aborted).toBe(true);
  await act(async () => resolve()); expect(h.finish).toHaveBeenCalledOnce(); expect(h.ready).toHaveBeenLastCalledWith(false);
});

it('ignores a closed picker callback while another consumer owns area selection', async () => {
  const h = await fixture(); await h.choose('pad'); const previous = h.picker();
  await act(async () => previous.onSelect([h.cells.cells[0].reference])); await act(async () => previous.onFinish());
  await h.choose('second-pad'); const current = h.picker();
  await act(async () => { previous.onSelect([]); previous.onCancel(); });
  expect(h.picker()).toBe(current); expect(h.ready).toHaveBeenLastCalledWith(false);
  await act(async () => current.onSelect([h.cells.cells[0].reference])); await act(async () => h.picker().onFinish());
  expect(h.ready).toHaveBeenLastCalledWith(true);
});
