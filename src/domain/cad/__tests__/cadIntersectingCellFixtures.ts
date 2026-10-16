import type { CadSketchFeature } from '../cadDocument';
import type { CadSketchGraphCellSelection } from '../cadSketchRegionSelection';
import { prepareCadSketchCells } from '../cadSketchRegionInspection';

export const lensAreaMm2 = 50 * Math.acos(.6) - 24;
export function intersectingCircleSketch(hole = false): CadSketchFeature {
  return { id: 'lens', kind: 'sketch', name: 'Intersecting circles', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
    points: [{ id: 'left', position: ['0.000', ' 0 '] }, { id: 'right', position: [' separation ', 0] }, ...(hole ? [{ id: 'hole-center', position: [3, 0] as const }] : [])],
    entities: [{ id: 'left-circle', kind: 'circle', construction: false, centerPointId: 'left', radius: '5.0000' },
      { id: 'right-circle', kind: 'circle', construction: false, centerPointId: 'right', radius: 5 },
      ...(hole ? [{ id: 'hole-circle', kind: 'circle' as const, construction: false, centerPointId: 'hole-center', radius: 1 }] : [])], relations: []
  } };
}
export function dividedRectangleSketch(): CadSketchFeature {
  return { id: 'divided', kind: 'sketch', name: 'Divided rectangle', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
    points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [10, 0] }, { id: 'c', position: [10, 10] }, { id: 'd', position: [0, 10] },
      { id: 'e', position: [5, -2] }, { id: 'f', position: [5, 12] }],
    entities: [['ab', 'a', 'b'], ['bc', 'b', 'c'], ['cd', 'c', 'd'], ['da', 'd', 'a'], ['divider', 'e', 'f']].map(([id, startPointId, endPointId]) => ({ id, kind: 'line', construction: false, startPointId, endPointId })), relations: []
  } };
}
export function graphCellSelectionAt(sketch: CadSketchFeature, parameters: Readonly<Record<string, number>>, points: readonly (readonly [number, number])[]): CadSketchGraphCellSelection {
  const catalog = prepareCadSketchCells(sketch, parameters, 'graph-cells');
  const ids = points.map(([x, y]) => {
    const cell = catalog.pick({ x, y }); if (!cell) throw new Error('Fixture point has no bounded graph cell'); return cell.id;
  });
  const selection = catalog.pack(ids); if (!('kind' in selection)) throw new Error('Expected graph cell selection'); return selection;
}
