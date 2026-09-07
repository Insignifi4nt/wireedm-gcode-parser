import { describe, expect, it } from 'vitest';
import { createArcSegment, createCircleSegment, createLineSegment } from '@/domain/path-intel/segments';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { buildEditorPathDocumentPreviewGeometry, type EditorPreviewPath } from '../previewGeometry';
import { previewSelectionCandidates, segmentIntersectsSelectionRect } from '../previewSelection';

const source = { sourceEntityIndex: 0, sourceEntityType: 'line', layer: null, exact: true };
const circle = createCircleSegment({ id: 'circle', source, center: { x: 0, y: 0 }, radius: 5 });
const line = createLineSegment({ id: 'line', source, start: { x: -10, y: 0 }, end: { x: 10, y: 0 } });

describe('exact preview selection', () => {
  it('excludes empty circle/arc interiors and diagonal bounding-box false positives', () => {
    const rect = { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    expect(segmentIntersectsSelectionRect(circle, rect)).toBe(false);
    expect(segmentIntersectsSelectionRect(line, rect)).toBe(true);
    const quarter = createArcSegment({ id: 'arc', source, center: { x: 0, y: 0 }, start: { x: 5, y: 0 }, end: { x: 0, y: 5 }, clockwise: false });
    expect(segmentIntersectsSelectionRect(quarter, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBe(false);
    const diagonal = createLineSegment({ id: 'diagonal', source, start: { x: 0, y: 0 }, end: { x: 10, y: 10 } });
    expect(segmentIntersectsSelectionRect(diagonal, { minX: 1, maxX: 2, minY: 8, maxY: 9 })).toBe(false);
  });

  it('includes tangency, crossings, enclosed curves, and reversed arc sweeps', () => {
    expect(segmentIntersectsSelectionRect(circle, { minX: 5, maxX: 6, minY: -1, maxY: 1 })).toBe(true);
    expect(segmentIntersectsSelectionRect(circle, { minX: -6, maxX: 6, minY: -6, maxY: 6 })).toBe(true);
    expect(segmentIntersectsSelectionRect(line, { minX: 0, maxX: 1, minY: -1, maxY: 1 })).toBe(true);
    for (const clockwise of [true, false]) {
      const start = { x: 5, y: 0 }, end = { x: 0, y: 5 };
      const arc = createArcSegment({ id: 'arc', source, center: { x: 0, y: 0 }, start: clockwise ? end : start, end: clockwise ? start : end, clockwise });
      expect(segmentIntersectsSelectionRect(arc, { minX: 3, maxX: 4, minY: 3, maxY: 4 })).toBe(true);
    }
  });

  it('returns exact nearby features in display order and honors source-kind filters', () => {
    const paths: EditorPreviewPath[] = [line, circle].map((segment, index) => ({
      source: 'path-document', type: segment.kind === 'line' ? 'cut' : 'arc',
      operationId: `operation-${index}`, segmentId: segment.id,
      bounds: segment.bounds, start: segment.start, end: segment.end,
      selectionGeometry: segment, line: index, d: ''
    }));
    expect(previewSelectionCandidates(paths, { x: 5, y: 0 }, 0.01).map(({ segmentId }) => segmentId)).toEqual(['circle', 'line']);
    expect(previewSelectionCandidates(paths, { x: 5, y: 0 }, 0.01, 'line').map(({ segmentId }) => segmentId)).toEqual(['line']);
    expect(previewSelectionCandidates(paths, { x: 0, y: 0 }, 0.01, 'circle')).toEqual([]);
    expect(previewSelectionCandidates(paths, { x: 0, y: 0.2 }, 0.1, 'line')).toEqual([]);
    expect(previewSelectionCandidates(paths, { x: 0, y: 0.2 }, 0.3, 'line')).toHaveLength(1);
    const circleDocument = createPathPlanningDocumentFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
    expect(previewSelectionCandidates(buildEditorPathDocumentPreviewGeometry(circleDocument).paths, { x: 5, y: 0 }, 0.01)).toHaveLength(1);
  });

  it('picks only real inactive ranges and preserves the active span/source identity', () => {
    const document = createPathPlanningDocumentFromDxfEntities([{ type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }]);
    const segmentId = document.segments[0].id;
    const partial = setMachiningSpanParticipation(document, { sourceSegmentId: segmentId, range: { start: 0, end: 0.4 }, participation: 'inactive-reference' });
    if (!partial) throw new Error('Invalid fixture');
    const paths = buildEditorPathDocumentPreviewGeometry(partial).paths;
    expect(previewSelectionCandidates(paths, { x: 6, y: 0 }, 0.01, 'reference')).toEqual([]);
    expect(previewSelectionCandidates(paths, { x: 2, y: 0 }, 0.01, 'active')).toEqual([]);
    const active = previewSelectionCandidates(paths, { x: 6, y: 0 }, 0.01);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ segmentId, machiningSpanId: expect.any(String), participation: 'active-cut' });
    const reference = previewSelectionCandidates(paths, { x: 2, y: 0 }, 0.01, 'reference');
    expect(reference).toHaveLength(1);
    expect(reference[0]).toMatchObject({ segmentId, machiningSpanId: expect.any(String), participation: 'inactive-reference' });
  });
});
