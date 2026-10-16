// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadSketchLineExtend, extendCadSketchEntity } from '@/domain/cad/cadSketchTrimExtend';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(
  require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

async function prepared(graph: CadSketchGraph, entityId: string, parameters: Readonly<Record<string, number>>, endPointId: string) {
  const document = parseCadDocument({ ...createCadDocument('Line extension', 'line-extension'), schemaVersion: 2, parameters,
    features: [{ id: 'sketch', name: 'Lines', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }] });
  const before = JSON.stringify(document), preview = prepareCadSketchLineExtend({ graph, parameters, entityId, end: 'end' });
  const extend = { ...preview.target, endPointId }, expected = extendCadSketchEntity({ graph, parameters, extend });
  const result = await prepareCadEdits(document, [{ kind: 'extend-sketch-entity', sketchId: 'sketch', extend }], runtime);
  const sketch = result.document.features[0];
  if (sketch.kind !== 'sketch') throw new Error('Expected the same sketch.');
  expect(sketch.graph).toEqual(expected.graph); expect(result.document.parameters).toEqual(parameters);
  expect(result.sketchDiagnostics).toMatchObject([{ sketchId: 'sketch', diagnostics: {
    status: 'success', conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: []
  } }]);
  expect(JSON.stringify(document)).toBe(before);
  return result;
}

describe('real PlaneGCS exact line Extend preparation', () => {
  it('preserves a numeric intersection endpoint and every untouched source component exactly', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [' origin ', 0] }, { id: 'b', position: [10, 0] },
      { id: 'c', position: [20, -5] }, { id: 'd', position: [20, 5] }], entities: [
      { id: 'edge', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'boundary', kind: 'line', startPointId: 'c', endPointId: 'd', construction: true }], relations: [] });
    const result = await prepared(graph, 'edge', { origin: 0 }, 'm');
    expect(result.sketchDiagnostics[0].diagnostics.degreesOfFreedom).toBe(9);
  });

  it('preserves exact endpoint attachment and accepted drivers while closing the intended contour', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [5, 0] },
      { id: 'c', position: [' width ', ' 0 '] }, { id: 'd', position: [10, 10] }, { id: 'e', position: [0, 10] }], entities: [
      { id: 'bottom', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
      { id: 'right', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
      { id: 'top', kind: 'line', startPointId: 'd', endPointId: 'e', construction: false },
      { id: 'left', kind: 'line', startPointId: 'e', endPointId: 'a', construction: false }], relations: [] });
    const result = await prepared(graph, 'bottom', { width: 10 }, 'c');
    expect(result.sketchDiagnostics[0].diagnostics.degreesOfFreedom).toBe(8);
  });
});
