import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { applyCadEdits, CadEditSchema } from '../cadOperations';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { createCadFreshSketchGraph } from '../cadFreshSketchGraph';
import { measureCadSketch } from '../cadMeasurements';

function rectangle() {
  let id = 0;
  const graph = createCadFreshSketchGraph({ geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 },
    construction: false, createId: () => `original_${++id}` });
  return parseCadDocument({ ...createCadDocument('Split', 'split'), schemaVersion: 2, features: [
    { id: 'sketch', kind: 'sketch', name: 'Sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph }
  ] });
}

describe('checked sketch split edits', () => {
  it('uses the shared named-ID constructor and preserves the material of a closed rectangle', () => {
    const document = rectangle(), before = JSON.stringify(document);
    const edit = { kind: 'split-sketch-entity', sketchId: 'sketch', split: { kind: 'line', entityId: 'original_5', parameter: 0.25,
      splitPointId: 'joint', newEntityId: 'new-edge', supportRelationId: 'straight' } } as const;
    expect(Value.Check(CadEditSchema, edit)).toBe(true);
    const result = applyCadEdits(document, [edit]);
    const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected graph sketch.');
    expect(result.features[0]).toMatchObject({ graph: { points: [...sketch.graph.points, { id: 'joint', position: [5, 0] }] } });
    expect(measureCadSketch(result, 'sketch')).toMatchObject({ materialAreaMm2: 200, boundaryLengthMm: 60 });
    expect(JSON.stringify(document)).toBe(before);
  });

  it('requires deliberate relation removal before narrowing a referenced source and keeps failed batches atomic', () => {
    const document = applyCadEdits(rectangle(), [{ kind: 'set-sketch-relation', sketchId: 'sketch',
      relation: { id: 'whole-size', kind: 'equal-length', lineIds: ['original_5', 'original_7'] } }]);
    const before = JSON.stringify(document), split = { kind: 'split-sketch-entity', sketchId: 'sketch', split: { kind: 'line',
      entityId: 'original_5', parameter: 0.5, splitPointId: 'm', newEntityId: 'child', supportRelationId: 'support' } } as const;
    expect(() => applyCadEdits(document, [split])).toThrowError(expect.objectContaining({ code: 'dependent-sketch-split', relationIds: ['whole-size'] }));
    const result = applyCadEdits(document, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'whole-size' }, split]);
    const sketch = result.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Expected graph sketch.');
    expect(sketch.graph.relations.some(relation => relation.id === 'whole-size')).toBe(false);
    expect(sketch.graph.relations.at(-1)).toEqual({ id: 'support', kind: 'parallel', lineIds: ['original_5', 'child'] });
    expect(measureCadSketch(result, 'sketch').materialAreaMm2).toBe(200);
    expect(() => applyCadEdits(document, [{ kind: 'remove-sketch-relation', sketchId: 'sketch', relationId: 'whole-size' },
      { ...split, split: { ...split.split, newEntityId: 'original_2' } }])).toThrow();
    expect(JSON.stringify(document)).toBe(before);
  });

  it('keeps line/arc command fields strict and protects legacy profile identities', () => {
    const document = rectangle(), sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Expected sketch.');
    const edit = { kind: 'split-sketch-entity', sketchId: 'sketch', split: { kind: 'line', entityId: 'original_5', parameter: 0.5,
      splitPointId: 'm', newEntityId: 'child', supportRelationId: 'support' } } as const;
    for (const split of [{ kind: 'line', entityId: 'original_5', parameter: 0.5, splitPointId: 'm', newEntityId: 'child' },
      { ...edit.split, kind: 'arc' }, { ...edit.split, parameter: '0.5' }, { ...edit.split, parameter: 0 }, { ...edit.split, parameter: 1 }])
      expect(Value.Check(CadEditSchema, { ...edit, split })).toBe(false);
    const mixed = parseCadDocument({ ...document, features: [{ ...sketch, profiles: [{ id: 'child', name: 'Old circle', construction: false,
      geometry: { kind: 'circle', x: 100, y: 100, radius: 2 } }] }] });
    const before = JSON.stringify(mixed);
    expect(() => applyCadEdits(mixed, [edit])).toThrowError(expect.objectContaining({ code: 'duplicate-sketch-id' }));
    expect(JSON.stringify(mixed)).toBe(before);
  });
});
