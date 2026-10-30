import { describe, expect, it } from 'vitest';
import type { CadDocument, CadMesh, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { cadPropertySummary } from './cadPropertySummary';

const sketch: CadSketchFeature = { id: 'sketch', kind: 'sketch', name: 'Sketch 1', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
  points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [40, 0] }, { id: 'c', position: [40, 20] }, { id: 'd', position: [0, 20] }],
  entities: [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['cd', 'c', 'd'], ['da', 'd', 'a']].map(([id, startPointId, endPointId]) => ({ id, kind: 'line' as const, construction: false, startPointId, endPointId })),
  relations: [{ id: 'h', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'len', kind: 'distance', pointIds: ['a', 'b'], value: 40 }]
} };
const document: CadDocument = { ...createCadDocument('Part', 'cad_part'), schemaVersion: 2, features: [sketch,
  { id: 'pad', kind: 'extrude', name: 'Extrude 1', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }] };
const mesh = (featureId: string, volume: number, min: [number, number, number], max: [number, number, number]): CadMesh => ({ featureId, name: featureId, positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume, bounds: { min, max } });
const rows = (summary: ReturnType<typeof cadPropertySummary>) => Object.fromEntries(summary.map(row => [row.label, row.value]));
const planeLabel = () => 'XY plane';

describe('cadPropertySummary', () => {
  it('describes a sketch by plane, geometry, constraints and measured area', () => {
    expect(rows(cadPropertySummary(document, { kind: 'feature', feature: sketch }, [], planeLabel))).toEqual({
      Plane: 'XY plane', Geometry: '4 lines', Constraints: '1 dimension · 1 relation', 'Closed areas': '1',
      'Material area': `${(800).toLocaleString()} mm²`, 'Boundary length': '120 mm', 'Size X × Y': '40 × 20 mm'
    });
  });

  it('counts the dimensions the canvas draws: a coordinate held off an axis and a reference, not a coordinate held on it', () => {
    const held = { ...sketch, graph: { ...sketch.graph!, relations: [...sketch.graph!.relations,
      { id: 'onX', kind: 'fixed-axis' as const, pointId: 'a', axis: 'y' as const, value: ' 0 ' }, { id: 'right', kind: 'fixed-axis' as const, pointId: 'b', axis: 'x' as const, value: 40 },
      { id: 'measured', kind: 'reference-dimension' as const, measurement: { kind: 'point-distance' as const, pointIds: ['a', 'b'] as const } }] } };
    expect(rows(cadPropertySummary({ ...document, features: [held, document.features[1]] }, { kind: 'feature', feature: held }, [], planeLabel)).Constraints).toBe('3 dimensions · 2 relations');
  });

  it('names a feature input and reads its solid from the current build', () => {
    const summary = rows(cadPropertySummary(document, { kind: 'feature', feature: document.features[1] }, [mesh('pad', 4000, [0, 0, 0], [40, 20, 5])], planeLabel));
    expect(summary).toEqual({ Input: 'Sketch 1', Volume: `${(4000).toLocaleString()} mm³`, 'Size X × Y × Z': '40 × 20 × 5 mm' });
  });

  it('totals the body across bodies and says when there is no solid yet', () => {
    expect(rows(cadPropertySummary(document, { kind: 'body' }, [], planeLabel))).toEqual({ Features: '2', Solid: 'None yet' });
    const summary = rows(cadPropertySummary(document, { kind: 'body' }, [mesh('pad', 4000, [0, 0, 0], [40, 20, 5]), { ...mesh('other', 1000, [-10, 0, 0], [0, 10, 10]), solidCount: 2 }], planeLabel));
    expect(summary).toMatchObject({ Volume: `${(5000).toLocaleString()} mm³`, 'Size X × Y × Z': '50 × 20 × 10 mm', Solids: '3' });
  });
});
