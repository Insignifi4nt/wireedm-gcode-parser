import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import { parseGCodeProgram } from '../gcodeParser';
import {
  buildEditorPathDocumentPreviewGeometry,
  buildEditorPreviewGeometry,
  fitViewBoxToViewportAspect
} from '../previewGeometry';

describe('editor preview geometry', () => {
  it('maps a clipped cut to its source selection and exact machining span', () => {
    const source = createPathPlanningDocumentFromDxfEntities([line(0, 0, 10, 0)]);
    const segmentId = source.segments[0].id;
    const document = setMachiningSpanParticipation(source, {
      sourceSegmentId: segmentId, range: { start: 0, end: 0.4 }, participation: 'inactive-reference'
    })!;
    const paths = buildEditorPathDocumentPreviewGeometry(document).paths;
    const cut = paths.find((path) => path.participation === 'active-cut');
    expect(cut).toMatchObject({
      operationId: source.plan.operations[0].id,
      pathElementId: source.pathElements[0].id,
      segmentId, clippedSourceSegment: true,
      machiningSpanId: expect.any(String)
    });
    expect([cut!.start.x, cut!.end.x].sort((a, b) => a - b)).toEqual([4, 10]);
    expect(paths.find((path) => path.participation === 'inactive-reference')).toMatchObject({
      segmentId, start: { x: 0, y: 0 }, end: { x: 10, y: 0 }
    });
  });
  it('turns parsed machine-program motion into paths and endpoint markers', () => {
    const preview = buildEditorPreviewGeometry(
      parseGCodeProgram(['G0 X0 Y0', 'G1 X10 Y0', 'G3 X20 Y10 I0 J10'].join('\n')),
      { padding: 2 }
    );

    expect(preview.paths.map(({ type, line }) => ({ type, line }))).toEqual([
      { type: 'rapid', line: 1 },
      { type: 'cut', line: 2 },
      { type: 'arc', line: 3 }
    ]);
    expect(preview.markers).toEqual([
      { type: 'start', x: 0, y: 0, label: 'START' },
      { type: 'end', x: 20, y: 10, label: 'END' }
    ]);
    expect(preview.viewBox).toEqual({ minX: -2, minY: -2, width: 24, height: 14 });
  });

  it('returns an explicit empty viewport when a program has no drawable motion', () => {
    expect(buildEditorPreviewGeometry(parseGCodeProgram('G90\nM30'))).toEqual({
      paths: [],
      markers: [],
      viewBox: { minX: -1, minY: -1, width: 2, height: 2 }
    });
  });

  it('previews neutral UPID geometry without posting it', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      lineHints: [4, 5, 6, 7, 8],
      padding: 1
    });

    expect(preview.paths).toHaveLength(5);
    expect(preview.paths[0]).toMatchObject({
      type: 'rapid',
      travelRole: 'rapid-in',
      travelSource: 'planned',
      source: 'path-document',
      line: 4
    });
    expect(preview.paths.slice(1).every(({ source }) => source === 'path-document')).toBe(true);
    expect(preview.viewBox).toEqual({ minX: -1, minY: -1, width: 12, height: 7 });
  });

  it('previews reviewed initial positioning, authored exits and the following connection', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0), line(20, 0, 30, 0)
    ]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: { x: -5, y: 0 }, review: 'reviewed' }
    };
    document.plan.operations[0].transitions = {
      exit: { strategy: 'manual-straight', from: { x: 10, y: 0 }, to: { x: 15, y: 5 }, move: 'cut', review: 'reviewed' }
    };
    document.plan.operations[1].transitions = {
      exit: { strategy: 'manual-straight', from: { x: 30, y: 0 }, to: { x: 35, y: 5 }, move: 'cut', review: 'reviewed' }
    };

    const preview = buildEditorPathDocumentPreviewGeometry(document);

    expect(preview.paths.filter(({ travelRole }) => travelRole).map(({ travelRole, start, end }) => ({ travelRole, start, end }))).toEqual([
      { travelRole: 'rapid-in', start: { x: -5, y: 0 }, end: { x: 0, y: 0 } },
      { travelRole: 'lead-out', start: { x: 10, y: 0 }, end: { x: 15, y: 5 } },
      { travelRole: 'rapid-in', start: { x: 15, y: 5 }, end: { x: 20, y: 0 } },
      { travelRole: 'lead-out', start: { x: 30, y: 0 }, end: { x: 35, y: 5 } }
    ]);
    expect(preview.viewBox).toEqual({ minX: -6, minY: -1, width: 42, height: 7 });
    expect(preview.markers).toEqual([
      { type: 'start', x: -5, y: 0, label: 'START' },
      { type: 'end', x: 35, y: 5, label: 'END' }
    ]);
  });

  it('fits a view box to the viewport aspect ratio without clipping geometry', () => {
    expect(fitViewBoxToViewportAspect(
      { minX: 0, minY: 0, width: 10, height: 5 },
      10,
      10
    )).toEqual({ minX: 0, minY: -2.5, width: 10, height: 10 });
  });
});

function line(startX: number, startY: number, endX: number, endY: number) {
  return {
    type: 'line' as const,
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
