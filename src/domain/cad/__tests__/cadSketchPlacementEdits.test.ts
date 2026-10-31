import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadDocument, CadFeature, CadSketchFeature } from '../cadDocument';
import { applyCadEdits, cadEditsOnlyPlaceDimensions, reduceCadEditIntents, type CadEdit } from '../cadOperations';
import { cadDocumentsPlacedAlike, createCadDocument, hasValidCadSketchGeometry, parseCadDocument } from '../cadSchema';
import { resolveCadSketchContours, resolveCadSketchRegions, validateCadSketchGeometry } from '../cadSketchGeometry';
import { compileCadSketchGraph } from '../cadSketchGraphGeometry';
import type { CadSketchGraphRelation } from '../cadSketchGraph';
import { CadSession } from '@/features/cad/cadSession';

vi.mock('../cadSketchGeometry', async importOriginal => {
  const original = await importOriginal<typeof import('../cadSketchGeometry')>();
  return { ...original, validateCadSketchGeometry: vi.fn(original.validateCadSketchGeometry), resolveCadSketchRegions: vi.fn(original.resolveCadSketchRegions),
    resolveCadSketchContours: vi.fn(original.resolveCadSketchContours) };
});
vi.mock('../cadSketchGraphGeometry', async importOriginal => {
  const original = await importOriginal<typeof import('../cadSketchGraphGeometry')>();
  return { ...original, compileCadSketchGraph: vi.fn(original.compileCadSketchGraph) };
});
/** Every geometry check a parse can run for a sketch: its geometry, its contours, its compiled graph and an extrude's regions. */
const geometryChecks = () => [validateCadSketchGeometry, resolveCadSketchContours, compileCadSketchGraph, resolveCadSketchRegions].map(check => vi.mocked(check).mock.calls.length);

