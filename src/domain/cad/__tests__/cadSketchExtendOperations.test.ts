import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { applyCadEdits, CadEditSchema } from '../cadOperations';
import { measureCadSketch } from '../cadMeasurements';
import { extendPart, lineExtend } from './cadSketchExtendFixtures';
import { parseCadDocument } from '../cadSchema';

describe('checked line-extend edit integration', () => {
  it('extends one endpoint to the exact outward witness while preserving source, detached points and unrelated material', () => {
    const source = extendPart(), before = JSON.stringify(source);
    const edit = { kind: 'extend-sketch-entity', sketchId: 'sketch', extend: lineExtend } as const;
    expect(Value.Check(CadEditSchema, edit)).toBe(true);
    const result = applyCadEdits(source, [edit]), original = source.features[0], changed = result.features[0];
    if (original.kind !== 'sketch' || !original.graph || changed.kind !== 'sketch' || !changed.graph) throw new Error('Missing extend sketch.');
    expect(changed.graph.points).toEqual([...original.graph.points, { id: 'extension', position: [-5, 0] }]);
    expect(changed.graph.entities[0]).toEqual({ ...original.graph.entities[0], startPointId: 'extension' });
    expect(changed.graph.entities.slice(1)).toEqual(original.graph.entities.slice(1));
    expect(changed.graph.relations).toEqual(original.graph.relations); expect(changed.source).toEqual(original.source);
    expect(measureCadSketch(result, 'sketch')).toMatchObject({ materialAreaMm2: 200, boundaryLengthMm: 60 });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('requires explicit owner removal, rejects malformed/legacy-colliding requests and never accepts a partial batch', () => {
    const source = applyCadEdits(extendPart(), [{ kind: 'set-sketch-relation', sketchId: 'sketch',
      relation: { id: 'size', kind: 'equal-length', lineIds: ['ab', 'cd'] } }]), before = JSON.stringify(source);
    const edit = { kind: 'extend-sketch-entity', sketchId: 'sketch', extend: lineExtend } as const;
    expect(() => applyCadEdits(source, [edit])).toThrowError(expect.objectContaining({ code: 'dependent-sketch-extend', relationIds: ['size'] }));
    const released = applyCadEdits(source, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'size' }, edit]);
    expect(measureCadSketch(released, 'sketch').materialAreaMm2).toBe(200);
    for (const extend of [{ ...lineExtend, end: 'middle' }, { ...lineExtend, cutPointId: 'unused' },
      { ...lineExtend, boundary: { ...lineExtend.boundary, parameter: Infinity } }])
      expect(Value.Check(CadEditSchema, { ...edit, extend })).toBe(false);
    const base = extendPart(), feature = base.features[0]; if (feature.kind !== 'sketch') throw new Error('Missing sketch.');
    const mixed = parseCadDocument({ ...base, features: [{ ...feature, profiles: [{ id: 'extension', name: 'Legacy', construction: false,
      geometry: { kind: 'circle', x: 100, y: 100, radius: 2 } }] }] });
    expect(() => applyCadEdits(mixed, [edit])).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(() => applyCadEdits(source, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'size' },
      { ...edit, extend: { ...lineExtend, endPointId: 'a' } }])).toThrow();
    expect(JSON.stringify(source)).toBe(before);
  });
});
