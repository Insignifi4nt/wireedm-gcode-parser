import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { cadEntitiesToCam } from '../cadCam';

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return { type: 'line', layer: 'CUT', start: { x: startX, y: startY }, end: { x: endX, y: endY } };
}

/** A unit square at the origin whose closing line stops `gap` millimetres above its start. */
function squareWithClosingGap(gap: number): DxfEntity[] {
  return [line(0, 0, 1, 0), line(1, 0, 1, 1), line(1, 1, 0, 1), line(0, 1, 0, gap)];
}

describe('CAD to CAM handoff endpoint join', () => {
  it('joins a closing end 5e-8 mm from its start into a closed contour', () => {
    const document = cadEntitiesToCam(squareWithClosingGap(5e-8));

    expect(document.contours).toEqual([expect.objectContaining({ closed: true })]);
    expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'endpoint-cluster-snap' }));
  });

  it('refuses a closing end 3e-7 mm from its start as an open contour', () => {
    expect(() => cadEntitiesToCam(squareWithClosingGap(3e-7))).toThrow(expect.objectContaining({ code: 'cam-geometry' }));
  });
});

describe('CAD to CAM handoff coincidence', () => {
  it('treats ends 5e-10 mm apart as one exact point without a snap warning', () => {
    const document = cadEntitiesToCam(squareWithClosingGap(5e-10));

    expect(document.endpointClusters.map(cluster => cluster.method)).toEqual(['exact', 'exact', 'exact', 'exact']);
    expect(document.diagnostics.map(diagnostic => diagnostic.code)).not.toContain('endpoint-cluster-snap');
  });

  it('snaps ends 3e-9 mm apart within the endpoint tolerance and warns about it', () => {
    const document = cadEntitiesToCam(squareWithClosingGap(3e-9));

    expect(document.endpointClusters.filter(cluster => cluster.method === 'within-tolerance')).toHaveLength(1);
    expect(document.diagnostics).toContainEqual(expect.objectContaining({ code: 'endpoint-cluster-snap' }));
    expect(document.contours).toEqual([expect.objectContaining({ closed: true })]);
  });
});
