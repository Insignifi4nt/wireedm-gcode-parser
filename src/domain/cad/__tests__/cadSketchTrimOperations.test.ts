import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { applyCadEdits, CadEditSchema } from '../cadOperations';
import { measureCadSketch } from '../cadMeasurements';
import { endTrim, trimPart } from './cadSketchTrimFixtures';
import { parseCadDocument } from '../cadSchema';

describe('checked end-trim edit integration', () => {
  it('accepts one exact witnessed trim while preserving old points, unrelated material and exact source', () => {
    const source = trimPart(), before = JSON.stringify(source), edit = { kind: 'trim-sketch-entity', sketchId: 'sketch', trim: endTrim } as const;
    expect(Value.Check(CadEditSchema, edit)).toBe(true);
    const result = applyCadEdits(source, [edit]), original = source.features[0], changed = result.features[0];
    if (original.kind !== 'sketch' || !original.graph || changed.kind !== 'sketch' || !changed.graph) throw new Error('Trim sketch missing.');
    expect(changed.graph.points).toEqual([...original.graph.points, { id: 'cut', position: [5, 0] }]);
    expect(changed.graph.entities[0]).toEqual({ ...original.graph.entities[0], startPointId: 'cut' });
    expect(changed.graph.entities.slice(1)).toEqual(original.graph.entities.slice(1));
    expect(changed.graph.relations).toEqual(original.graph.relations); expect(changed.source).toEqual(original.source);
    expect(measureCadSketch(result, 'sketch')).toMatchObject({ materialAreaMm2: 200, boundaryLengthMm: 60 });
    expect(JSON.stringify(source)).toBe(before);
  });

  it('requires confirmed or explicit owner removal in the same batch and keeps failed edits atomic', () => {
    const source = applyCadEdits(trimPart(), [{ kind: 'set-sketch-relation', sketchId: 'sketch',
      relation: { id: 'size', kind: 'equal-length', lineIds: ['ab', 'cd'] } }]), before = JSON.stringify(source);
    const trim = { kind: 'trim-sketch-entity', sketchId: 'sketch', trim: endTrim } as const;
    expect(() => applyCadEdits(source, [trim])).toThrowError(expect.objectContaining({ code: 'unconfirmed-sketch-trim-removals' }));
    const confirmed = applyCadEdits(source, [{ ...trim, trim: { ...endTrim, removedRelationIds: ['size'] } }]), sketch = confirmed.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing graph.');
    expect(sketch.graph.relations.map(relation => relation.id)).not.toContain('size'); expect(measureCadSketch(confirmed, 'sketch').materialAreaMm2).toBe(200);
    const result = applyCadEdits(source, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'size' }, trim]);
    expect(measureCadSketch(result, 'sketch').materialAreaMm2).toBe(200);
    expect(() => applyCadEdits(source, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'size' },
      { ...trim, trim: { ...endTrim, cutPointId: 'a' } }])).toThrow();
    expect(JSON.stringify(source)).toBe(before);
  });

  it('keeps strict delete/end shapes, retained detached points and legacy profile identities', () => {
    const source = trimPart(), sketch = source.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing graph.');
    const deletion = { kind: 'delete', entityId: 'he', parameter: .5 } as const;
    const deleted = applyCadEdits(source, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: deletion }]).features[0];
    expect(deleted).toMatchObject({ graph: { points: sketch.graph.points, entities: sketch.graph.entities.filter(entity => entity.id !== 'he') } });
    for (const trim of [{ ...deletion, cutPointId: 'unused' }, { ...endTrim, boundary: undefined }, { ...endTrim, end: 'middle' },
      { ...endTrim, parameter: Infinity }, { ...endTrim, boundary: { ...endTrim.boundary, index: 2 } }])
      expect(Value.Check(CadEditSchema, { kind: 'trim-sketch-entity', sketchId: 'sketch', trim })).toBe(false);
    const mixed = parseCadDocument({ ...source, features: [{ ...sketch, profiles: [{ id: 'cut', name: 'Legacy', construction: false,
      geometry: { kind: 'circle', x: 100, y: 100, radius: 2 } }] }] }), before = JSON.stringify(mixed);
    expect(() => applyCadEdits(mixed, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: endTrim }]))
      .toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(JSON.stringify(mixed)).toBe(before);
  });
});
