import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadCurveFeature, CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { CadSession } from './cadSession';
import { CadSketchMeasurements } from './CadSketchMeasurements';
import { CadCurveMeasurements } from './CadCurveMeasurements';

let container: HTMLDivElement, root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function value(label: string) {
  const term = [...container.querySelectorAll('dt')].find(term => term.textContent === label);
  if (!term) throw new Error(`Missing ${label}`); return term.nextElementSibling?.textContent;
}
async function expand(label: string) {
  const summary = [...container.querySelectorAll('summary')].find(summary => summary.textContent === label);
  if (!summary) throw new Error(`Missing ${label}`); await act(async () => summary.click());
}
it('keeps accepted tiny sketch area and bounds nonzero while preserving ordinary localized perimeter display', async () => {
  const part = parseCadDocument({ ...createCadDocument(), parameters: { width: 4e-7 }, features: [{ id: 'sketch', name: 'Tiny sketch', kind: 'sketch', suppressed: false,
    plane: 'XY', offset: 0, profiles: [{ id: 'profile', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: ' width ', height: 20, cornerRadius: 0 } }] }] });
  const session = new CadSession(part), before = session.getSnapshot(), measurement = measureCadSketch(part, 'sketch');
  expect(measurement.materialAreaMm2).toBeCloseTo(8e-6, 15);
  const scientific = (number: number) => number.toLocaleString(undefined, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false });
  await act(async () => root.render(<CadSketchMeasurements document={part} sketchId="sketch" profileId="profile" />));
  expect(value('Area')).toBe(`${scientific(8e-6)} mm²`); expect(value('Width × height')).toBe(`${scientific(4e-7)} × 20 mm`);
  expect(value('Perimeter')).toBe(`${measurement.boundaryLengthMm.toLocaleString(undefined, { maximumFractionDigits: 3 })} mm`);
  expect(session.getSnapshot()).toBe(before);
});
it('keeps tiny curve length and placement nonzero without using coordinate indices as display precision', async () => {
  const x = 1.23456789, y = -2.34567891;
  const part = parseCadDocument({ ...createCadDocument(), features: [{ id: 'rail', name: 'Rail', kind: 'curve', suppressed: false, plane: 'XY', offset: 4e-7,
    segments: [{ kind: 'line', start: [x, y], end: [x + 4e-7, y] }] }] }), session = new CadSession(part), before = session.getSnapshot(), curve = part.features[0];
  if (curve.kind !== 'curve') throw new Error('Missing curve');
  const scientific = (number: number) => number.toLocaleString(undefined, { notation: 'scientific', maximumSignificantDigits: 6, useGrouping: false });
  await act(async () => root.render(<CadCurveMeasurements document={part} curve={curve} />));
  expect(value('Length')).toBe(`${scientific(4e-7)} mm`);
  expect(value('Start (world)')).toBe(`${x.toLocaleString(undefined, { maximumFractionDigits: 4 })}, ${y.toLocaleString(undefined, { maximumFractionDigits: 4 })}, ${scientific(4e-7)} mm`);
  expect(session.getSnapshot()).toBe(before);
});
it('separates a selected profile area and bounds from the aggregate sketch contour count', async () => {
  const part: CadDocument = { ...createCadDocument(), features: [{ id: 'section', name: 'Ring', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'outer', name: 'Stock', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 3 } },
    { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } }
  ] }] };
  await act(async () => root.render(<CadSketchMeasurements document={part} sketchId="section" profileId="outer" />));
  expect(value('Area')).toBe('28.274 mm²'); expect(value('Perimeter')).toBe('18.85 mm');
  expect(value('Sketch closed contours')).toBe('2');
  const details = container.querySelector('details'); expect(details?.open).toBe(false);
  await expand('Measurements'); expect(details?.open).toBe(true);
  expect(value('Width × height')).toBe('6 × 6 mm'); expect(value('Min X, Y')).toBe('-3, -3 mm');
  await act(async () => root.render(<CadSketchMeasurements document={part} sketchId="section" profileId={null} />));
  expect(value('Material area')).toBe('25.133 mm²'); expect(value('Closed contours')).toBe('2');
});
it('keeps analytic curve length visible while disclosing authored world endpoints and bounds on request', async () => {
  const curve: CadCurveFeature = { kind: 'curve', id: 'rail', name: 'Rail', suppressed: false, plane: 'XY', offset: 5,
    segments: [{ kind: 'line', start: [1, 2], end: [4, 6] }] };
  const part = { ...createCadDocument(), features: [curve] };
  await act(async () => root.render(<CadCurveMeasurements curve={curve} document={part} />));
  expect(value('Length')).toBe('5 mm');
  const details = container.querySelector('details'); expect(details?.open).toBe(false);
  await expand('Coordinates'); expect(details?.open).toBe(true);
  expect(value('Start (world)')).toBe('1, 2, 5 mm'); expect(value('End (world)')).toBe('4, 6, 5 mm');
  expect(value('Bounds (world)')).toBe('1, 2, 5 → 4, 6, 5 mm');
});
