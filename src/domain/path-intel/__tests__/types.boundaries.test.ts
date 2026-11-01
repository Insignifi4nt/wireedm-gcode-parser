import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '../fromDxfEntities';

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return { type: 'line', layer: 'CUT', start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

/** A unit square at the origin whose closing line stops `gap` millimetres above its start. */
function squareWithClosingGap(gap: number): DxfEntity[] {
  return [line(0, 0, 1, 0), line(1, 0, 1, 1), line(1, 1, 0, 1), line(0, 1, 0, gap)];
}

describe('default planning endpoint tolerance', () => {
  it('closes an imported contour whose ends are 0.0004 mm apart when no tolerance is given', () => {
    const document = createPathPlanningDocumentFromDxfEntities(squareWithClosingGap(0.0004));

    expect(document.contours).toEqual([expect.objectContaining({ closed: true })]);
    expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'endpoint-cluster-snap' }));
  });

  it('leaves an imported contour whose ends are 0.003 mm apart open when no tolerance is given', () => {
    const document = createPathPlanningDocumentFromDxfEntities(squareWithClosingGap(0.003));

    expect(document.contours).toEqual([expect.objectContaining({ closed: false, classification: 'open-chain' })]);
    expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'open-chain' }));
  });
});
