import type { CadDocument, CadFeature, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import type { CadSketchCellReference } from '../cadSketchRegionSelection';

export type CellReference = CadSketchCellReference;
export const refs = {
  outer: { boundaryProfileId: 'outer', voidProfileIds: ['bore'], ancestorProfileIds: [] },
  bore: { boundaryProfileId: 'bore', voidProfileIds: ['island'], ancestorProfileIds: ['outer'] },
  island: { boundaryProfileId: 'island', voidProfileIds: [], ancestorProfileIds: ['outer', 'bore'] },
  separate: { boundaryProfileId: 'separate', voidProfileIds: [], ancestorProfileIds: [] },
} satisfies Record<string, CellReference>;
export const dxf = '\uFEFF0\r\nSECTION\r\n2\r\nENTITIES\r\n0\r\nCIRCLE\r\n8\r\n0\r\n10\r\n0\r\n20\r\n0\r\n40\r\n10\r\n0\r\nCIRCLE\r\n8\r\n0\r\n10\r\n0\r\n20\r\n0\r\n40\r\n6\r\n0\r\nENDSEC\r\n0\r\nEOF\r\n';
const circle = (id: string, radius: number, x = 0): CadSketchProfile => ({ id, name: id, construction: false,
  geometry: { kind: 'circle', x, y: 0, radius } });
export function sketch(island = true): CadSketchFeature {
  return { id: 'regions', name: 'Regions', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false,
    source: { format: 'dxf', fileName: 'exact-regions.dxf', text: dxf, units: 'mm' },
    profiles: [circle('outer', 10), circle('bore', 6), ...(island ? [circle('island', 2)] : []), circle('separate', 3, 30)] };
}
export function part(features: readonly CadFeature[], parameters: CadDocument['parameters'] = {}): CadDocument {
  return { format: 'wireedm-cad', schemaVersion: 1, id: 'cell_part', name: 'Cell part', units: 'mm', parameters, features };
}
export function pad(regionSelection?: readonly CellReference[]) {
  return { id: 'pad', name: 'Pad', kind: 'extrude' as const, sketchId: 'regions', distance: 5, symmetric: false,
    operation: 'new' as const, targetId: null, suppressed: false, ...(regionSelection === undefined ? {} : { regionSelection }) };
}
export function stock(): readonly CadFeature[] {
  return [{ id: 'stock_sketch', name: 'Stock sketch', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'stock_boundary', name: 'Stock boundary', construction: false,
      geometry: { kind: 'rectangle', x: -15, y: -15, width: 60, height: 30, cornerRadius: 0 } }] },
    { id: 'stock', name: 'Stock', kind: 'extrude', suppressed: false, sketchId: 'stock_sketch',
      distance: 10, symmetric: false, operation: 'new', targetId: null }];
}
export function pocket(regionSelection?: readonly CellReference[]) {
  return { id: 'pocket', name: 'Pocket', kind: 'pocket' as const, sketchId: 'regions', targetId: 'stock', suppressed: false,
    extent: { kind: 'through-all' as const, direction: 'both' as const }, ...(regionSelection === undefined ? {} : { regionSelection }) };
}
