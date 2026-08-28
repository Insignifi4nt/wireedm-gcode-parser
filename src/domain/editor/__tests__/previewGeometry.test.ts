import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import { parseGCodeProgram } from '../gcodeParser';
import {
  buildEditorPathDocumentPreviewGeometry,
  buildEditorPreviewGeometry,
  fitViewBoxToViewportAspect
} from '../previewGeometry';

describe('editor preview geometry', () => {
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

  it('renders supplied artifact transition traces without inventing controller behavior', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(5, 0, 15, 0),
      line(15, 0, 15, 5),
      line(15, 5, 5, 5),
      line(5, 5, 5, 0)
    ]);
    const operationId = document.plan.operations[0].id;

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      postedTransitions: [{
        kind: 'lead-in',
        operationId,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 5, y: 0 },
        programLineNumber: 6
      }]
    });

    expect(preview.paths.filter(({ travelSource }) => travelSource === 'posted')).toEqual([
      expect.objectContaining({
        line: 6,
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        travelRole: 'lead-in',
        type: 'cut'
      })
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
