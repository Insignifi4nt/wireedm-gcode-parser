import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadFeature } from '@/domain/cad/cadDocument';
import type { CadPocketFeature } from '@/domain/cad/cadPocket';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadExtrudeFields } from './CadExtrudeFields';

type Feature = Extract<CadFeature, { kind: 'extrude' }> | CadPocketFeature;
const profile: CadFeature = { id: 'profile', name: 'Bore', kind: 'sketch', suppressed: false, plane: 'XZ', offset: 4, profiles: [] };
const original: Feature = { id: 'cut', name: 'Cut', suppressed: false, kind: 'extrude', sketchId: 'profile', targetId: 'stock', operation: 'cut', distance: '-depth / 2', symmetric: false };
const document = { ...createCadDocument('Extent editing'), parameters: { depth: 12 }, features: [profile] };
let root: Root; let container: HTMLDivElement; let current: Feature;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = globalThis.document.createElement('div'); globalThis.document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function mount(initial: Feature = original, bodies = [{ value: 'stock', label: 'Stock' }], sketches = [{ value: 'profile', label: 'Bore' }]) {
  function Harness() {
    const [feature, setFeature] = useState(initial); current = feature;
    return <CadExtrudeFields feature={feature} initialFeature={initial} document={document} bodies={bodies} sketches={sketches} onChange={setFeature} />;
  }
  await act(async () => root.render(<Harness />));
}
function field(label: string) { return [...container.querySelectorAll('label')].find(entry => entry.querySelector('span')?.childNodes[0]?.textContent === label); }
async function select(label: string, value: string) {
  const input = field(label)?.querySelector('select'); if (!input) throw new Error(`Missing ${label}`);
  await act(async () => { input.value = value; input.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function length(value: string) {
  const input = field('Length')?.querySelector('input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setter) throw new Error('Missing length');
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('compact distance / Through-all forms', () => {
  it('changes extent explicitly, keeps the feature identity, and preserves expressions locally when toggling back', async () => {
    await mount(); await select('Extent', 'through-all');
    expect(current).toEqual({ id: 'cut', name: 'Cut', suppressed: false, kind: 'pocket', sketchId: 'profile', targetId: 'stock', extent: { kind: 'through-all', direction: 'negative' } });
    expect(field('Length')).toBeUndefined(); expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(field('Direction')?.querySelector('select')?.selectedOptions[0].textContent).toBe('+Y from sketch');
    await select('Direction', 'both'); await select('Extent', 'distance'); expect(current).toEqual(original);
    await length('depth * 2'); await select('Extent', 'through-all'); expect(current).toMatchObject({ extent: { direction: 'positive' } });
    await select('Extent', 'distance'); expect(current).toMatchObject({ distance: 'depth * 2' });
  });
  it('maps symmetric distance to Both and only exposes through-all for a cut operation', async () => {
    await mount({ ...original, symmetric: true }); await select('Extent', 'through-all'); expect(current).toMatchObject({ extent: { direction: 'both' } });
    await select('Operation', 'new'); expect(current).toEqual({ ...original, symmetric: true, operation: 'new', targetId: null });
    expect(field('Extent')).toBeUndefined(); expect(field('Direction')).toBeUndefined(); expect(field('Target body')).toBeUndefined();
    await select('Operation', 'join'); expect(current).toMatchObject({ kind: 'extrude', operation: 'join', targetId: 'stock' }); expect(field('Extent')).toBeUndefined();
    await select('Operation', 'cut'); expect(field('Extent')).toBeDefined();
  });
  it.each(['positive', 'negative', 'both'] as const)('uses an explicit editable default when a saved %s Pocket changes to distance', async direction => {
    await mount({ id: 'cut', name: 'Saved Pocket', suppressed: false, kind: 'pocket', sketchId: 'profile', targetId: 'stock', extent: { kind: 'through-all', direction } });
    await select('Extent', 'distance'); expect(current).toEqual({ id: 'cut', name: 'Saved Pocket', suppressed: false, kind: 'extrude', sketchId: 'profile', targetId: 'stock', operation: 'cut',
      distance: direction === 'negative' ? -10 : 10, symmetric: direction === 'both' });
  });
  it('retains an invalid inactive distance for correction without serializing it into Through-all', async () => {
    await mount(); await length('missing'); await select('Extent', 'through-all'); expect(current).not.toHaveProperty('distance');
    expect(current).toMatchObject({ extent: { direction: 'positive' } }); await select('Extent', 'distance'); expect(current).toHaveProperty('distance', 'missing');
    expect(field('Length')?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
  });
  it('displays missing or unavailable references truthfully until explicitly replaced', async () => {
    await mount({ ...original, sketchId: '', targetId: null }, [{ value: 'other', label: 'Other body' }], [{ value: 'other_profile', label: 'Other profile' }]);
    for (const name of ['Profile sketch', 'Target body']) {
      const select = field(name)?.querySelector('select'); expect(select?.value).toBe(''); expect(select?.selectedOptions[0].disabled).toBe(true);
    }
    expect(current).toMatchObject({ sketchId: '', targetId: null }); await select('Target body', 'other'); expect(current).toHaveProperty('targetId', 'other');
    await select('Profile sketch', 'other_profile'); expect(current).toHaveProperty('sketchId', 'other_profile');
  });
});
