import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { CadSketchConstraintStatus } from './CadSketchConstraintStatus';
import type { CadSketchConstraintInspection } from './cadSketchConstraintInspection';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { container.remove(); vi.unstubAllGlobals(); });

it('reports each answer without first reporting no freedom, and no freedom once it is removed', async () => {
  const source = parseCadDocument({ ...createCadDocument('Plate', 'status-plate'), schemaVersion: 2, features: [{
    id: 'sketch', kind: 'sketch', name: 'Plate', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'center', position: [0, 0] }], entities: [{ id: 'bore', kind: 'circle', centerPointId: 'center', radius: 5, construction: false }], relations: [] } }] });
  const sketch = source.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
  const answers: ((degreesOfFreedom: number) => void)[] = [];
  const inspect = (sketchId: string) => new Promise<CadSketchConstraintInspection>(resolve => answers.push(degreesOfFreedom => resolve({
    sketchId, pointCount: 1, entityCount: 1, relationCount: 0, legacyProfileCount: 0, legacyDimensionCount: 0, degreesOfFreedomScope: 'graph', graph: null, parameters: {},
    analysis: { kind: 'solved', diagnostics: { status: 'success', degreesOfFreedom, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] } } })));
  const reports: (number | null)[] = [], onFreedom = (value: number | null) => { reports.push(value); };
  const render = (enabled: boolean) => act(async () => root.render(<CadSketchConstraintStatus document={source} sketch={sketch} version="1" inspect={inspect} enabled={enabled} onFreedom={onFreedom} />));
  await render(true); await act(async () => answers[0](3));
  expect(reports).toEqual([null, 3]);
  await render(false); await render(true);
  expect(reports).toEqual([null, 3, null, 3]);
  // The new analysis gives the same answer, reported again on its own.
  await act(async () => answers[1](3));
  expect(reports).toEqual([null, 3, null, 3, 3]);
  await act(async () => root.unmount());
  expect(reports).toEqual([null, 3, null, 3, 3, null]);
});
