import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadCurveFeature, CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import * as sweepDomain from '@/domain/cad/cadSweep';
import * as sweepUi from './cadSweepUi';
import { CadSweepSources } from './CadSweepSources';

let root: Root; let container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const section: CadSketchFeature = { id: 'section', name: 'Section', kind: 'sketch', suppressed: false, plane: 'YZ', offset: 'position',
  profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 'radius' } }] };
const rail: CadCurveFeature = { id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: 'XY', offset: 0,
  segments: [{ kind: 'line', start: [0, 0], end: ['length', 0] }] };
const savedSweep = { id: 'sweep', name: 'Sweep', kind: 'sweep', suppressed: false, sketchId: 'section', curveId: 'rail', operation: 'new', targetId: null } satisfies sweepDomain.CadSweepFeature;
function sweepDocument(features: CadDocument['features'] = [section, rail], parameters: CadDocument['parameters'] = { position: 0, radius: 1, length: 20 }) {
  return parseCadDocument({ ...createCadDocument('Sweep sources'), parameters, features });
}
function field(label: string) { const select = [...container.querySelectorAll('select')].find(element => element.closest('label')?.querySelector('span')?.textContent === label); if (!select) throw new Error(`Missing ${label}`); return select; }
async function choose(label: string, id: string) { await act(async () => { const select = field(label); select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); }); }

describe('staged Sweep source selectors', () => {
  it('honors selected eligible sources without changing their world geometry or seeking a compatible pair', () => {
    const incompatible = { ...section, id: 'flat', name: 'Flat', plane: 'XY' } satisfies CadSketchFeature;
    const doc = sweepDocument([section, rail, incompatible]); const candidates = sweepUi.inspectCadSweepCandidates(doc);
    const ids = sweepUi.initialCadSweepSourceIds(candidates, 'flat'); expect(ids).toEqual({ sketchId: 'flat', curveId: 'rail' });
    const inspection = sweepDomain.inspectCadSweepInputs({ ...savedSweep, ...ids }, candidates.precedingFeatures, doc.parameters);
    expect(inspection).toMatchObject({ eligible: false, code: 'unsupported-sweep-placement' });
    expect(doc.features[2]).toMatchObject({ plane: 'XY', offset: 'position' }); expect(doc.features[1]).toMatchObject({ segments: [{ end: ['length', 0] }] });
    const selectedRail = { ...rail, id: 'chosen', name: 'Chosen', offset: 5 };
    expect(sweepUi.initialCadSweepSourceIds(sweepUi.inspectCadSweepCandidates(sweepDocument([section, selectedRail, rail])), 'chosen')).toEqual({ sketchId: 'section', curveId: 'chosen' });
  });

  it('limits sources to preceding history and displays stored unavailable inputs truthfully', async () => {
    const suppressed = { ...section, id: 'suppressed', name: 'Suppressed section', suppressed: true };
    const sweep = { ...savedSweep, suppressed: true, sketchId: suppressed.id };
    const later = { ...rail, id: 'later', name: 'Later Curve' };
    const doc = sweepDocument([suppressed, section, rail, sweep, later]); const onChange = vi.fn();
    await act(async () => root.render(<CadSweepSources document={doc} featureId="sweep" sketchId="suppressed" curveId="rail" onChange={onChange} />));
    expect(field('Profile sketch').selectedOptions[0].textContent).toBe('Suppressed section (unavailable)'); expect(field('Profile sketch').selectedOptions[0].disabled).toBe(true);
    expect([...field('Curve').options].some(option => option.value === 'later')).toBe(false); expect(container.querySelector('[role="status"]')?.textContent).toContain('suppressed');
    await choose('Profile sketch', 'section'); expect(onChange).toHaveBeenCalledWith({ sketchId: 'section', curveId: 'rail' });
    const candidates = sweepUi.inspectCadSweepCandidates(doc, 'sweep'); expect(candidates.precedingFeatures.has('sweep')).toBe(false); expect(candidates.precedingFeatures.has('later')).toBe(false);
  });

  it('preserves empty or missing selections instead of displaying the first source as selected', async () => {
    const doc = sweepDocument(); const onChange = vi.fn();
    await act(async () => root.render(<CadSweepSources document={doc} featureId="draft" sketchId="" curveId="missing" onChange={onChange} />));
    expect(field('Profile sketch').value).toBe(''); expect(field('Profile sketch').selectedOptions[0].textContent).toContain('Choose');
    expect(field('Curve').value).toBe('missing'); expect(field('Curve').selectedOptions[0].textContent).toBe('Curve (unavailable)');
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Choose a profile sketch and a Curve.'); expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps selection changes local and reports exact placement advice without relocation', async () => {
    const flat = { ...section, id: 'flat', name: 'Flat', plane: 'XY' } satisfies CadSketchFeature; const doc = sweepDocument([section, rail, flat]); const before = JSON.stringify(doc);
    function Draft() { const [sources, setSources] = useState({ sketchId: 'section', curveId: 'rail' }); return <CadSweepSources document={doc} featureId="draft" {...sources} onChange={setSources} />; }
    await act(async () => root.render(<Draft />)); expect(container.querySelector('[role="status"]')).toBeNull();
    await choose('Profile sketch', 'flat'); expect(container.querySelector('[role="status"]')?.textContent).toContain('YZ sketch at offset 0');
    expect(JSON.stringify(doc)).toBe(before); await choose('Profile sketch', 'section'); expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('caches candidate and pair analysis across unrelated draft rerenders, then reacts to parameter revisions', async () => {
    const doc = sweepDocument(); const inspectCandidates = vi.spyOn(sweepUi, 'inspectCadSweepCandidates'); const inspectPair = vi.spyOn(sweepDomain, 'inspectCadSweepInputs'); const onChange = vi.fn();
    const render = async (current: CadDocument) => { await act(async () => root.render(<CadSweepSources document={current} featureId="draft" sketchId="section" curveId="rail" onChange={onChange} />)); };
    await render(doc); expect(inspectCandidates).toHaveBeenCalledTimes(1); expect(inspectPair).toHaveBeenCalledTimes(1);
    await render({ ...doc, name: 'Unrelated draft name' }); expect(inspectCandidates).toHaveBeenCalledTimes(1); expect(inspectPair).toHaveBeenCalledTimes(1);
    await render({ ...doc, parameters: { ...doc.parameters, position: 4 } }); expect(inspectCandidates).toHaveBeenCalledTimes(2); expect(inspectPair).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('YZ sketch at offset 0');
  });
});
