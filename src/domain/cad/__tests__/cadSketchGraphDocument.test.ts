import { describe, expect, it } from 'vitest';
import { applyCadEdits } from '../cadOperations';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadSketchFeature } from '../cadDocument';
import type { CadSketchGraph } from '../cadSketchGraph';
import { compileCadSketchGeometry } from '../compileCadSketchGeometry';
import { measureCadSketch } from '../cadMeasurements';
import { resolveCadSketchContours, resolveCadSketchRegions } from '../cadSketchGeometry';
import { createCadSketchCellIndex } from '../cadSketchRegionSelection';

const graph: CadSketchGraph = { points: [
  { id: 'a', position: [0, 0] }, { id: 'b', position: ['width', 0] },
  { id: 'c', position: ['width', 10] }, { id: 'd', position: [0, 10] }
], entities: [
  { id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
  { id: 'bc', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
  { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
  { id: 'da', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' }
], relations: [{ id: 'horizontal', kind: 'horizontal', pointIds: ['a', 'b'] }] };
const sketch: CadSketchFeature = { id: 'sketch', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph };
const document = () => parseCadDocument({ ...createCadDocument('Plate', 'plate'), schemaVersion: 2, parameters: { width: 20 }, features: [sketch] });

describe('graph source in a CAD document', () => {
  it('requires an explicit newer format, preserves old documents and round-trips exact graph scalars', () => {
    const legacy = createCadDocument('Legacy', 'legacy');
    expect(parseCadDocument(JSON.parse(JSON.stringify(legacy)))).toEqual(legacy);
    expect(legacy.schemaVersion).toBe(1);
    expect(() => parseCadDocument({ ...document(), schemaVersion: 1 })).toThrow('schema 2');
    const accepted = document();
    expect(parseCadDocument(JSON.parse(JSON.stringify(accepted)))).toEqual(accepted);
    expect(accepted.features[0]).toEqual(sketch);
  });

  it('compiles legacy and graph contours through the same analytic material and measurement path', () => {
    const accepted = document();
    expect(compileCadSketchGeometry(sketch, accepted.parameters).profiles).toHaveLength(1);
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 200, boundaryLengthMm: 60, cutContourCount: 1 });
    const changed = applyCadEdits(accepted, [{ kind: 'rename-parameter', name: 'width', newName: 'plateWidth' }, { kind: 'set-parameter', name: 'plateWidth', value: 30 }]);
    expect(changed.features[0].kind === 'sketch' && changed.features[0].graph?.points[1].position).toEqual(['plateWidth', 0]);
    expect(measureCadSketch(changed, 'sketch').materialAreaMm2).toBe(300);
    expect(accepted.features[0]).toEqual(sketch);
  });

  it('accepts and preserves open geometry but refuses to build material from it', () => {
    const open = { ...sketch, graph: { ...graph, entities: graph.entities.slice(0, 2) } };
    const accepted = parseCadDocument({ ...document(), features: [open] });
    expect(accepted.features[0]).toEqual(open);
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 0, cutContourCount: 0 });
    expect(() => applyCadEdits(accepted, [{ kind: 'add-feature', feature: { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null } }])).toThrow('nonempty sketch');
  });

  it('retains exact source topology in region references and rejects silent retargeting after a split', () => {
    const parameters = document().parameters;
    const contours = resolveCadSketchContours(sketch, parameters);
    const selection = [createCadSketchCellIndex(contours).reference(contours[0].profile.id)];
    expect(resolveCadSketchRegions(sketch, parameters, selection)).toHaveLength(1);
    const split = { ...sketch, graph: { ...graph,
      points: [...graph.points, { id: 'mid', position: [20, 5] as const }],
      entities: graph.entities.flatMap(entity => entity.id === 'bc' ? [
        { ...entity, endPointId: 'mid' }, { ...entity, id: 'bc_tail', startPointId: 'mid' }
      ] : [entity])
    } };
    expect(() => resolveCadSketchRegions(split, parameters, selection)).toThrow('changed');
    expect(resolveCadSketchRegions({ ...sketch, graph: { ...graph, entities: [...graph.entities].reverse() } }, parameters, selection)).toHaveLength(1);
  });
});
