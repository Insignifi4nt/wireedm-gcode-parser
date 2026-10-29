import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSketchConstraintStatus, type CadSketchConstraintReport } from './CadSketchConstraintStatus';
import type { CadSketchConstraintInspection } from './cadSketchConstraintInspection';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

function plate() {
  const source = parseCadDocument({ ...createCadDocument('Plate', 'status-plate'), schemaVersion: 2, features: [{
    id: 'sketch', kind: 'sketch', name: 'Plate', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'center', position: [0, 0] }], entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: 5, construction: false }], relations: [] } }] });
  const sketch = source.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
  const answers: ((degreesOfFreedom: number | null) => void)[] = [], failures: ((cause: Error) => void)[] = [];
  const inspect = (sketchId: string) => new Promise<CadSketchConstraintInspection>((resolve, reject) => { failures.push(reject); answers.push(degreesOfFreedom => resolve({
    sketchId, pointCount: 1, entityCount: 1, relationCount: 0, legacyProfileCount: 0, legacyDimensionCount: 0, degreesOfFreedomScope: 'graph', graph: null, parameters: {},
    analysis: { kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } })); });
  const reports: (string | null)[] = [];
  const onReport = (report: CadSketchConstraintReport | null) => { reports.push(report && `${report.version} ${report.live ? 'live' : 'paused'} ${report.analysis.diagnostics.degreesOfFreedom}`); };
  const render = (enabled: boolean, version = '1') => act(async () => root.render(<CadSketchConstraintStatus document={source} sketch={sketch} version={version} inspect={inspect} enabled={enabled} onReport={onReport} />));
  return { answers, failures, reports, render };
}
const status = () => container.querySelector('[aria-label="Sketch constraint status"]')?.textContent;

it('reports each answer without first reporting nothing, and nothing once it is removed', async () => {
  const { answers, reports, render } = plate();
  await render(true); await act(async () => answers[0](3));
  expect(reports).toEqual([null, '1 live 3']);
  await render(false); await render(true);
  expect(reports).toEqual([null, '1 live 3', '1 paused 3', '1 live 3']);
  // The new analysis gives the same answer, reported again on its own.
  await act(async () => answers[1](3));
  expect(reports).toEqual([null, '1 live 3', '1 paused 3', '1 live 3', '1 live 3']);
  await act(async () => root.unmount());
  expect(reports).toEqual([null, '1 live 3', '1 paused 3', '1 live 3', '1 live 3', null]);
});

it('names the definition state, keeps the last result while the next version is checked and drops it on failure', async () => {
  const { answers, failures, reports, render } = plate();
  await render(true); await act(async () => answers[0](3));
  expect(status()).toBe('Under defined · 3 DOF');
  expect(container.querySelector('[aria-label="Sketch colours"]')?.getAttribute('aria-description')).toMatch(/^Green: fully defined/);
  // The workbench decides what an older version may still show; the status only says which version answered.
  await render(true, '2');
  expect(status()).toBe('Checking freedom…'); expect(reports.at(-1)).toBe('1 live 3');
  await act(async () => answers[1](0));
  expect(status()).toBe('Fully defined'); expect(reports.at(-1)).toBe('2 live 0');
  await render(true, '3'); await act(async () => answers[2](null));
  expect(status()).toBe('Definition unknown');
  await render(true, '4'); await act(async () => failures[3](new Error('Solver offline.')));
  expect(status()).toBe('Freedom unavailable'); expect(reports.at(-1)).toBeNull();
});
