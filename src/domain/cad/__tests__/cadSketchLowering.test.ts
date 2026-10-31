import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import { CAD_SKETCH_QUANTITIES } from '../cadSketchQuantity';
import { CAD_SKETCH_RELATION_DEFINITIONS, CAD_SKETCH_RELATION_KINDS } from '../sketch-relations/cadSketchRelationRegistry';
import { compileCadSketchEquations } from '../sketch-solver/compileCadSketchEquations';
import { CadSketchLowering, CadSketchLoweringRefusal } from '../sketch-solver/cadSketchLoweringContext';

// The equations each relation lowers to are fixed by the equation baseline, which replays every recorded input. These cover what it
// cannot reach: operands the lowering refuses, and what each driving value declares it measures.

const graph = parseCadSketchGraph({
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [4, 4] }, { id: 'd', position: [9, 4] }, { id: 'e', position: [4, 9] }],
  entities: [
    { id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'arc', kind: 'arc', centerPointId: 'c', startPointId: 'd', endPointId: 'e', direction: 'ccw', construction: false },
    { id: 'circle', kind: 'circle', centerPointId: 'c', radius: 2, construction: false }
  ],
  relations: [{ id: 'gap', kind: 'distance', pointIds: ['a', 'b'], value: 'span' }]
});
const lowering = () => {
  const model = compileCadSketchEquations({ graph, parameters: { span: 10 } }), points = new Map(graph.points.map(point => [point.id, { x: 0, y: 0 }]));
  return new CadSketchLowering(graph, { span: 10 }, model.pointParameters, model.radiusParameters, points);
};
const refusal = (run: () => unknown) => { try { run(); } catch (error) { return error; } return undefined; };

describe('sketch relation lowering', () => {
  it('reads each operand by what it gives, and refuses one that cannot give it', () => {
    const context = lowering(), edge = (id: string) => context.edge(id);
    expect(edge('line')).toBe(graph.entities[0]);
    expect(context.support(edge('line'))).toEqual([...context.point('a'), ...context.point('b')]);
    expect(context.centre(edge('arc'))).toBe('c');
    expect(context.size(edge('arc'))).toEqual({ kind: 'span', span: context.through('c', 'd') });
    expect(context.size(edge('circle'))).toEqual({ kind: 'parameter', index: 10 });
    expect(context.value('gap', 'value')).toBe(10);
    for (const [run, operandId, capability] of [
      [() => context.support(edge('arc')), 'arc', 'support'], [() => context.support(edge('circle')), 'circle', 'support'],
      [() => context.centre(edge('line')), 'line', 'centre'], [() => context.size(edge('line')), 'line', 'size'],
      [() => context.point('missing'), 'missing', 'point'], [() => context.edge('missing'), 'missing', 'edge'],
      [() => context.value('gap', 'spacing'), 'gap.spacing', 'value'], [() => context.value('missing', 'value'), 'missing.value', 'value']
    ] as const) {
      const error = refusal(run);
      expect(error).toBeInstanceOf(CadSketchLoweringRefusal);
      expect(error).toMatchObject({ code: 'unlowerable-sketch-operand', operandId, capability });
    }
    // A refused read emits nothing.
    expect(context.equations).toEqual([]);
  });

  it('declares what each driving value of every kind measures', () => {
    for (const kind of CAD_SKETCH_RELATION_KINDS) {
      const scalars = CAD_SKETCH_RELATION_DEFINITIONS[kind].scalars;
      if (!scalars) continue;
      expect(Object.keys(scalars.quantity).sort(), kind).toEqual([...scalars.keys].sort());
      for (const quantity of Object.values(scalars.quantity)) expect(CAD_SKETCH_QUANTITIES, kind).toContain(quantity);
    }
    expect(CAD_SKETCH_RELATION_DEFINITIONS['line-angle'].scalars?.quantity).toEqual({ value: 'angle' });
  });
});
