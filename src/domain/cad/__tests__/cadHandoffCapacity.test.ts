// @vitest-environment node
import { expect, it } from 'vitest';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { cadSketchToCam } from '../cadCam';

it('hands a complete accepted dense polygon to CAM with every source identity, exact contour and one ordered operation', () => {
  const count = 131072, radius = 10, points = Array.from({ length: count }, (_, index): readonly [number, number] =>
    [radius * Math.cos(index * 2 * Math.PI / count), radius * Math.sin(index * 2 * Math.PI / count)]);
  const document = parseCadDocument({ ...createCadDocument('Dense handoff', 'dense_handoff'), features: [
    { id: 'outline', kind: 'sketch', name: 'Outline', plane: 'XY', offset: 0, suppressed: false,
      profiles: [{ id: 'polygon', name: 'Polygon', construction: false, geometry: { kind: 'polygon', points } }] },
  ] }), original = JSON.stringify(document), cam = cadSketchToCam(document, 'outline');
  expect(cam.segments).toHaveLength(count); expect(cam.contours).toHaveLength(1); expect(cam.plan.operations).toHaveLength(1);
  expect(cam.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(false);
  expect(cam.segments.every((segment, index) => segment.kind === 'line' && segment.source.sourceEntityIndex === index && segment.source.exact
    && segment.start.x === points[index][0] && segment.start.y === points[index][1]
    && segment.end.x === points[(index + 1) % count][0] && segment.end.y === points[(index + 1) % count][1])).toBe(true);
  const contour = cam.contours[0], operation = cam.plan.operations[0];
  expect(contour.closed).toBe(true); expect(contour.provenance.sourceEntityIndices).toHaveLength(count);
  expect(contour.provenance.sourceEntityIndices.every((value, index) => value === index)).toBe(true);
  expect(operation.provenance).toEqual(contour.provenance); expect(operation.contourId).toBe(contour.id); expect(operation.orderIndex).toBe(0);
  expect(operation.metrics.segmentCount).toBe(count); expect(operation.segmentRefs).toHaveLength(count);
  expect(operation.metrics.cutLength).toBeCloseTo(count * 2 * radius * Math.sin(Math.PI / count), 7);
  expect(contour.area).toBeCloseTo(count * radius ** 2 * Math.sin(2 * Math.PI / count) / 2, 7);
  expect(JSON.stringify(document)).toBe(original);
}, 30_000);
