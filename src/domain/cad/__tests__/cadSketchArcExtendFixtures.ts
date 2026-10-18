import type { CadDocument } from '../cadDocument';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { inspectCadSketchRegions } from '../cadSketchRegionInspection';
import type { CadSketchExtendTarget } from '../cadSketchTrimExtend';

export function arcExtendPart(interior = false) {
  return parseCadDocument({ ...createCadDocument('Arc extension', 'arc-extension'), schemaVersion: 2, parameters: { retained: 7 }, features: [{
    id: 'sketch', name: 'Circular segment', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'o', position: ['0.000', ' 0 '] }, { id: 'a', position: ['10.000', ' 0 '] }, { id: 'b', position: [0, 10] },
        ...(interior ? [{ id: 'low', position: ['-6.000', '0.000'] }, { id: 'high', position: ['-6.000', '12.000'] }]
          : [{ id: 'c', position: [-6, 8] }])],
      entities: [{ id: 'arc', kind: 'arc', centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false },
        { id: 'divider', kind: 'line', startPointId: 'b', endPointId: 'a', construction: false },
        interior ? { id: 'cutter', kind: 'line', startPointId: 'low', endPointId: 'high', construction: true }
          : { id: 'closure', kind: 'line', startPointId: 'c', endPointId: 'a', construction: false }], relations: []
    }
  }] });
}

export function arcExtendTarget(document: CadDocument): CadSketchExtendTarget {
  const preview = inspectCadSketchRegions(document, 'sketch', { mode: 'graph-cells', extendAt: { entityId: 'arc', end: 'end' } }).extendPreview;
  if (!preview) throw new Error('Arc extension query missing.');
  return { ...preview.target, endPointId: preview.target.boundary.endpointPointId ?? 'contact' };
}

export const quarterSegmentAreaMm2 = 50 * (Math.PI / 2 - 1);
export const extendedSegmentAreaMm2 = 50 * (Math.atan2(8, -6) - .8);
