// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cadSketchToDxf } from '@/domain/cad/cadCam';
import type { CadDocument } from '@/domain/cad/cadDocument';
import { measureCadSketch } from '@/domain/cad/cadMeasurements';
import { createCadDocument, parseCadDocument } from '@/domain/cad/cadSchema';
import { checkCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation, type CadSketchReferenceDimension } from '@/domain/cad/cadSketchGraph';
import { createCadSketchMeasurementReader } from '@/domain/cad/cadSketchMeasurements';
import { measureCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { cadSketchRelationPlacement } from '@/domain/cad/cadSketchRelationPlacement';
import { prepareCadEdits } from './cadEditPreparation';
import { describeCadSketchConstraintSource } from './cadSketchConstraintFeedback';
import { inspectCadSketchConstraints, pageCadSketchConstraints } from './cadSketchConstraintInspection';
import { cadSketchDiagnosisMarks } from './cadSketchDefinitionMarks';
import { cadSketchDimensionToDriving } from './cadSketchDimensionCommands';
import { cadSketchDimensionName, cadSketchRelationHighlight } from './cadSketchDimensionSelection';
import { cadSketchDimensionMove, cadSketchDrawnDimensions, layoutCadSketchGraphDimensions, type CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import { cadSketchRelationGlyphEntries, layoutCadSketchRelationGlyphs } from './cadSketchRelationGlyphLayout';
import { cadSketchRelationOperandLabels } from './cadSketchRelationNames';
import { createCadSketchTestSolver } from './sketch-solver/__tests__/cadSketchTestSolver';

// Every reader that resolves a stored relation's operands, run over each stored form that names the origin or an axis: the forms no
// other kind keeps, so the sketch stores them with @origin, @h or @v as an operand.

const solver = createCadSketchTestSolver();
const POINTS = { e: [-5, -7], f: [5, 7], d: [-6, -8], s: [6, -2], t: [6, 2], u: [-3, 9], w: [3, 9], p: [3, 4], q: [-4, 5], a: [2, 3], b: [12, 3],
  g: [30, -10], h: [40, 0], k: [20, 5] } as const;
const ENTITIES = [
  { id: 'span', kind: 'line', construction: true, startPointId: 'e', endPointId: 'f' },
  { id: 'loop', kind: 'circle', construction: true, centerPointId: 'd', radius: 10 },
  { id: 'edge', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
  { id: 'slope', kind: 'line', construction: false, startPointId: 'g', endPointId: 'h' },
  { id: 'ring', kind: 'circle', construction: false, centerPointId: 'k', radius: 5 }] as const;
/** One of each stored form, all satisfied by the points above. */
const STORED = [
  { id: 'middle', kind: 'midpoint', pointId: '@origin', lineId: 'span' },
  { id: 'on-loop', kind: 'point-on-curve', pointId: '@origin', curveId: 'loop' },
  { id: 'mirror-h', kind: 'symmetric', pointIds: ['s', 't'], lineId: '@h' },
  { id: 'mirror-v', kind: 'symmetric', pointIds: ['u', 'w'], lineId: '@v' },
  { id: 'reach', kind: 'distance', pointIds: ['p', '@origin'], value: 5 },
  { id: 'offset', kind: 'point-line-distance', pointId: '@origin', lineId: 'edge', side: 'right', value: 3 },
  { id: 'rise', kind: 'line-angle', rays: [{ lineId: 'slope', towardPointId: 'h' }, { lineId: '@h', towardPointId: '@h' }], sense: 'cw', value: 45 },
  { id: 'upright', kind: 'line-angle', rays: [{ lineId: '@v', towardPointId: '@v' }, { lineId: 'edge', towardPointId: 'b' }], sense: 'cw', value: 90 },
  { id: 'touch', kind: 'tangent', curveIds: ['ring', '@h'] },
  { id: 'read-reach', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['q', '@origin'] } },
  { id: 'read-offset', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: '@origin', lineId: 'slope' } },
  { id: 'read-height', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'p', lineId: '@h' } }] as const;