const base = (id: string) => ({ id, name: id, suppressed: false });
const corners = [['a', 0, 0], ['b', 40, 0], ['c', 40, 30], ['d', 0, 30]] as const;
/** A 40 × 30 rectangle of lines with its width, height and a point's distance from the base dimensioned, extruded, and a later boss sketch. */
function part(): CadDocument {
  return parseCadDocument({ ...createCadDocument('Placement', 'placement'), schemaVersion: 2, parameters: { width: 40 }, features: [
    { ...base('plate_sketch'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [], graph: {
      points: [...corners.map(([id, x, y]) => ({ id, position: [x, y] })), { id: 'o', position: [10, 10] }],
      entities: corners.map(([id], index) => ({ id: `edge_${id}`, kind: 'line', startPointId: id, endPointId: corners[(index + 1) % 4][0], construction: false })),
      relations: [
        { id: 'width', kind: 'distance', pointIds: ['a', 'b'], value: 'width' },
        { id: 'height', kind: 'axis-distance', pointIds: ['b', 'c'], axis: 'y', value: 30, annotation: { kind: 'linear', offset: 6, along: 0.5 } },
        { id: 'gap', kind: 'point-line-distance', pointId: 'o', lineId: 'edge_a', side: 'left', value: 10 },
        { id: 'clear', kind: 'reference-dimension', measurement: { kind: 'point-distance', pointIds: ['o', 'c'] } }
      ] } },
    { ...base('plate'), kind: 'extrude', sketchId: 'plate_sketch', distance: 5, symmetric: false, operation: 'new', targetId: null },
    { ...base('boss_sketch'), kind: 'sketch', plane: 'XY', offset: 5, profiles: [
      { id: 'boss', name: 'Boss', construction: false, geometry: { kind: 'circle', x: 20, y: 15, radius: 4 } }] }
  ] as unknown as CadFeature[] });
}
const sketchOf = (document: CadDocument) => document.features[0] as CadSketchFeature;
const relationOf = (document: CadDocument, id: string) => sketchOf(document).graph!.relations.find(relation => relation.id === id)!;
const placing = (document: CadDocument, id: string, annotation: unknown): CadEdit =>
  ({ kind: 'set-sketch-relation', sketchId: 'plate_sketch', relation: { ...relationOf(document, id), annotation } as CadSketchGraphRelation });

describe('edits that only move dimensions', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('check only the new placements and keep every other part, solution and certificate of the accepted part', () => {
    const document = part();
    const edits = [placing(document, 'width', { kind: 'linear', offset: -8, along: 0.25 }), placing(document, 'clear', { kind: 'linear', offset: 3, along: 1.5 })];
    expect(cadEditsOnlyPlaceDimensions(document, edits)).toBe(true);
    vi.clearAllMocks();
    const placed = applyCadEdits(document, edits);
    // No geometry is checked, compiled or resolved again: placement is display data.
    expect(geometryChecks()).toEqual([0, 0, 0, 0]);
    expect(parseCadDocument(placed)).toBe(placed);
    expect(Object.isFrozen(placed) && Object.isFrozen(relationOf(placed, 'width'))).toBe(true);
    expect(relationOf(placed, 'width')).toMatchObject({ annotation: { kind: 'linear', offset: -8, along: 0.25 } });
    expect(relationOf(placed, 'clear')).toMatchObject({ annotation: { kind: 'linear', offset: 3, along: 1.5 } });
    // Everything else is the accepted part's own data.
    placed.features.slice(1).forEach((feature, index) => expect(feature).toBe(document.features[index + 1]));
    const graph = sketchOf(placed).graph!, accepted = sketchOf(document).graph!;
    expect(graph.points).toBe(accepted.points); expect(graph.entities).toBe(accepted.entities);
    for (const id of ['height', 'gap']) expect(relationOf(placed, id)).toBe(relationOf(document, id));
    expect(hasValidCadSketchGeometry(sketchOf(placed), placed.parameters)).toBe(true);
    // The full path reaches the same part.
    expect(JSON.stringify(placed)).toBe(JSON.stringify(parseCadDocument(structuredClone(reduceCadEditIntents(document, edits)))));
    // A later parse that lists the moved sketch and its extrude keeps their certificates too.
    vi.clearAllMocks();
    const renamed = parseCadDocument({ ...placed, name: 'Renamed' });
    expect(geometryChecks()).toEqual([0, 0, 0, 0]);
    expect(renamed.features[0]).toBe(placed.features[0]);
    // Each move of the line is known to keep what analysis reads, from identity alone; geometry, parameters or another sketch are not.
    const again = applyCadEdits(placed, [placing(placed, 'gap', { kind: 'linear', offset: 2, along: 0.5 })]);
    expect([cadDocumentsPlacedAlike(document, placed, 'plate_sketch'), cadDocumentsPlacedAlike(document, again, 'plate_sketch'), cadDocumentsPlacedAlike(again, document, 'plate_sketch')]).toEqual([true, true, true]);
    expect(cadDocumentsPlacedAlike(document, placed, 'boss_sketch')).toBe(false);
    const moved = applyCadEdits(placed, [{ kind: 'move-sketch-point', sketchId: 'plate_sketch', pointId: 'o', translation: [1, 0] }]);
    expect(cadDocumentsPlacedAlike(document, moved, 'plate_sketch')).toBe(false);
    expect(cadDocumentsPlacedAlike(document, applyCadEdits(placed, [{ kind: 'set-parameter', name: 'spare', value: 1 }]), 'plate_sketch')).toBe(false);
  });

  it('take the full path for any other change, and refuse a placement that does not fit with the full path’s reason', () => {
    const document = part();
    const value: CadEdit = { kind: 'set-sketch-relation', sketchId: 'plate_sketch', relation: { ...relationOf(document, 'gap'), value: 12 } as CadSketchGraphRelation };
    const added: CadEdit = { kind: 'set-sketch-relation', sketchId: 'plate_sketch', relation: { id: 'new', kind: 'reference-dimension', measurement: { kind: 'line-length', entityId: 'edge_b' } } };
    for (const edits of [[value], [placing(document, 'width', { kind: 'linear', offset: 1, along: 0.5 }), value], [added], []])
      expect(cadEditsOnlyPlaceDimensions(document, edits)).toBe(false);
    vi.clearAllMocks();
    applyCadEdits(document, [added]);
    expect(vi.mocked(validateCadSketchGeometry)).toHaveBeenCalledTimes(1);
    // A reference distance cannot take a radial placement, and a placement out of range is malformed: both refused as the full parse refuses them.
    const misfit = placing(document, 'clear', { kind: 'radial', angle: 0, distance: 4 }), far = placing(document, 'width', { kind: 'linear', offset: 1e7, along: 0.5 });
    expect(() => applyCadEdits(document, [misfit])).toThrow(expect.objectContaining({ code: 'invalid-sketch-annotation' }));
    expect(() => parseCadDocument(structuredClone(reduceCadEditIntents(document, [misfit])))).toThrow(expect.objectContaining({ code: 'invalid-sketch-annotation' }));
    expect(() => applyCadEdits(document, [far])).toThrow(expect.objectContaining({ code: 'invalid-edit' }));
    // Putting a dimension back where it was changes nothing.
    expect(applyCadEdits(document, [placing(document, 'height', { kind: 'linear', offset: 6, along: 0.5 })])).toBe(document);
  });

  it('are one undo step of the session, which undoes and redoes them without checking geometry and keeps the saved state', () => {
    const session = new CadSession(part()), original = session.getSnapshot();
    vi.clearAllMocks();
    const moved = session.edit([placing(original.document, 'gap', { kind: 'linear', offset: -4, along: 2 })], original.version);
    expect(moved.version).not.toBe(original.version); expect(moved.canUndo).toBe(true);
    expect(() => session.edit([placing(moved.document, 'gap', { kind: 'linear', offset: 4, along: 2 })], original.version)).toThrow('The CAD draft changed');
    session.undo();
    expect(session.getSnapshot().document).toBe(original.document);
    session.redo();
    expect(session.getSnapshot().document).toBe(moved.document);
    expect(geometryChecks()).toEqual([0, 0, 0, 0]);
  });
});
