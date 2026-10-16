// @vitest-environment node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { parseCadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadSketchEndTrim, trimCadSketchEntity } from '@/domain/cad/cadSketchTrimExtend';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchSolverRuntime } from './sketch-solver/cadSketchSolverRuntime';
import { initializeCadSketchSolverModule } from './sketch-solver/cadSketchSolverModule';

const require = createRequire(import.meta.url);
const runtime = createCadSketchSolverRuntime(() => initializeCadSketchSolverModule(pathToFileURL(
  require.resolve('@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm')).href));

describe('real PlaneGCS exact end-Trim preparation', () => {
  it.each(['cw', 'ccw'] as const)('accepts the complete constructed %s arc candidate without solver projection or driver changes', async direction => {
    const major = direction === 'cw', parameters = { cx: 0, cy: 0, ten: 10 };
    const graph = parseCadSketchGraph({ points: [{ id: 'o', position: [' cx ', ' cy '] }, { id: 'a', position: [10, 0] },
      { id: 'b', position: [0, ' ten '] }, { id: 'c', position: major ? [0, -20] : [-20, -20] },
      { id: 'd', position: major ? [0, -5] : [20, 20] }], entities: [
      { id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction },
      { id: 'fence', kind: 'line', construction: true, startPointId: 'c', endPointId: 'd' }], relations: [] });
    const document = parseCadDocument({ ...createCadDocument('Arc trim', 'arc-trim'), schemaVersion: 2, parameters,
      features: [{ id: 'sketch', name: 'Arc', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }] });
    const before = JSON.stringify(document), preview = prepareCadSketchEndTrim({ graph, parameters, entityId: 'arc', parameter: 0.1 });
    if (preview.target.kind !== 'end') throw new Error('Expected an end trim.');
    const trim = { ...preview.target, cutPointId: 'cut' }, expected = trimCadSketchEntity({ graph, parameters, trim });
    const prepared = await prepareCadEdits(document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime);
    const sketch = prepared.document.features[0];
    if (sketch.kind !== 'sketch') throw new Error('Expected the same sketch.');
    expect(sketch.graph).toEqual(expected.graph); expect(prepared.document.parameters).toEqual(parameters);
    expect(prepared.sketchDiagnostics).toEqual([{ sketchId: 'sketch', diagnostics: {
      status: 'success', degreesOfFreedom: 8, conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: []
    } }]);
    expect(JSON.stringify(document)).toBe(before);
  });
});
