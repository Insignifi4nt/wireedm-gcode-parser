import { describe, expect, it } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { setPathOperationClassification } from '@/domain/path-editor/pathDocumentOperations';
import type { DxfEntity } from '@/domain/dxf/types';
import { classifyPositioningMaterial } from '../positioningMaterial';

describe('positioning material', () => {
  const document = createUpidFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 70.5 }
  ]);
  document.geometryBasis = 'finished-contour';

  it('finds the solid annulus between a cut hole and exterior approach', () => {
    expect(classifyPositioningMaterial(document, { x: 0, y: 0 }, { x: 0, y: 72.5 }))
      .toMatchObject({ status: 'crosses-finished-material', materialLengthMm: 65.5 });
  });

  it('does not assume the hole slug has left the stock', () => {
    expect(classifyPositioningMaterial(document, { x: 0, y: 0 }, { x: 0, y: 3 }))
      .toEqual({ status: 'unknown' });
  });

  it('uses reviewed contour roles and leaves inactive reference boundaries unclaimed', () => {
    const hole = document.plan.operations.find((operation) => operation.classification === 'hole');
    if (!hole) throw new Error('Expected hole');
    const overridden = setPathOperationClassification(document, hole.id, 'island');
    if (!overridden) throw new Error('Expected classification override');
    expect(classifyPositioningMaterial(overridden, { x: 0, y: 0 }, { x: 0, y: 3 }).status)
      .toBe('crosses-finished-material');

    const partial = structuredClone(document);
    partial.machiningParticipation = { spans: [{ id: 'inactive',
      sourceSegmentId: partial.segments.find((segment) => segment.kind === 'circle' && segment.radius === 70.5)!.id,
      range: { start: 0, end: 1 }, participation: 'inactive-reference' }] };
    expect(classifyPositioningMaterial(partial, { x: 6, y: 0 }, { x: 8, y: 0 }))
      .toEqual({ status: 'unknown' });
  });

  it('keeps outside travel unknown because finished geometry does not describe stock', () => {
    expect(classifyPositioningMaterial(document, { x: 72, y: 0 }, { x: 73, y: 0 }))
      .toEqual({ status: 'unknown' });
  });

  it('classifies a thin route inside an exact circle beyond the polygon chord', () => {
    const circle = createUpidFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 100 }
    ]);
    const polygon = circle.contours[0].approximatePolygon;
    const angle = (Math.atan2(polygon[0].y, polygon[0].x) +
      Math.atan2(polygon[1].y, polygon[1].x)) / 2;
    const middle = { x: 99.9999 * Math.cos(angle), y: 99.9999 * Math.sin(angle) };
    const from = { x: middle.x - 0.001 * Math.sin(angle), y: middle.y + 0.001 * Math.cos(angle) };
    const to = { x: middle.x + 0.001 * Math.sin(angle), y: middle.y - 0.001 * Math.cos(angle) };
    const result = classifyPositioningMaterial(circle, from, to);
    expect(result.status).toBe('crosses-finished-material');
    if (result.status === 'crosses-finished-material') expect(result.materialLengthMm).toBeCloseTo(0.002, 9);
  });

  it.each(['coupled', 'flat', 'reordered', 'mirrored'] as const)(
    'uses source nesting with %s depth, area and hierarchy caches', (kind) => {
      const source = createUpidFromDxfEntities([10, 5, 2].map((radius) => ({
        type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius
      })));
      const original = structuredClone(source);
      const hole = source.contours.find((contour) => contour.classification === 'hole');
      const island = source.contours.find((contour) => contour.classification === 'island');
      const exterior = source.contours.find((contour) => contour.classification === 'exterior');
      if (!hole || !island || !exterior) throw new Error('Expected nested source regions.');
      if (kind === 'flat' || kind === 'reordered') {
        for (const contour of source.contours) {
          contour.parentId = null;
          contour.childIds = [];
          contour.containmentDepth = 0;
          contour.area = 1;
        }
        if (kind === 'reordered') source.contours = [hole, island, exterior];
      } else {
        hole.parentId = island.id;
        hole.childIds = [];
        hole.containmentDepth = 2;
        hole.area = 1;
        island.parentId = exterior.id;
        island.childIds = [hole.id];
        island.containmentDepth = 1;
        island.area = 10_000;
        exterior.childIds = [island.id];
        if (kind === 'mirrored') source.contours.reverse();
      }
      const before = structuredClone(source);
      for (const [from, to] of [
        [{ x: -1, y: 0 }, { x: 1, y: 0 }],
        [{ x: 3, y: 0 }, { x: 4, y: 0 }]
      ]) {
        expect(classifyPositioningMaterial(source, from, to))
          .toEqual(classifyPositioningMaterial(original, from, to));
      }
      expect(source).toEqual(before);
    }
  );

  it.each(['line', 'arc', 'circle'] as const)(
    'keeps nested %s material classification stable at large translated coordinates', (kind) => {
      for (const offset of [0, 1e9, 1e12]) {
        const entities = [10, 5, 2].flatMap((radius): DxfEntity[] => {
          const point = (x: number, y: number) => ({ x: x + offset, y: y + offset });
          if (kind === 'circle') return [{ type: 'circle', layer: 'CUT', center: point(0, 0), radius }];
          if (kind === 'arc') return [{
            type: 'arc', layer: 'CUT', center: point(0, 0), radius,
            start: point(radius, 0), end: point(radius, 0),
            startAngle: 0, endAngle: 360, sweepRadians: Math.PI * 2, clockwise: false
          }];
          const vertices = [point(-radius, -radius), point(radius, -radius), point(radius, radius), point(-radius, radius)];
          return vertices.map((start, index) => ({
            type: 'line', layer: 'CUT', start, end: vertices[(index + 1) % vertices.length]
          }));
        });
        const source = createUpidFromDxfEntities(entities);
        const material = classifyPositioningMaterial(source,
          { x: offset - 1, y: offset }, { x: offset + 1, y: offset });
        expect(material).toEqual({ status: 'crosses-finished-material', materialLengthMm: 2 });
        expect(classifyPositioningMaterial(source,
          { x: offset + 3, y: offset }, { x: offset + 4, y: offset }))
          .toEqual({ status: 'unknown' });
      }
    }
  );

  it.each(['near-zero', 'near-equal'] as const)(
    'preserves source order when %s areas do not establish a deeper region', (kind) => {
      const innerRadius = kind === 'near-zero' ? 0.0001 : 0.001;
      const outerRadius = innerRadius + 0.0001;
      let source = createUpidFromDxfEntities([outerRadius, innerRadius].map((radius) => ({
        type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius
      })));
      const outer = source.plan.operations.find((operation) => operation.contourId === source.contours[0].id);
      const inner = source.plan.operations.find((operation) => operation.contourId === source.contours[1].id);
      if (!outer || !inner) throw new Error('Expected near-area source contours.');
      const withOuterRole = setPathOperationClassification(source, outer.id, 'island');
      if (!withOuterRole) throw new Error('Expected reviewed outer role.');
      const withInnerRole = setPathOperationClassification(withOuterRole, inner.id, 'hole');
      if (!withInnerRole) throw new Error('Expected reviewed inner role.');
      source = withInnerRole;
      const from = { x: -innerRadius / 2, y: 0 }, to = { x: innerRadius / 2, y: 0 };
      expect(classifyPositioningMaterial(source, from, to))
        .toEqual({ status: 'crosses-finished-material', materialLengthMm: innerRadius });
    }
  );

  it('counts every source container when near-equal areas make nesting nontransitive', () => {
    const source = createUpidFromDxfEntities([0.000034, 0.00004, 0.000028].map((area) => ({
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: Math.sqrt(area / Math.PI)
    })));
    expect(source.diagnostics).toEqual([]);
    expect(source.contours.map((contour) => contour.containmentDepth)).toEqual([0, 0, 1]);
    expect(classifyPositioningMaterial(source, { x: -0.001, y: 0 }, { x: 0.001, y: 0 }))
      .toEqual({ status: 'unknown' });
  });

  it('preserves a reviewed island with nontransitive containing areas', () => {
    let source = createUpidFromDxfEntities([0.000034, 0.00004, 0.000028].map((area) => ({
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: Math.sqrt(area / Math.PI)
    })));
    const medium = source.plan.operations.find((operation) => operation.contourId === source.contours[0].id);
    const inner = source.plan.operations.find((operation) => operation.contourId === source.contours[2].id);
    if (!medium || !inner) throw new Error('Expected nested near-area contours.');
    const reviewedMedium = setPathOperationClassification(source, medium.id, 'hole');
    if (!reviewedMedium) throw new Error('Expected reviewed hole.');
    const reviewedInner = setPathOperationClassification(reviewedMedium, inner.id, 'island');
    if (!reviewedInner) throw new Error('Expected reviewed island.');
    source = reviewedInner;
    expect(classifyPositioningMaterial(source, { x: -0.001, y: 0 }, { x: 0.001, y: 0 }))
      .toEqual({ status: 'crosses-finished-material', materialLengthMm: 0.002 });
    const inactiveOuter = structuredClone(source);
    const outerChain = source.chains.find((chain) => chain.id === source.contours[1].chainId);
    if (!outerChain) throw new Error('Expected outer source boundary.');
    inactiveOuter.machiningParticipation = { spans: outerChain.segmentRefs.map(({ segmentId }) => ({
      id: `inactive-${segmentId}`, sourceSegmentId: segmentId,
      range: { start: 0, end: 1 }, participation: 'inactive-reference'
    })) };
    expect(classifyPositioningMaterial(inactiveOuter, { x: -0.001, y: 0 }, { x: 0.001, y: 0 }))
      .toEqual({ status: 'crosses-finished-material', materialLengthMm: 0.002 });
    const outerOperation = source.plan.operations.find((operation) => operation.contourId === source.contours[1].id);
    if (!outerOperation) throw new Error('Expected outer operation.');
    const ambiguousOuter = setPathOperationClassification(source, outerOperation.id, 'ambiguous');
    if (!ambiguousOuter) throw new Error('Expected unclaimed outer material role.');
    expect(classifyPositioningMaterial(ambiguousOuter, { x: -0.001, y: 0 }, { x: 0.001, y: 0 }))
      .toEqual({ status: 'crosses-finished-material', materialLengthMm: 0.002 });
  });
});
