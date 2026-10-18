import { describe, expect, it } from 'vitest';
import { buildEditorPathDocumentPreviewGeometry } from '@/domain/editor/previewGeometry';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { readPathEndpointHandles } from '../editorPreviewEndpoints';

function partialLine() {
  const source = createPathPlanningDocumentFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  const document = setMachiningSpanParticipation(source, {
    sourceSegmentId: source.segments[0].id, range: { start: 0, end: 0.4 }, participation: 'inactive-reference'
  });
  if (!document) throw new Error('Expected partial line');
  return document;
}

describe('original source endpoint handles', () => {
  it('uses original oriented endpoints for all displayed fragments, preserving first source/ref/operation matches', () => {
    const document = partialLine();
    const [operation] = document.plan.operations;
    operation.segmentRefs[0].reversed = true;
    const paths = buildEditorPathDocumentPreviewGeometry(document).paths;
    document.segments.push({ ...document.segments[0], start: { x: 100, y: 100 }, end: { x: 200, y: 200 } });
    operation.segmentRefs.push({ ...operation.segmentRefs[0], reversed: false });
    document.plan.operations.push({ ...operation, segmentRefs: [{ ...operation.segmentRefs[0], reversed: false }] });
    const original = structuredClone(document);
    const handles = readPathEndpointHandles(paths, document);
    expect(handles).toEqual([
      { operationId: operation.id, pathElementId: document.pathElements[0].id, segmentId: document.segments[0].id, role: 'start', point: { x: 10, y: 0 } },
      { operationId: operation.id, pathElementId: document.pathElements[0].id, segmentId: document.segments[0].id, role: 'end', point: { x: 0, y: 0 } }
    ]);
    expect(document).toEqual(original);
  });

  it('omits clipped handles with missing source ownership and leaves unclipped and external paths usable', () => {
    const document = partialLine();
    const paths = buildEditorPathDocumentPreviewGeometry(document).paths;
    expect(readPathEndpointHandles(paths, null)).toEqual([]);
    document.plan.operations[0].segmentRefs = [];
    expect(readPathEndpointHandles(paths, document)).toEqual([]);
    const path = paths.find(path => path.segmentId);
    if (!path) throw new Error('Expected segment path');
    expect(readPathEndpointHandles([{ ...path, clippedSourceSegment: false }, { ...path, source: 'gcode' }], null)
      .map(({ point }) => point)).toEqual([path.start, path.end]);
  });

  it('collapses a circular source to its original seam even when both display arcs are clipped', () => {
    const source = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    const document = setMachiningSpanParticipation(source, {
      sourceSegmentId: source.segments[0].id, range: { start: 0.1, end: 0.4 }, participation: 'inactive-reference'
    });
    if (!document) throw new Error('Expected partial circle');
    const handles = readPathEndpointHandles(buildEditorPathDocumentPreviewGeometry(document).paths, document);
    expect(handles).toHaveLength(1);
    expect(handles[0]).toMatchObject({ role: 'start', segmentId: source.segments[0].id, point: source.segments[0].start });
  });

  it('prepares many clipped sources with bounded source and reference reads', () => {
    const count = 1000;
    const document = createPathPlanningDocumentFromDxfEntities([{ type: 'lwpolyline', layer: 'CUT', closed: true,
      vertices: Array.from({ length: count }, (_, index) => ({
        x: 100 * Math.cos(2 * Math.PI * index / count), y: 100 * Math.sin(2 * Math.PI * index / count), bulge: 0 })) }]);
    document.machiningParticipation = { spans: document.segments.map((segment, index) => ({
      id: `reference-${index}`, sourceSegmentId: segment.id, participation: 'inactive-reference', range: { start: 0, end: 0.25 }
    })) };
    const paths = buildEditorPathDocumentPreviewGeometry(document).paths;
    let reads = 0;
    for (const segment of document.segments) {
      const id = segment.id;
      Object.defineProperty(segment, 'id', { get: () => { reads++; return id; } });
    }
    for (const ref of document.plan.operations[0].segmentRefs) {
      const id = ref.segmentId;
      Object.defineProperty(ref, 'segmentId', { get: () => { reads++; return id; } });
    }
    const handles = readPathEndpointHandles(paths, document);
    expect(handles).toHaveLength(count * 2);
    expect(reads).toBeLessThan(count * 10);
  });
});
