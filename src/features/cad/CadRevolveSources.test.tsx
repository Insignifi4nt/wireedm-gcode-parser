import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadFeatureEditor } from './CadFeatureEditor';
import type { CadFeatureReferencePickCommand } from './cadFeatureReferencePicking';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const principal: CadSketchFeature = { id: 'principal', name: 'Principal', kind: 'sketch', suppressed: false, plane: 'XZ', offset: 4,
  profiles: [{ id: 'section', name: 'Section', construction: false, geometry: { kind: 'rectangle', x: 3, y: 2, width: 8, height: 6, cornerRadius: 0 } }] };
const datum: CadSketchFeature = { ...principal, id: 'datum_profile', name: 'Datum profile', plane: { kind: 'datum-plane', featureId: 'datum' } };

function storedPart(state: 'empty' | 'construction' | 'suppressed') {
  const unavailable: CadSketchFeature = { ...principal, id: 'unavailable', name: 'Stored source', suppressed: state === 'suppressed',
    profiles: state === 'empty' ? [] : state === 'construction' ? principal.profiles.map(profile => ({ ...profile, construction: true })) : principal.profiles };
  const revolve: Extract<CadFeature, { kind: 'revolve' }> = { id: 'revolve', name: 'Stored Revolve', kind: 'revolve', suppressed: true, sketchId: unavailable.id,
    angle: ' turnAngle / 2 ', axis: 'x', operation: 'cut', targetId: 'stock' };
  const features: CadFeature[] = [principal,
    { id: 'datum', name: 'Datum', kind: 'datum-plane', suppressed: false, definition: { kind: 'world', basePlane: 'XY', origin: [3, 4, 5], rotation: [25, 10, 0] } },
    datum, { id: 'stock', name: 'Stock', kind: 'extrude', suppressed: false, sketchId: principal.id, distance: 10, symmetric: false, operation: 'new', targetId: null }];
  features.push(unavailable, revolve);
  const part = applyCadEdits({ ...createCadDocument('Stored source'), parameters: { turnAngle: 270 } }, features.map(feature => ({ kind: 'add-feature', feature })));
  return { part, revolve };
}

function sourceSelect() { const result = container.querySelector<HTMLSelectElement>('select[aria-label="Profile sketch"]'); if (!result) throw new Error('Missing source selection'); return result; }

describe('Revolve source editing', () => {
  it.each([
    { state: 'empty', reason: 'no material contours' }, { state: 'construction', reason: 'no material contours' },
    { state: 'suppressed', reason: 'suppressed' }
  ] satisfies { state: Parameters<typeof storedPart>[0]; reason: string }[])('retains a stored $state source and repairs only the source when a datum sketch is chosen', async ({ state, reason }) => {
    const { part, revolve } = storedPart(state), onApply = vi.fn(), onPendingChange = vi.fn();
    const onReferencePick = vi.fn<(command: CadFeatureReferencePickCommand) => void>();
    await act(async () => root.render(<CadFeatureEditor feature={revolve} document={part} isNew={false} documentVersion="stored_version"
      onApply={onApply} onCancel={vi.fn()} onPendingChange={onPendingChange} onReferencePick={onReferencePick} />));
    const select = sourceSelect();
    expect(select.value).toBe(revolve.sketchId);
    expect([...select.options].map(option => option.value)).toEqual(['unavailable', 'principal', 'datum_profile']);
    expect(select.selectedOptions[0].disabled).toBe(true); expect(select.selectedOptions[0].textContent).toContain(reason);
    expect(select.getAttribute('aria-description')).toContain('closed material contours');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Angle deg"]')?.value).toBe('135');
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Angle deg"]')?.readOnly).toBe(true);
    expect(onApply).not.toHaveBeenCalled(); expect(onPendingChange).toHaveBeenLastCalledWith(false);
    const pick = container.querySelector<HTMLButtonElement>('button[aria-label="Pick profile sketch from model"]'); if (!pick) throw new Error('Missing source picker');
    await act(async () => pick.click());
    const command = onReferencePick.mock.calls.at(-1)?.[0]; if (!command || command.kind !== 'pick') throw new Error('Missing pick command');
    expect(command.eligibleIds).toEqual(['principal', 'datum_profile']);
    await act(async () => command.onSelect('unavailable'));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).not.toBeNull(); expect(select.value).toBe(revolve.sketchId);
    await act(async () => command.onSelect(datum.id));
    expect(container.querySelector('[aria-label="Cancel source selection"]')).toBeNull(); expect(select.value).toBe(datum.id);
    const apply = container.querySelector<HTMLButtonElement>('button[type="submit"]'); if (!apply) throw new Error('Missing Apply');
    await act(async () => apply.click());
    expect(onApply).toHaveBeenCalledExactlyOnceWith({ ...revolve, sketchId: datum.id }, {}, expect.any(AbortSignal));
    expect(part.features.find(feature => feature.id === revolve.id)).toEqual(revolve);
  });
});
