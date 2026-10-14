// @vitest-environment node
import { expect, it } from 'vitest';
import { cadEntitiesToCam } from '../cadCam';
import { isCadSectionResult } from '../cadSection';
import type { DxfLineEntity } from '../../dxf/types';

function outline(): DxfLineEntity[] {
  const points = Array.from({ length: 8193 }, (_, i) => ({ x: 100 * Math.cos(2 * Math.PI * i / 8193), y: 100 * Math.sin(2 * Math.PI * i / 8193) }));
  return points.map((start, i) => ({ type: 'line', layer: 'CAD_SECTION', start, end: points[(i + 1) % points.length] }));
}

it('accepts a complete exact section above the former edge cap while rejecting corrupt tail coordinates', () => {
  const entities = outline(), section = { bodyId: 'body', plane: 'XY', offset: 5, entities, contourCount: 1 };
  expect(isCadSectionResult(section)).toBe(true);
  entities[entities.length - 1].end = { x: NaN, y: 0 };
  expect(isCadSectionResult(section)).toBe(false);
});

it('preserves every analytic edge of a closed large section through the shared handoff geometry', () => {
  const entities = outline(), original = JSON.stringify(entities), result = cadEntitiesToCam(entities);
  expect(result.segments).toHaveLength(8193);
  expect(result.contours).toHaveLength(1);
  expect(result.contours[0].closed).toBe(true);
  expect(result.segments.every(segment => segment.kind === 'line')).toBe(true);
  expect(JSON.stringify(entities)).toBe(original);
});
