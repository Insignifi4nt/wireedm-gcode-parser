import { describe, expect, it } from 'vitest';
import { parseCadSketchGraph } from '../cadSketchGraph';
import type { CadSketchFeature } from '../cadDocument';
import { prepareCadSketchGraphCells } from '../cadSketchGraphCells';
import { measureCadResolvedProfile } from '../cadMeasurements';
import { resolveCadSketchRegions } from '../cadSketchGeometry';
import { prepareCadSketchCells, inspectCadSketchRegions, readCadSketchRegionReference, cadSketchCellModeForAreas } from '../cadSketchRegionInspection';
import { createCadDocument, parseCadDocument } from '../cadSchema';

function circles(radii = [5, 5], separation: number | string = 'spacing'): CadSketchFeature {
  return { id: 's', name: 'Circles', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [],
    graph: parseCadSketchGraph({ points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [separation, 0] }],
      entities: radii.map((radius, index) => ({ id: `circle${index}`, kind: 'circle', construction: false,
        centerPointId: index === 0 ? 'a' : 'b', radius })), relations: [] }) };
}
const area = (regions: ReturnType<ReturnType<typeof prepareCadSketchGraphCells>['resolve']>) => regions.reduce((sum, region) =>
  sum + measureCadResolvedProfile(region.boundary.geometry).areaMm2
    - region.voids.reduce((holes, hole) => holes + measureCadResolvedProfile(hole.geometry).areaMm2, 0), 0);

