import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadDatumPlaneFeature, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdgeSelection } from '@/domain/cad/cadTopology';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { resolveCadWorldDatum } from '@/domain/cad/cadDatumPlanes';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile, inspectCadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { CadSession } from './cadSession';
import { ScalarField } from './CadFields';
import { CadPluginFields } from './CadPluginFields';
import { CadGearHelp } from './CadGearHelp';
import { CadDatumPlaneFields } from './CadDatumPlaneFields';
import { CadPlacementNormal } from './CadPlacementNormal';
import { CadLoftSections } from './CadLoftSections';
import { CadSweepSources } from './CadSweepSources';
import { CadTopologyQuerySummary } from './CadTopologyQuerySummary';

let root: Root, container: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(node: ReactNode) { await act(async () => root.render(node)); }
const circle = (id: string, offset: number): CadSketchFeature => ({ id, name: id, kind: 'sketch', suppressed: false, plane: 'XY', offset,
  profiles: [{ id: `${id}_profile`, name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 2 } }] });

it('reports a tiny linked scalar without zeroing it or altering the editable expression', async () => {
  const change = vi.fn();
  await render(<ScalarField label="Width" value=" size " parameters={{ size: 4e-7 }} onChange={change} />);
  expect(container.querySelector<HTMLInputElement>('input')?.value).toBe(' size ');
  expect(container.querySelector('.cad-field-hint')?.textContent).toBe('4e-7 mm');
  expect(container.querySelector('input')?.getAttribute('aria-description')).toBe('4e-7 mm'); expect(change).not.toHaveBeenCalled();
});

it('keeps a tiny plugin placement relation visibly nonzero in its locked field and actual help value', async () => {
  const original = createCadPluginProfile(CAD_GEAR_V3_PLUGIN), profile = { ...original, inputs: { ...original.inputs, x: ' position ' } }, parameters = { position: 4e-7 };
  const session = new CadSession(parseCadDocument({ ...createCadDocument(), parameters, features: [{ ...circle('gear', 0), profiles: [{ id: 'gear_profile', name: 'Gear', construction: false, geometry: profile }] }] }));
  const before = session.getSnapshot(), inspection = inspectCadPluginProfile(profile, parameters), change = vi.fn();
  expect(inspection.issues).toEqual([]);
  await render(<><CadPluginFields profile={profile} parameters={parameters} onChange={change} />
    <section aria-label="Placement help"><CadGearHelp name="x" label="Centre X" unit="mm" values={inspection.values} profile={profile} /></section></>);
  const label = profile.package.inputs.find(input => input.name === 'x')!.label, field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  expect(field?.readOnly).toBe(true); expect(field?.value).toBe('4e-7');
  expect(container.querySelector('[aria-label="Placement help"] output')?.textContent).toBe('4e-7 mm');
  expect(change).not.toHaveBeenCalled(); expect(session.getSnapshot()).toBe(before);
});

it('distinguishes an accepted tiny datum tilt from an axis-aligned normal in both datum and placement readouts', async () => {
  const datum: CadDatumPlaneFeature = { id: 'tilted', name: 'Tilted', kind: 'datum-plane', suppressed: false,
    definition: { kind: 'world', basePlane: 'XY', origin: [0, 0, 0], rotation: [' tilt ', 0, 0] } };
  const document = parseCadDocument({ ...createCadDocument(), parameters: { tilt: 4e-7 }, features: [datum] }), session = new CadSession(document), before = session.getSnapshot(), change = vi.fn();
  expect(resolveCadWorldDatum(datum, document.parameters).normal[1]).toBeLessThan(0);
  await render(<><section aria-label="Datum normal"><CadDatumPlaneFields feature={datum} parameters={document.parameters} onChange={change} /></section>
    <section aria-label="Placed normal"><CadPlacementNormal plane={{ kind: 'datum-plane', featureId: datum.id }} document={document} /></section></>);
  for (const label of ['Datum normal', 'Placed normal']) expect(container.querySelector(`[aria-label="${label}"] dd`)?.textContent).toBe('0, -6.98132e-9, 1');
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Around X deg"]')?.value).toBe(' tilt ');
  expect(change).not.toHaveBeenCalled(); expect(session.getSnapshot()).toBe(before);
});

it('retains a tiny accepted Loft section offset in its placement metadata without changing section sources', async () => {
  const document = parseCadDocument({ ...createCadDocument(), features: [circle('base', 4e-7), circle('top', 20)] }), session = new CadSession(document), before = session.getSnapshot(), change = vi.fn();
  await render(<CadLoftSections document={document} featureId="new_loft" sketchIds={['base', 'top']} onChange={change} />);
  expect(container.querySelector('.cad-loft-section-metadata')?.textContent).toContain('4e-7 mm');
  expect(change).not.toHaveBeenCalled(); expect(session.getSnapshot()).toBe(before);
});

it('retains the tiny world start of a compatible Sweep source in its description', async () => {
  const section = { ...circle('section', 4e-7), plane: 'YZ' as const };
  const document = parseCadDocument({ ...createCadDocument(), features: [section, { id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: 'XY', offset: 0,
    segments: [{ kind: 'line', start: [4e-7, 0], end: [20, 0] }] }] }), session = new CadSession(document), before = session.getSnapshot(), change = vi.fn();
  await render(<CadSweepSources document={document} featureId="new_sweep" sketchId="section" curveId="rail" onChange={change} />);
  expect(container.querySelector('select[aria-label="Curve"]')?.getAttribute('aria-description')).toContain('start (4e-7, 0, 0) mm');
  expect(container.querySelector('[role="status"]')).toBeNull(); expect(change).not.toHaveBeenCalled(); expect(session.getSnapshot()).toBe(before);
});

it('reports exact nonzero geometric selector quantities instead of suggesting a degenerate zero-length edge', async () => {
  const selection: CadEdgeSelection = { expectedCount: 1, queries: [{ kind: 'edges', expectedCount: 1, predicates: [
    { kind: 'line-endpoints', start: [0, 0, 0], end: [4e-7, 0, 0] }, { kind: 'length', value: 4e-7 }] }] }, original = JSON.stringify(selection);
  await render(<CadTopologyQuerySummary selection={selection} />);
  expect(container.textContent).toContain('end: 4e-7, 0, 0'); expect(container.textContent).toContain('value: 4e-7'); expect(JSON.stringify(selection)).toBe(original);
});
