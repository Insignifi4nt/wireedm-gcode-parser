import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { prepareCadSketchTrim, trimCadSketchEntity } from '../cadSketchTrimExtend';
import { Value } from '@sinclair/typebox/value';
import { applyCadEdits, CadEditSchema } from '../cadOperations';
import { createCadDocument, parseCadDocument } from '../cadSchema';

function fourCuts() {
  return parseCadSketchGraph({ points: [{ id: 'a', position: [' startX ', ' 0 '] }, { id: 'b', position: [' endX ', 0] },
    { id: 'unjoined', position: [10, 0] }, { id: 'nearby', position: [10 + 1e-8, 0] },
    ...[5, 10, 20, 25].flatMap((x, index) => [{ id: `c${index}`, position: [x, index === 2 ? 0 : -2] }, { id: `d${index}`, position: [x, 3] }])],
    entities: [{ id: 'edge', kind: 'line', construction: true, startPointId: 'a', endPointId: 'b' },
      ...[0, 1, 2, 3].map(index => ({ id: `fence${index}`, kind: 'line', construction: true, startPointId: `c${index}`, endPointId: `d${index}` }))],
    relations: [{ id: 'direction', kind: 'horizontal', pointIds: ['b', 'a'] },
      { id: 'located', kind: 'fixed-axis', pointId: 'a', axis: 'x', value: ' startX ' }] });
}
const parameters = { startX: -5, endX: 30 };

