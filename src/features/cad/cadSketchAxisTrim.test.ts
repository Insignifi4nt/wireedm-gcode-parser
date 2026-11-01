// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { applyCadEdits } from '@/domain/cad/cadOperations';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { inspectCadSketchRegions } from '@/domain/cad/cadSketchRegionInspection';
import { prepareCadEdits } from './cadEditPreparation';
import { prepareCadSketchExtendEndPreview, prepareCadSketchTrimPreview } from './CadSketchBoundaryPreview';
import { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

// A click trims and extends at drawn edges only, as it always has: the H and V axes cut only where a request names them, and then as
// infinite fixed lines, while the axes themselves are never what is trimmed or extended.

const runtime = createCadSketchTestSolver();
const sketchOf = (graph: unknown): CadDocument => parseCadDocument({ ...createCadDocument('Axis cuts', 'axis-cuts'), schemaVersion: 2, features: [{
  id: 'sketch', name: 'Axes', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph }] });
/** An upright stem crossing the H axis at (12, 0), and a level rail whose start would reach the V axis at (0, 2); nothing else is drawn. */
const part = () => sketchOf({
  points: [{ id: 'a', position: [12, -4] }, { id: 'b', position: [12, 6] }, { id: 'c', position: [4, 2] }, { id: 'd', position: [9, 2] }],
  entities: [{ id: 'stem', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' }, { id: 'rail', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' }],
  relations: [] });
/** A circle centred on the origin with a chord across its top, and a lone circle on the origin, both crossing both axes. */
const rounds = () => sketchOf({
  points: [{ id: 'center', position: [' 0.00 ', '0'] }, { id: 'a', position: ['-8', '6'] }, { id: 'b', position: ['8', '6'] }, { id: 'o', position: [0, 0] }],
  entities: [{ id: 'rim', kind: 'circle', centerPointId: 'center', radius: 10, construction: false },
    { id: 'chord', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
    { id: 'ring', kind: 'circle', centerPointId: 'o', radius: 5, construction: false }],
  relations: [] });
const graphOf = (document: CadDocument): CadSketchGraph => { const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch.'); return sketch.graph; };
const position = (graph: CadSketchGraph, id: string) => graph.points.find(point => point.id === id)!.position.map(Number);
const failure = (run: () => unknown) => { try { run(); } catch (error) { return error; } throw new Error('Expected a failure.'); };

describe('a click trims and extends at drawn edges only', () => {
  it('quick-trims a circle centred on the origin exactly as before, from the canvas and for an agent', () => {
    const source = rounds(), interaction = prepareCadSketchGraphInteraction(graphOf(source), source.parameters);
    // The pick at the top of the rim lies on the V axis, which must not cut there: the cap between the chord's ends is removed.
    const preview = prepareCadSketchTrimPreview(interaction, 'sketch', 'rim', [0, 10]);
    if (preview.kind !== 'ready') throw new Error(`Expected a trim, got ${JSON.stringify(preview)}.`);
    const target = { kind: 'circle', entityId: 'rim', parameter: expect.closeTo(.25, 12), boundaries: [
      expect.objectContaining({ entityId: 'chord', endpointPointId: 'b', position: [8, 6] }), expect.objectContaining({ entityId: 'chord', endpointPointId: 'a', position: [-8, 6] })] };
    expect(preview.edit).toMatchObject({ kind: 'trim-sketch-entity', trim: { ...target, cutPointIds: ['b', 'a'] } });
    expect((preview.edit as { trim: { boundaries: readonly unknown[] } }).trim.boundaries).toHaveLength(2);
    expect(inspectCadSketchRegions(source, 'sketch', { trimAt: { entityId: 'rim', parameter: .25 } }).trimPreview?.target).toEqual(target);
    // With no drawn edge across it, a circle on the origin is removed whole, from the canvas and for an agent.
    const lone = prepareCadSketchTrimPreview(interaction, 'sketch', 'ring', [5 * Math.cos(.2 * Math.PI), 5 * Math.sin(.2 * Math.PI)]);
    expect(lone).toMatchObject({ kind: 'ready', edit: { trim: { kind: 'delete', entityId: 'ring' } }, help: expect.stringMatching(/^No cutting boundary\./) });
    expect(inspectCadSketchRegions(source, 'sketch', { trimAt: { entityId: 'ring', parameter: .1 } }).trimPreview?.target).toEqual({ kind: 'delete', entityId: 'ring', parameter: .1 });
  });

  it('trims a line across the H axis and extends a line toward the V axis only at drawn edges', () => {
    const source = part(), interaction = prepareCadSketchGraphInteraction(graphOf(source), source.parameters);
    expect(prepareCadSketchTrimPreview(interaction, 'sketch', 'stem', [12, -3])).toMatchObject({ kind: 'ready', edit: { trim: { kind: 'delete', entityId: 'stem' } } });
    expect(inspectCadSketchRegions(source, 'sketch', { trimAt: { entityId: 'stem', parameter: .1 } }).trimPreview?.target).toMatchObject({ kind: 'delete' });
    expect(prepareCadSketchExtendEndPreview(interaction, 'sketch', 'rail', 'start')).toMatchObject({ kind: 'unavailable' });
    expect(failure(() => inspectCadSketchRegions(source, 'sketch', { extendAt: { entityId: 'rail', end: 'start' } })))
      .toMatchObject({ code: 'missing-sketch-extend-boundary', message: 'No finite boundary intersects this line beyond the selected endpoint.' });
  });
});

describe('trim and extend at an axis the request names', () => {
  it('trims a line to the H axis, keeping the cut on the axis, and refuses the axis as what is trimmed', async () => {
    const source = part(), inspection = inspectCadSketchRegions(source, 'sketch', { trimAt: { entityId: 'stem', parameter: 0.1 }, axes: ['@h'] });
    expect(inspection.trimPreview).toMatchObject({ target: { kind: 'end', end: 'start', boundary: { entityId: '@h', position: [12, 0] } }, attachment: { kind: 'fixed-axis', axis: 'y', value: 0 } });
    const target = inspection.trimPreview!.target as Record<string, unknown>;
    // The edit names the axis as its boundary, so its check cuts at that axis too.
    const prepared = await prepareCadEdits(source, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: { ...target, cutPointId: 'cut', attachRelationId: 'on-h' } } as never], runtime);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [] });
    const graph = graphOf(prepared.document);
    expect(graph.entities.find(entity => entity.id === 'stem')).toMatchObject({ startPointId: 'cut', endPointId: 'b' });
    expect(position(graph, 'cut')).toEqual([12, 0]);
    expect(graph.relations).toEqual([{ id: 'on-h', kind: 'fixed-axis', pointId: 'cut', axis: 'y', value: 0 }]);
    // A witness that no longer matches the axis cut is stale, never retargeted.
    const boundary = target.boundary as Record<string, unknown>;
    expect(failure(() => applyCadEdits(source, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: { ...target, boundary: { ...boundary, position: [12, 1] }, cutPointId: 'cut' } } as never])))
      .toMatchObject({ code: 'stale-sketch-trim' });
    expect(failure(() => applyCadEdits(source, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: { ...target, entityId: '@h', cutPointId: 'cut' } } as never])))
      .toMatchObject({ code: 'fixed-sketch-element' });
  });

  it('extends a line to the V axis, and refuses the axis as what is extended', async () => {
    const source = part(), inspection = inspectCadSketchRegions(source, 'sketch', { extendAt: { entityId: 'rail', end: 'start' }, axes: ['@v'] });
    expect(inspection.extendPreview).toMatchObject({ target: { kind: 'line', entityId: 'rail', end: 'start', boundary: { entityId: '@v', position: [0, 2] } } });
    const target = inspection.extendPreview!.target as Record<string, unknown>;
    const graph = graphOf((await prepareCadEdits(source, [{ kind: 'extend-sketch-entity', sketchId: 'sketch', extend: { ...target, endPointId: 'reach' } } as never], runtime)).document);
    expect(graph.entities.find(entity => entity.id === 'rail')).toMatchObject({ startPointId: 'reach', endPointId: 'd' });
    expect(position(graph, 'reach')).toEqual([0, 2]);
    expect(failure(() => applyCadEdits(source, [{ kind: 'extend-sketch-entity', sketchId: 'sketch', extend: { ...target, entityId: '@v', endPointId: 'reach' } } as never])))
      .toMatchObject({ code: 'fixed-sketch-element' });
  });

  it('cuts a circle centred on the origin between both axes when both are named', () => {
    const source = rounds(), inspection = inspectCadSketchRegions(source, 'sketch', { trimAt: { entityId: 'ring', parameter: 0.1 }, axes: ['@h', '@v'] });
    // The quarter from +X to +Y is removed between a cut on each axis, each kept on its axis.
    expect(inspection.trimPreview).toMatchObject({ target: { kind: 'circle', boundaries: [{ entityId: '@h', position: [5, 0] }, { entityId: '@v', position: [0, 5] }] },
      attachments: [{ kind: 'fixed-axis', axis: 'y', value: 0 }, { kind: 'fixed-axis', axis: 'x', value: 0 }] });
    const target = inspection.trimPreview!.target as Record<string, unknown>;
    const graph = graphOf(applyCadEdits(source, [{ kind: 'trim-sketch-entity', sketchId: 'sketch', trim: { ...target, cutPointIds: ['east', 'north'], attachRelationIds: ['on-h', 'on-v'] } } as never]));
    expect(graph.entities.find(entity => entity.id === 'ring')).toMatchObject({ kind: 'arc', centerPointId: 'o', startPointId: 'north', endPointId: 'east', direction: 'ccw' });
    expect(graph.relations).toEqual([{ id: 'on-h', kind: 'fixed-axis', pointId: 'east', axis: 'y', value: 0 }, { id: 'on-v', kind: 'fixed-axis', pointId: 'north', axis: 'x', value: 0 }]);
    // Naming only the H axis cuts at its two crossings alone, so the upper half goes.
    expect(inspectCadSketchRegions(source, 'sketch', { trimAt: { entityId: 'ring', parameter: 0.1 }, axes: ['@h'] }).trimPreview?.target)
      .toMatchObject({ kind: 'circle', boundaries: [{ entityId: '@h', position: [5, 0] }, { entityId: '@h', position: [-5, 0] }] });
  });

  it('takes the axes only beside a Trim or Extend query, each at most once', () => {
    const source = part();
    for (const input of [{ axes: ['@h'] }, { trimAt: { entityId: 'stem', parameter: .1 }, axes: ['@origin'] }, { trimAt: { entityId: 'stem', parameter: .1 }, axes: ['@h', '@h'] },
      { extendAt: { entityId: 'rail', end: 'start' }, axes: '@v' }])
      expect(failure(() => inspectCadSketchRegions(source, 'sketch', input as never))).toMatchObject({ code: 'invalid-region-proposal' });
  });
});