describe('explicit analytic graph cells', () => {
  it('retains the selected divider side through dimension/reorder and rejects replacement or crossing-order changes', () => {
    const raw = { points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }, { id: 'd', position: [0, 10] },
      { id: 'low', position: [' divider ', -2] }, { id: 'high', position: [' divider ', 12] }
    ], entities: [
      { id: 'bottom', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
      { id: 'right', kind: 'line', construction: false, startPointId: 'b', endPointId: 'c' },
      { id: 'top', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
      { id: 'left', kind: 'line', construction: false, startPointId: 'd', endPointId: 'a' },
      { id: 'divider', kind: 'line', construction: false, startPointId: 'low', endPointId: 'high' }
    ], relations: [] };
    const source = { ...circles(), graph: parseCadSketchGraph(raw) }, before = JSON.stringify(source);
    const catalog = prepareCadSketchGraphCells(source, { divider: 5 }), left = catalog.pick({ x: 1, y: 5 });
    if (!left) throw Error('Expected left cell');
    const selected = catalog.pack([left.id]), moved = prepareCadSketchGraphCells(source, { divider: 3 });
    expect(area(moved.resolve(selected))).toBeCloseTo(30, 12);
    const union = catalog.resolve(catalog.pack(catalog.cells.map(cell => cell.id)));
    expect(union).toHaveLength(1); expect(area(union)).toBe(100);
    expect(measureCadResolvedProfile(union[0].boundary.geometry).perimeterMm).toBe(40);
    const reordered = { ...source, graph: parseCadSketchGraph({ ...raw, points: [...raw.points].reverse(), entities: [...raw.entities].reverse() }) };
    expect(prepareCadSketchGraphCells(reordered, { divider: 5 }).pack([left.id])).toEqual(selected);
    const replaced = { ...source, graph: parseCadSketchGraph({ ...raw, entities: raw.entities.map(entity => entity.id === 'divider' ? { ...entity, id: 'replacement' } : entity) }) };
    expect(() => prepareCadSketchGraphCells(replaced, { divider: 5 }).resolve(selected)).toThrow(/changed/i);
    const two = { ...source, graph: parseCadSketchGraph({ ...raw,
      points: [...raw.points, { id: 'low2', position: ['second', -2] }, { id: 'high2', position: ['second', 12] }],
      entities: [...raw.entities, { id: 'divider2', kind: 'line', construction: false, startPointId: 'low2', endPointId: 'high2' }] }) };
    const prior = prepareCadSketchGraphCells(two, { divider: 3, second: 7 });
    const side = prior.pick({ x: 1, y: 5 }); if (!side) throw Error('Expected side cell');
    expect(() => prepareCadSketchGraphCells(two, { divider: 8, second: 2 }).resolve(prior.pack([side.id]))).toThrow(/changed/i);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('packs lens source witnesses once and unions shared curved ranges before material creation', () => {
    const source = circles(), before = JSON.stringify(source), catalog = prepareCadSketchGraphCells(source, { spacing: 6 });
    expect(catalog.cells).toHaveLength(3);
    const lens = [...catalog.cells].sort((a, b) => a.areaMm2 - b.areaMm2)[0];
    expect(lens.areaMm2).toBeCloseTo(50 * Math.acos(0.6) - 24, 11);
    const selection = catalog.pack([lens.id]);
    expect(selection.sources).toHaveLength(2);
    expect(catalog.pack(catalog.cells.map(cell => cell.id)).sources).toHaveLength(2);
    expect(selection.sources.every(witness => witness.kind === 'circle')).toBe(true);
    expect(catalog.resolve(selection)[0].boundary.geometry.kind).toBe('path');
    const lobe = catalog.cells.find(cell => cell.id !== lens.id);
    if (!lobe) throw Error('Expected a lobe');
    expect(area(catalog.resolve(catalog.pack([lens.id, lobe.id])))).toBeCloseTo(25 * Math.PI, 10);
    expect(area(catalog.resolve(catalog.pack(catalog.cells.map(cell => cell.id))))).toBeCloseTo(50 * Math.PI - lens.areaMm2, 10);
    expect(Object.isFrozen(selection.sources[0].events)).toBe(true);
    expect(catalog.selectedCellIds({ cells: selection.cells, sources: selection.sources, kind: 'graph-cells' })).toEqual([lens.id]);
    expect(JSON.stringify(source)).toBe(before);
    const moved = prepareCadSketchGraphCells(source, { spacing: 7 });
    expect(moved.selectedCellIds(selection)).toEqual([lens.id]);
    expect(area(moved.resolve(selection))).toBeLessThan(lens.areaMm2);
    expect(() => prepareCadSketchGraphCells(source, { spacing: 10 }).resolve(selection)).toThrow();
  });

  it('lists nested disconnected circles once and cancels a selected disk/annulus interface', () => {
    const catalog = prepareCadSketchGraphCells(circles([10, 6, 2], 0), {});
    expect(catalog.cells).toHaveLength(3);
    expect(catalog.cells.map(cell => cell.voids.length).sort()).toEqual([0, 1, 1]);
    const small = [...catalog.cells].sort((a, b) => a.areaMm2 - b.areaMm2).slice(0, 2);
    const result = catalog.resolve(catalog.pack(small.map(cell => cell.id)));
    expect(result).toHaveLength(1); expect(result[0].voids).toEqual([]);
    expect(area(result)).toBeCloseTo(36 * Math.PI, 10);
    expect(catalog.pack([])).toEqual({ kind: 'graph-cells', sources: [], cells: [] });
    expect(catalog.selectedCellIds(catalog.pack([]))).toEqual([]);
    expect(() => catalog.resolve(catalog.pack([]))).toThrow();
  });

  it('preserves circle branch identity across the angular seam and handles an independently nested hole', () => {
    const source = { ...circles(), graph: parseCadSketchGraph({ points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: ['bx', 'by'] }
    ], entities: [
      { id: 'circle0', kind: 'circle', construction: false, centerPointId: 'a', radius: 5 },
      { id: 'circle1', kind: 'circle', construction: false, centerPointId: 'b', radius: 5 }
    ], relations: [] }) };
    const environment = (angle: number) => ({ bx: 6 * Math.cos(angle), by: 6 * Math.sin(angle) });
    const catalog = prepareCadSketchGraphCells(source, environment(0.9));
    const lens = catalog.pick({ x: environment(0.9).bx / 2, y: environment(0.9).by / 2 });
    if (!lens) throw Error('Expected lens');
    const selected = catalog.pack([lens.id]), moved = prepareCadSketchGraphCells(source, environment(1));
    expect(area(moved.resolve(selected))).toBeCloseTo(lens.areaMm2, 10);
    const plain = circles(), graph = plain.graph;
    if (!graph) throw Error('Expected graph');
    const holed = prepareCadSketchGraphCells({ ...plain, graph: parseCadSketchGraph({ ...graph,
      points: [...graph.points, { id: 'hole-center', position: [3, 0] }],
      entities: [...graph.entities, { id: 'hole', kind: 'circle', construction: false, centerPointId: 'hole-center', radius: 1 }] }) }, { spacing: 6 });
    const annularLens = holed.pick({ x: 3, y: 2 }), disk = holed.pick({ x: 3, y: 0 });
    expect(annularLens).not.toBeNull(); expect(disk).not.toBeNull();
    if (!annularLens || !disk) throw Error('Expected holed lens and disk');
    expect(holed.resolve(holed.pack([annularLens.id]))[0].voids).toHaveLength(1);
    expect(area(holed.resolve(holed.pack([annularLens.id, disk.id])))).toBeCloseTo(50 * Math.acos(0.6) - 24, 10);
  });

  it('rejects a point-touching union while each ordinary crossing cell remains usable', () => {
    const source = { ...circles(), graph: parseCadSketchGraph({ points: [
      { id: 'a', position: [0, 0] }, { id: 'b', position: [10, 10] }, { id: 'c', position: [0, 10] }, { id: 'd', position: [10, 0] }
    ], entities: [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a']].map(([startPointId, endPointId], index) => ({
      id: `edge${index}`, kind: 'line', construction: false, startPointId, endPointId })), relations: [] }) };
    const catalog = prepareCadSketchGraphCells(source, {});
    expect(catalog.cells).toHaveLength(2);
    expect(area(catalog.resolve(catalog.pack([0])))).toBe(25);
    expect(() => catalog.resolve(catalog.pack([0, 1]))).toThrow(/point|ambiguous/i);
  });

  it('rejects material legacy mixing while construction remains outside the graph catalog', () => {
    const source = circles();
    const legacy = { id: 'legacy', name: 'Reference', construction: false, geometry: { kind: 'circle' as const, x: 100, y: 100, radius: 2 } };
    expect(() => prepareCadSketchGraphCells({ ...source, profiles: [legacy] }, { spacing: 6 })).toThrow(/legacy/i);
    const compatible = { ...source, profiles: [legacy] }, old = prepareCadSketchCells(compatible, { spacing: 6 });
    expect(old.cells).toHaveLength(1);
    expect(area(resolveCadSketchRegions(compatible, { spacing: 6 }))).toBeCloseTo(4 * Math.PI, 12);
    expect(area(old.resolve(old.pack(old.cells.map(cell => cell.id))))).toBeCloseTo(4 * Math.PI, 12);
    expect(prepareCadSketchGraphCells({ ...source, profiles: [{ ...legacy, construction: true }] }, { spacing: 6 }).cells).toHaveLength(3);
    const catalog = prepareCadSketchGraphCells(source, { spacing: 6 });
    expect(catalog.selectedCellIds(undefined)).toEqual([]);
    expect(catalog.selectedCellIds([{ boundaryProfileId: 'circle0', voidProfileIds: [], ancestorProfileIds: [] }])).toEqual([]);
    expect(() => catalog.pack([0, 0])).toThrow();
    expect(() => catalog.pack([99])).toThrow();
  });

  it('keeps old defaults/catalog rows separate and reads one merged graph selection through existing inspection', () => {
    const source = circles([10, 6, 2], 0);
    const old = prepareCadSketchCells(source, {}), graph = prepareCadSketchCells(source, {}, 'graph-cells');
    expect(old.cells).toHaveLength(3); expect(graph.cells).toHaveLength(3);
    const baseline = old.pack(old.cells.filter(cell => cell.defaultMaterial).map(cell => cell.id));
    expect(graph.selectedCellIds(baseline)).toEqual([]);
    expect(old.selectedCellIds(graph.pack([0]))).toEqual([]);
    expect(area(resolveCadSketchRegions(source, {}))).toBeCloseTo(area(old.resolve()), 12);
    const document = parseCadDocument({ ...createCadDocument('Cells', 'part'), schemaVersion: 2, features: [source] });
    const page = inspectCadSketchRegions(document, 's', { mode: 'graph-cells', limit: 2 });
    expect(page.items).toHaveLength(2); expect(page.nextOffset).toBe(2);
    const selected = readCadSketchRegionReference(document, 's', { cellIds: page.items.map(item => item.cellId) });
    expect(selected).toEqual(graph.pack(page.items.map(item => item.cellId)));
    expect(cadSketchCellModeForAreas(circles(), { spacing: 6 })).toBe('graph-cells');
    expect(cadSketchCellModeForAreas(source, {})).toBe('contours');
    expect(cadSketchCellModeForAreas(source, {}, selected)).toBe('graph-cells');
  });
});
