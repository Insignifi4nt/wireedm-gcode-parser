import { act, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { CadFeatureEditor } from '@/features/cad/CadFeatureEditor';
import { CadSession } from '@/features/cad/cadSession';
import type { CadFeatureReferencePickCommand, CadFeatureRegionPickCommand } from '@/features/cad/cadFeatureReferencePicking';
import type { CadFeaturePreviewCommand } from '@/features/cad/cadFeaturePreview';
import type { CadExtrudeDepthControl } from '@/features/cad/cadExtrudeDepthInteraction';

const observed = vi.hoisted(() => ({ resolutions: 0 }));
vi.mock('@/domain/cad/cadSketchGeometry', async original => {
  const module = await original<typeof import('@/domain/cad/cadSketchGeometry')>();
  return { ...module, resolveCadSketchContours(...args: Parameters<typeof module.resolveCadSketchContours>) {
    observed.resolutions++; return module.resolveCadSketchContours(...args);
  } };
});

it('shares actual120-tooth picker cells through named-depth edits while current quantity and Cancel remain exact', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const geometry = createCadPluginProfile(CAD_GEAR_V3_PLUGIN), source: CadSketchFeature = { id: 'gear', name: 'Gear and bore', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'outline', name: 'Spur gear', construction: false, geometry: { ...geometry, inputs: { ...geometry.inputs, teeth: 120 } } },
      { id: 'bore', name: 'Shaft bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 6 } }] };
  const session = new CadSession({ ...createCadDocument('Cache interaction', 'cache_interaction'), parameters: { depth: 5 }, features: [source,
    { id: 'body', name: 'Gear thickness', kind: 'extrude', suppressed: false, sketchId: source.id, distance: ' depth ', symmetric: false, operation: 'new', targetId: null }] });
  const before = session.getSnapshot(), exact = JSON.stringify(before.document), previews: CadFeaturePreviewCommand[] = [];
  let command: CadFeatureReferencePickCommand = { kind: 'clear', owner: '' }, control: CadExtrudeDepthControl | null = null;
  const reference = (next: CadFeatureReferencePickCommand) => { command = next; };
  const preview = (next: CadFeaturePreviewCommand) => previews.push(next);
  const depth = (next: CadExtrudeDepthControl | null, released?: CadExtrudeDepthControl) => { if (next || released === control) control = next; };
  function Harness() {
    const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot), [open, setOpen] = useState(true);
    return open ? <CadFeatureEditor feature={snapshot.document.features[1]} document={snapshot.document} documentVersion={snapshot.version} isNew={false}
      onPendingChange={session.setWorkflowOpen} onReferencePick={reference} onFeaturePreview={preview} onDepthInteractionReady={depth}
      onApply={() => { throw Error('Interaction must remain provisional'); }} onCancel={() => { session.setWorkflowOpen(false); setOpen(false); }} /> : null;
  }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  const current = () => { if (command.kind !== 'pick-regions') throw Error('Actual picker did not open'); return command; };
  async function begin(): Promise<CadFeatureRegionPickCommand> {
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Pick closed areas from model"]'); if (!button) throw Error('Actual area control missing');
    await act(async () => button.click()); return current();
  }
  observed.resolutions = 0;
  try {
    await act(async () => root.render(<Harness />));
    const initial = await begin(); expect(initial.cells.pick({ x: 20, y: 0 })?.reference.boundaryProfileId).toBe('outline');
    await act(async () => initial.onCancel());
    expect(observed.resolutions).toBe(1);
    for (let index = 0; index < 12; index++) {
      const input = container.querySelector<HTMLInputElement>('[aria-label="Length mm"]'); if (!input) throw Error('Actual Length missing');
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(6 + index / 10));
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    const candidate = previews.at(-1); expect(candidate?.kind).toBe('candidate');
    if (candidate?.kind !== 'candidate') throw Error('No live named-depth candidate');
    expect(candidate.edits).toEqual([{ kind: 'update-feature', feature: before.document.features[1] }, { kind: 'set-parameter', name: 'depth', value: 7.1 }]);
    const owned = control as CadExtrudeDepthControl | null;
    expect(owned?.getState()?.model.quantityMm).toBe(7.1);
    const next = await begin(); expect(next.cells).toBe(initial.cells); expect(observed.resolutions).toBe(1);
    const hit = next.cells.pick({ x: 20, y: 0 }); if (!hit) throw Error('Material cell disappeared');
    await act(async () => next.onSelect([hit.reference])); await act(async () => current().onCancel());
    expect(container.querySelector<HTMLInputElement>('[aria-label="Length mm"]')?.value).toBe('7.1');
    const cancel = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === 'Cancel'); if (!cancel) throw Error('Feature Cancel missing');
    await act(async () => cancel.click());
    expect(session.getSnapshot()).toMatchObject({ document: before.document, version: before.version, canUndo: false, canRedo: false, workflowOpen: false });
    expect(JSON.stringify(session.getSnapshot().document)).toBe(exact); expect(previews.at(-1)?.kind).toBe('clear');
    expect(control).toBeNull();
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
