// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { createCadFreshSketchGraph } from '@/domain/cad/cadFreshSketchGraph';
import { parseCadSketchGraph, type CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { prepareCadSketchTrim, prepareCadSketchExtend, trimCadSketchEntity, extendCadSketchEntity } from '@/domain/cad/cadSketchTrimExtend';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { prepareCadEdits } from './cadEditPreparation';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

const runtime = createCadSketchTestSolver();
function part(graph: CadSketchGraph) {
  return parseCadDocument({ ...createCadDocument('Directional boundary', 'directional-boundary'), schemaVersion: 2, parameters: { width: 10, retained: 23 },
    features: [{ id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }] });
}

describe('direction-preserving line boundary preparation', () => {
  it('trims a fresh four-H/V rectangle with only its matching direction operand transferred and all old corner records retained', async () => {
    let id = 0;
    const rectangle = createCadFreshSketchGraph({ geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 },
      construction: false, createId: () => `rect_${++id}` });
    const graph = parseCadSketchGraph({ ...rectangle, points: [...rectangle.points,
      { id: 'fence-a', position: [5, -5] }, { id: 'fence-b', position: [5, 5] }, { id: 'outside', position: [' retained ', '-7'] }],
    entities: [...rectangle.entities, { id: 'fence', kind: 'line', construction: true, startPointId: 'fence-a', endPointId: 'fence-b' }] });
    const document = part(graph), before = JSON.stringify(document);
    const preview = prepareCadSketchTrim({ graph, parameters: document.parameters, entityId: 'rect_5', parameter: .1 });
    if (preview.target.kind !== 'end') throw new Error('Expected an end trim.');
    const trim = { ...preview.target, cutPointId: 'cut' }, expected = trimCadSketchEntity({ graph, parameters: document.parameters, trim });
    expect(expected.graph.relations).toEqual([{ id: 'rect_9', kind: 'horizontal', pointIds: ['cut', 'rect_2'] }, ...graph.relations.slice(1)]);
    expect(expected.graph.points).toEqual([...graph.points, { id: 'cut', position: [5, 0] }]);
    expect(expected.graph.entities).toEqual([{ ...graph.entities[0], startPointId: 'cut' }, ...graph.entities.slice(1)]);
    const prepared = await prepareCadEdits(document, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim }], runtime);
    const sketch = prepared.document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected the original sketch.');
    expect(sketch.graph).toEqual(expected.graph);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('extends to an exact driven boundary endpoint while preserving Parallel/Perpendicular records and closing real material', async () => {
    const graph = parseCadSketchGraph({ points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [5, 0] },
      { id: 'c', position: [' width ', ' 0 '] }, { id: 'd', position: [10, 10] }, { id: 'e', position: [0, 10] }], entities: [
      { id: 'bottom', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'right', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
      { id: 'top', kind: 'line', construction: false, startPointId: 'd', endPointId: 'e' },
      { id: 'left', kind: 'line', construction: false, startPointId: 'e', endPointId: 'a' }], relations: [
      { id: 'parallel', kind: 'parallel', lineIds: ['bottom', 'top'] },
      { id: 'perpendicular', kind: 'perpendicular', lineIds: ['bottom', 'right'] }] });
    const document = part(graph), before = JSON.stringify(document);
    const preview = prepareCadSketchExtend({ graph, parameters: document.parameters, entityId: 'bottom', end: 'end' });
    expect(preview.target.boundary).toEqual({ entityId: 'right', index: 0, parameter: 2, position: [10, 0], endpointPointId: 'c' });
    const extend = { ...preview.target, endPointId: 'c' }, expected = extendCadSketchEntity({ graph, parameters: document.parameters, extend });
    expect(expected.graph.points).toEqual(graph.points.filter(point => point.id !== 'b')); expect(expected.graph.relations).toEqual(graph.relations);
    expect(expected.graph.entities).toEqual([{ ...graph.entities[0], endPointId: 'c' }, ...graph.entities.slice(1)]);
    const prepared = await prepareCadEdits(document, [{ kind: 'extend-sketch-entity', sketchId: 'sketch', extend }], runtime);
    const sketch = prepared.document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected the original sketch.');
    expect(sketch.graph).toEqual(expected.graph);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [], partiallyRedundantIds: [], issues: [] });
    expect(measureCadSketch(prepared.document, 'sketch')).toMatchObject({ materialAreaMm2: 100, boundaryLengthMm: 40 });
    expect(JSON.stringify(document)).toBe(before);
  });
});