const LABELS: Readonly<Record<string, readonly string[]>> = { middle: ['Origin'], 'on-loop': ['Origin'], 'mirror-h': ['H axis'], 'mirror-v': ['V axis'], reach: ['Origin'],
  offset: ['Origin'], rise: ['H axis'], upright: ['V axis'], touch: ['H axis'], 'read-reach': ['Origin'], 'read-offset': ['Origin'], 'read-height': ['H axis'] };

function document(): CadDocument {
  return parseCadDocument({ ...createCadDocument('Axis readers', 'axis-readers'), schemaVersion: 2, features: [{ id: 'sketch', name: 'Axes', kind: 'sketch', suppressed: false,
    plane: 'XY', offset: 0, profiles: [], graph: { points: Object.entries(POINTS).map(([id, position]) => ({ id, position })), entities: ENTITIES, relations: STORED } }] });
}
const graphOf = (source: CadDocument): CadSketchGraph => { const sketch = source.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing sketch.'); return sketch.graph; };
const relation = (graph: CadSketchGraph, id: string) => graph.relations.find(item => item.id === id)!;
const dimensions = (graph: CadSketchGraph) => graph.relations.filter((item): item is CadSketchDimensionRelation & CadSketchGraphRelation =>
  ['distance', 'point-line-distance', 'line-angle', 'reference-dimension'].includes(item.kind));

describe('readers of relations that name the origin or an axis', () => {
  it('parse, export, check and inspect every stored form without losing the virtual operands', async () => {
    const source = document(), graph = graphOf(source);
    expect(parseCadDocument(JSON.parse(JSON.stringify(source)))).toEqual(source);
    expect(checkCadSketchGraph(graph, {})).toEqual([]);
    // Export writes the material contours, the ring here, and reads no relation.
    expect(cadSketchToDxf(source, 'sketch')).toContain('CIRCLE');
    expect(measureCadSketch(source, 'sketch').sketchId).toBe('sketch');
    const inspection = await inspectCadSketchConstraints(source, 'sketch', async () => solver);
    expect(inspection.analysis).toMatchObject({ kind: 'solved', diagnostics: { conflictingIds: [], redundantIds: [] } });
    for (const section of ['points', 'entities', 'relations'] as const) expect(pageCadSketchConstraints(inspection, { section, limit: 50 }).items.length).toBeGreaterThan(0);
    const rows = pageCadSketchConstraints(inspection, { section: 'relations', limit: 50 }).items as readonly { source: CadSketchGraphRelation; measurement?: { valueMm: number } }[];
    expect(rows.map(row => row.source)).toEqual(graph.relations);
    expect(Object.fromEntries(rows.filter(row => row.measurement).map(row => [row.source.id, row.measurement!.valueMm])))
      .toEqual({ 'read-reach': expect.closeTo(Math.hypot(4, 5), 9), 'read-offset': expect.closeTo(40 / Math.SQRT2, 9), 'read-height': expect.closeTo(4, 9) });
  });

  it('name, describe, highlight, mark and place each relation by its fixed operand', () => {
    const graph = graphOf(document());
    for (const item of graph.relations) {
      expect(cadSketchRelationOperandLabels(graph, item)).toEqual(expect.arrayContaining([...LABELS[item.id]]));
      const described = describeCadSketchConstraintSource(graph, { kind: 'relation', id: item.id });
      expect(described.label).not.toMatch(/Unavailable/);
      expect([...described.pointIds, ...described.entityIds].some(id => id.startsWith('@'))).toBe(false);
      expect(() => cadSketchRelationHighlight(graph, item)).not.toThrow();
      expect(() => cadSketchRelationPlacement(graph, [item])).not.toThrow();
    }
    // A relation reported as conflicting marks the stored geometry it holds; the origin and axes are drawn by the canvas, not marked.
    const marks = cadSketchDiagnosisMarks('sketch', graph, { conflictingIds: graph.relations.map(item => item.id), redundantIds: [], partiallyRedundantIds: [] })!;
    expect([...marks.conflicting.pointIds].sort()).toEqual(['b', 'd', 'e', 'f', 'g', 'h', 'k', 'p', 'q', 's', 't', 'u', 'w', 'a'].sort());
    expect([...marks.conflicting.entityIds].sort()).toEqual(['edge', 'loop', 'ring', 'slope', 'span']);
  });

  it('draw, name and move every dimension and lay out every glyph', () => {
    const graph = graphOf(document()), drawn = cadSketchDrawnDimensions(graph, {});
    const laid = new Set(layoutCadSketchGraphDimensions(graph, {}, 0.05).map(layout => layout.relation.id));
    for (const item of dimensions(graph)) {
      expect(laid.has(item.id)).toBe(true);
      expect(cadSketchDimensionName(graph, item)).not.toBe('');
      expect(cadSketchDimensionMove(graph, {}, 0.05, item.id)).not.toBeNull();
    }
    expect(drawn).toBeTruthy();
    const glyphs = new Set(layoutCadSketchRelationGlyphs(graph, {}).flatMap(glyph => glyph.relationIds));
    for (const id of ['middle', 'on-loop', 'mirror-h', 'mirror-v', 'touch']) expect(glyphs.has(id)).toBe(true);
    expect(cadSketchRelationGlyphEntries(graph).length).toBeGreaterThan(0);
  });

  it('measures to the origin and an axis, and refuses the length of an axis with the reason', () => {
    const graph = graphOf(document()), reader = createCadSketchMeasurementReader(graph, {});
    expect(reader.betweenPoints('p', '@origin').distanceMm).toBeCloseTo(5, 9);
    expect(reader.pointToLine('p', '@h').signedMm).toBeCloseTo(4, 9);
    expect(reader.pointToLine('p', '@v').signedMm).toBeCloseTo(-3, 9);
    expect(reader.pointToLine('@origin', 'edge').signedMm).toBeCloseTo(-3, 9);
    expect(() => reader.entity('@h')).toThrow(expect.objectContaining({ code: 'unsupported-sketch-operand', message: 'The H axis is infinite, so it has no length.' }));
    expect(measureCadSketchReferenceDimension(graph, {}, relation(graph, 'read-height') as CadSketchReferenceDimension)).toBeCloseTo(4, 9);
  });

  it('turns a reference to an axis into the coordinate it holds, and keeps other references as their driving kind', async () => {
    const source = document(), graph = graphOf(source);
    const driving = (id: string) => cadSketchDimensionToDriving(graph, {}, relation(graph, id)).relation;
    expect(driving('read-height')).toEqual({ id: 'read-height', kind: 'fixed-axis', pointId: 'p', axis: 'y', value: expect.closeTo(4, 9) });
    expect(driving('read-offset')).toMatchObject({ id: 'read-offset', kind: 'point-line-distance', pointId: '@origin', lineId: 'slope', side: 'left', value: expect.closeTo(40 / Math.SQRT2, 9) });
    expect(driving('read-reach')).toMatchObject({ id: 'read-reach', kind: 'distance', pointIds: ['q', '@origin'], value: expect.closeTo(Math.hypot(4, 5), 9) });
    const prepared = await prepareCadEdits(source, ['read-height', 'read-offset', 'read-reach'].map(id => ({ kind: 'set-sketch-relation', sketchId: 'sketch', relation: driving(id)! } as const)), solver);
    expect(prepared.sketchDiagnostics[0].diagnostics).toMatchObject({ status: 'success', conflictingIds: [], redundantIds: [] });
    // Once held, the coordinate has its driver: the reference to the axis cannot drive it a second time.
    const held = graphOf(prepared.document), again = { id: 'again', kind: 'reference-dimension', measurement: { kind: 'point-line-distance', pointId: 'p', lineId: '@h' } } as const;
    expect(cadSketchDimensionToDriving({ ...held, relations: [...held.relations, again] }, {}, again)).toEqual({ relation: null,
      reason: 'An existing dimension already drives this distance. Edit that dimension instead.' });
  });
});
