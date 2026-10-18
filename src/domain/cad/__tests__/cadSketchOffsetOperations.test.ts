import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { applyCadEdits, CadEditSchema } from '../cadOperations';
import { CadSession } from '@/features/cad/cadSession';
import { offsetCirclePart } from './cadSketchOffsetFixtures';

describe('detached sketch offset edit', () => {
  it('appends a numeric independent loop through the strict operation and leaves zero distance without history', () => {
    const source = offsetCirclePart(), before = JSON.stringify(source);
    const edit = { kind: 'offset-sketch-loop', sketchId: 'sketch', source: { kind: 'profile', profileId: 'circle' }, distance: 2, idPrefix: 'copy' } as const;
    expect(Value.Check(CadEditSchema, edit)).toBe(true);
    const result = applyCadEdits(source, [edit]), sketch = result.features[0];
    if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Offset graph missing.');
    expect(result.schemaVersion).toBe(2); expect(sketch.profiles).toEqual(source.features[0].kind === 'sketch' ? source.features[0].profiles : []);
    expect(sketch.graph.points).toHaveLength(1); expect(sketch.graph.entities).toHaveLength(1); expect(sketch.graph.relations).toEqual([]);
    expect(sketch.graph.entities[0]).toMatchObject({ kind: 'circle', radius: 12, construction: false });
    const session = new CadSession(source), snapshot = session.getSnapshot();
    session.edit([{ ...edit, distance: '0 * radius' }], snapshot.version); expect(session.getSnapshot()).toBe(snapshot);
    for (const invalid of [{ ...edit, idPrefix: 'x'.repeat(65) }, { ...edit, source: { ...edit.source, sourceRefs: [] } },
      { ...edit, identities: {} }, { ...edit, distance: Infinity }]) expect(Value.Check(CadEditSchema, invalid)).toBe(false);
    expect(JSON.stringify(source)).toBe(before);
  });
});