describe('exact middle-line Trim', () => {
  it('removes only adjacent bracketing cuts among four cutters and preserves original outer drivers plus one explicit common support', () => {
    const graph = fourCuts(), before = JSON.stringify(graph);
    const prepared = prepareCadSketchTrim({ graph, parameters, entityId: 'edge', parameter: .5 });
    expect(prepared.target.kind).toBe('middle');
    if (!('survivors' in prepared)) throw new Error('Middle preparation missing.');
    expect(prepared.target.boundaries).toEqual([
      { entityId: 'fence1', index: 0, parameter: 3 / 7, position: [10, 0] },
      { entityId: 'fence2', index: 0, parameter: 5 / 7, position: [20, 0], endpointPointId: 'c2' }
    ]);
    expect(prepared.removed).toMatchObject({ kind: 'line', start: { x: 10, y: 0 }, end: { x: 20, y: 0 }, length: 10 });
    expect(prepared.survivors).toMatchObject([{ start: { x: -5, y: 0 }, end: { x: 10, y: 0 } }, { start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }]);
    expect(prepared.cuts.map(cut => cut.point)).toEqual([[10, 0], [20, 0]]);
    const result = trimCadSketchEntity({ graph, parameters, trim: { ...prepared.target, cutPointIds: ['cut', 'c2'], newEntityId: 'after', supportRelationId: 'support' } });
    expect(result).toMatchObject({ retainedEntityId: 'edge', removedEntityId: null, cutPointIds: ['cut', 'c2'], newEntityId: 'after' });
    expect(result.graph.points).toEqual([...graph.points, { id: 'cut', position: [10, 0] }]);
    expect(result.graph.entities).toEqual([{ ...graph.entities[0], endPointId: 'cut' },
      { id: 'after', kind: 'line', construction: true, startPointId: 'c2', endPointId: 'b' }, ...graph.entities.slice(1)]);
    expect(result.graph.relations).toEqual([...graph.relations, { id: 'support', kind: 'collinear', lineIds: ['edge', 'after'] }]);
    expect(JSON.stringify(graph)).toBe(before); expect(Object.isFrozen(prepared.cuts[0].point)).toBe(true);
  });

  it('keeps source-start identity independent of reversed traversal and reordered input arrays', () => {
    const original = fourCuts();
    for (const reversed of [false, true]) {
      const graph = parseCadSketchGraph({ ...original, points: [...original.points].reverse(), relations: [...original.relations].reverse(),
        entities: original.entities.map(entity => reversed && entity.id === 'edge' ? { ...entity, startPointId: 'b', endPointId: 'a' } : entity).reverse() });
      const prepared = prepareCadSketchTrim({ graph, parameters, entityId: 'edge', parameter: .5 });
      if (!('survivors' in prepared)) throw new Error('Middle preparation missing.');
      expect(prepared.cuts.map(cut => cut.point)).toEqual(reversed ? [[20, 0], [10, 0]] : [[10, 0], [20, 0]]);
      const result = trimCadSketchEntity({ graph, parameters, trim: { ...prepared.target,
        cutPointIds: reversed ? ['c2', 'cut'] : ['cut', 'c2'], newEntityId: 'after', supportRelationId: 'support' } });
      expect(result.graph.entities.find(entity => entity.id === 'edge')).toMatchObject({ startPointId: reversed ? 'b' : 'a', endPointId: reversed ? 'c2' : 'cut' });
      expect(result.graph.entities.find(entity => entity.id === 'after')).toMatchObject({ startPointId: reversed ? 'cut' : 'c2', endPointId: reversed ? 'a' : 'b' });
      expect(result.graph.relations.slice(0, graph.relations.length)).toEqual(graph.relations);
      expect(result.graph.points.slice(0, graph.points.length)).toEqual(graph.points);
    }
  });

  it('retains unchanged outer-point dimensions and whole-support owners while rejecting finite entity owners', () => {
    const original = fourCuts(), graph = parseCadSketchGraph({ ...original,
      points: [...original.points, { id: 'r1', position: [-5, -4] }, { id: 'r2', position: [30, -4] },
        { id: 's1', position: [40, 0] }, { id: 's2', position: [45, 0] }, { id: 'alias', position: [-5, 0] }],
      entities: [...original.entities, { id: 'parallel-line', kind: 'line', construction: true, startPointId: 'r1', endPointId: 'r2' },
        { id: 'collinear-line', kind: 'line', construction: true, startPointId: 's1', endPointId: 's2' }],
      relations: [...original.relations, { id: 'span', kind: 'distance', pointIds: ['a', 'b'], value: ' 35 ' },
        { id: 'attachment', kind: 'coincident', pointIds: ['a', 'alias'] },
        { id: 'parallel', kind: 'parallel', lineIds: ['edge', 'parallel-line'] },
        { id: 'perpendicular', kind: 'perpendicular', lineIds: ['edge', 'fence2'] },
        { id: 'collinear', kind: 'collinear', lineIds: ['collinear-line', 'edge'] }] });
    const prepared = prepareCadSketchTrim({ graph, parameters, entityId: 'edge', parameter: .5 });
    if (!('survivors' in prepared)) throw new Error('Middle preparation missing.');
    const result = trimCadSketchEntity({ graph, parameters, trim: { ...prepared.target, cutPointIds: ['cut', 'c2'], newEntityId: 'after', supportRelationId: 'support' } });
    expect(result.graph.relations.slice(0, graph.relations.length)).toEqual(graph.relations);
    for (const owner of [{ id: 'size', kind: 'equal-length', lineIds: ['edge', 'parallel-line'] },
      { id: 'angle', kind: 'line-angle', rays: [{ lineId: 'edge', towardPointId: 'b' }, { lineId: 'fence2', towardPointId: 'd2' }], sense: 'ccw', value: 90 }]) {
      const blocked = parseCadSketchGraph({ ...graph, relations: [...graph.relations, owner] });
      expect(() => prepareCadSketchTrim({ graph: blocked, parameters, entityId: 'edge', parameter: .5 }))
        .toThrowError(expect.objectContaining({ code: 'dependent-sketch-trim', relationIds: [owner.id], pointIds: [] }));
    }
  });

  it('rejects stale/forged witnesses and colliding or malformed named edits atomically', () => {
    const graph = fourCuts(), prepared = prepareCadSketchTrim({ graph, parameters, entityId: 'edge', parameter: .5 });
    if (!('survivors' in prepared)) throw new Error('Middle preparation missing.');
    const trim = { ...prepared.target, cutPointIds: ['cut', 'c2'] as const, newEntityId: 'after', supportRelationId: 'support' };
    const document = parseCadDocument({ ...createCadDocument(), schemaVersion: 2, parameters,
      features: [{ id: 'sketch', kind: 'sketch', name: 'Sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }] });
    const edit = { kind: 'trim-sketch-entity', sketchId: 'sketch', trim } as const, before = JSON.stringify(document);
    expect(Value.Check(CadEditSchema, edit)).toBe(true); expect(applyCadEdits(document, [edit]).features[0]).not.toBe(document.features[0]);
    for (const changed of [{ ...trim, cutPointIds: ['unjoined', 'c2'] as const }, { ...trim, cutPointIds: ['cut', 'unjoined'] as const },
      { ...trim, newEntityId: 'fence0' }, { ...trim, supportRelationId: 'direction' }, { ...trim, supportRelationId: 'after' }])
      expect(() => applyCadEdits(document, [{ kind: 'set-parameter', name: 'unused', value: 7 }, { ...edit, trim: changed }])).toThrow();
    for (const malformed of [{ ...trim, supportRelationId: undefined }, { ...trim, boundaries: [trim.boundaries[0]] },
      { ...trim, cutPointIds: ['cut'] }, { ...trim, cutPointId: 'extra' }]) expect(Value.Check(CadEditSchema, { ...edit, trim: malformed })).toBe(false);
    const moved = parseCadSketchGraph({ ...graph, points: graph.points.map(point => point.id === 'c1' || point.id === 'd1' ? { ...point, position: [11, point.position[1]] } : point) });
    expect(() => trimCadSketchEntity({ graph: moved, parameters, trim })).toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
    expect(() => trimCadSketchEntity({ graph, parameters, trim: { ...trim, boundaries: [trim.boundaries[1], trim.boundaries[0]] } }))
      .toThrowError(expect.objectContaining({ code: 'stale-sketch-trim' }));
    const feature = document.features[0]; if (feature.kind !== 'sketch') throw new Error('Sketch missing.');
    const mixed = parseCadDocument({ ...document, features: [{ ...feature, profiles: [{ id: 'after', name: 'Legacy', construction: true,
      geometry: { kind: 'circle', x: 100, y: 100, radius: 2 } }] }] });
    expect(() => applyCadEdits(mixed, [edit])).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(JSON.stringify(document)).toBe(before);
  });

  it('refuses a degenerate middle gap and keeps arc middle removal outside the supported line operation', () => {
    const original = fourCuts(), tight = parseCadSketchGraph({ ...original, points: original.points.map(point =>
      point.id === 'c2' || point.id === 'd2' ? { ...point, position: [10 + 1e-8, point.position[1]] } : point) });
    expect(() => prepareCadSketchTrim({ graph: tight, parameters, entityId: 'edge', parameter: (15 + 5e-9) / 35 }))
      .toThrowError(expect.objectContaining({ code: 'sketch-trim-precision' }));
    const arc = parseCadSketchGraph({ points: [{ id: 'o', position: [0, 0] }, { id: 'a', position: [10, 0] }, { id: 'b', position: [-10, 0] },
      ...[5, -5].flatMap((x, index) => [{ id: `c${index}`, position: [x, 0] }, { id: `d${index}`, position: [x, 20] }])], entities: [
      { id: 'arc', kind: 'arc', construction: true, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw' },
      ...[0, 1].map(index => ({ id: `fence${index}`, kind: 'line', construction: true, startPointId: `c${index}`, endPointId: `d${index}` }))], relations: [] });
    expect(() => prepareCadSketchTrim({ graph: arc, parameters: {}, entityId: 'arc', parameter: .5 }))
      .toThrowError(expect.objectContaining({ code: 'unsupported-sketch-trim-middle' }));
  });
});
