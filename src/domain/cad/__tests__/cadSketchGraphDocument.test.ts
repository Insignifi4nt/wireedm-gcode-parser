import { describe, expect, it } from 'vitest';
import { applyCadEdits } from '../cadOperations';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadSketchFeature } from '../cadDocument';
import type { CadSketchGraph } from '../cadSketchGraph';
import { compileCadSketchGeometry } from '../compileCadSketchGeometry';
import { measureCadSketch } from '../cadMeasurements';
import { resolveCadSketchContours, resolveCadSketchRegions } from '../cadSketchGeometry';
import { createCadSketchCellIndex } from '../cadSketchRegionSelection';
import { CadSession } from '@/features/cad/cadSession';

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
  it('interprets saved schema-2 coincidence intent as material without rewriting source or retargeting old cell selectors', () => {
    const source: CadSketchFeature = { ...sketch, profiles: [{ id: 'bore', name: 'Bore', construction: false,
      geometry: { kind: 'circle', x: 5, y: 5, radius: 1 } }], graph: { ...graph,
      points: [...graph.points, { id: 'near', position: [0, 5e-13] }],
      entities: graph.entities.map(entity => entity.id === 'da' && entity.kind === 'line' ? { ...entity, endPointId: 'near' } : entity),
      relations: [...graph.relations, { id: 'join', kind: 'coincident', pointIds: ['a', 'near'] }] } };
    const pad = { id: 'pad', name: 'Pad', kind: 'extrude' as const, suppressed: false, sketchId: 'sketch', distance: ' 5e0 ', symmetric: false, operation: 'new' as const, targetId: null };
    const raw = { ...createCadDocument('Saved coincidence', 'saved'), schemaVersion: 2, parameters: { width: 20 }, features: [source, pad] };
    const accepted = parseCadDocument(raw);
    expect(JSON.stringify(accepted)).toBe(JSON.stringify(raw));
    expect(measureCadSketch(accepted, 'sketch')).toMatchObject({ materialAreaMm2: 200 - Math.PI, cutContourCount: 2 });
    // Before declared joints were compiled, the ignored open rectangle left this disk as the only cell.
    const oldDisk = { boundaryProfileId: 'bore', voidProfileIds: [], ancestorProfileIds: [] };
    expect(() => parseCadDocument({ ...raw, features: [source, { ...pad, regionSelection: [oldDisk] }] })).toThrow('changed');
    const dormant = { ...raw, features: [source, { ...pad, suppressed: true, regionSelection: [oldDisk] }] };
    expect(JSON.stringify(parseCadDocument(dormant))).toBe(JSON.stringify(dormant));
    const contours = resolveCadSketchContours(source, accepted.parameters), reference = createCadSketchCellIndex(contours).reference('ab');
    const session = new CadSession(parseCadDocument({ ...raw, features: [source, { ...pad, regionSelection: [reference] }] }));
    const before = session.getSnapshot(), sourceGraph = source.graph;
    if (!sourceGraph) throw new Error('Source graph missing');
    expect(() => session.edit([{ kind: 'update-feature', feature: { ...source, graph: { ...sourceGraph, relations: sourceGraph.relations.filter(relation => relation.id !== 'join') } } }])).toThrow('region');
    expect(session.getSnapshot()).toBe(before);
    const alias: CadSketchFeature = { ...source, graph: { ...sourceGraph, points: [...sourceGraph.points, { id: '0alias', position: ['width', 0] }],
      relations: [...sourceGraph.relations, { id: 'alias', kind: 'coincident', pointIds: ['0alias', 'b'] }] } };
    expect(resolveCadSketchRegions(alias, accepted.parameters, [reference])).toHaveLength(1);
  });
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
