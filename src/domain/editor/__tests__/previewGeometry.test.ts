import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import { parseGCodeProgram } from '../gcodeParser';
import {
  buildEditorPathDocumentPreviewGeometry,
  buildEditorPreviewGeometry,
  fitViewBoxToViewportAspect
} from '../previewGeometry';

describe('buildEditorPreviewGeometry', () => {
  it('turns parsed rapid, cut, and arc moves into preview paths with padded bounds', () => {
    const parseResult = parseGCodeProgram(
      ['G0 X0 Y0', 'G1 X10 Y0', 'G3 X20 Y10 I0 J10'].join('\n')
    );

    const preview = buildEditorPreviewGeometry(parseResult, {
      padding: 2
    });

    expect(preview.viewBox).toEqual({
      minX: -2,
      minY: -2,
      width: 24,
      height: 14
    });
    expect(preview.paths).toEqual([
      {
        type: 'rapid',
        bounds: {
          maxX: 0,
          maxY: 0,
          minX: 0,
          minY: 0
        },
        d: 'M 0 0 L 0 0',
        start: {
          x: 0,
          y: 0
        },
        end: {
          x: 0,
          y: 0
        },
        line: 1,
        source: 'gcode'
      },
      {
        type: 'cut',
        bounds: {
          maxX: 10,
          maxY: 0,
          minX: 0,
          minY: 0
        },
        d: 'M 0 0 L 10 0',
        start: {
          x: 0,
          y: 0
        },
        end: {
          x: 10,
          y: 0
        },
        line: 2,
        source: 'gcode'
      },
      {
        type: 'arc',
        bounds: {
          maxX: 20,
          maxY: 10,
          minX: 10,
          minY: 0
        },
        center: {
          x: 10,
          y: 10
        },
        d: 'M 10 0 A 10 10 0 0 1 20 10',
        start: {
          x: 10,
          y: 0
        },
        end: {
          x: 20,
          y: 10
        },
        line: 3,
        source: 'gcode'
      }
    ]);
    expect(preview.markers).toEqual([
      {
        type: 'start',
        x: 0,
        y: 0,
        label: 'START'
      },
      {
        type: 'end',
        x: 20,
        y: 10,
        label: 'END'
      }
    ]);
  });

  it('returns an empty preview for files without drawable motion', () => {
    const preview = buildEditorPreviewGeometry(parseGCodeProgram('G90\nM30'));

    expect(preview.paths).toEqual([]);
    expect(preview.markers).toEqual([]);
    expect(preview.viewBox).toEqual({
      minX: -1,
      minY: -1,
      width: 2,
      height: 2
    });
  });

  it('turns path planning documents into preview paths without reparsing generated G-code', () => {
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

    expect(preview.viewBox).toEqual({
      minX: -1,
      minY: -1,
      width: 12,
      height: 7
    });
    expect(preview.paths).toHaveLength(5);
    expect(preview.paths[0]).toMatchObject({
      d: 'M 0 0 L 0 0',
      line: 4,
      operationId: document.plan.operations[0].id,
      pathElementId: document.pathElements[0].id,
      source: 'path-document',
      type: 'rapid'
    });
    expect(preview.paths[1]).toMatchObject({
      d: 'M 0 0 L 10 0',
      line: 5,
      operationId: document.plan.operations[0].id,
      pathElementId: document.pathElements[0].id,
      segmentId: document.plan.operations[0].segmentRefs[0].segmentId,
      source: 'path-document',
      type: 'cut'
    });
    expect(preview.markers).toEqual([
      {
        type: 'start',
        x: 0,
        y: 0,
        label: 'START'
      },
      {
        type: 'end',
        x: 0,
        y: 0,
        label: 'END'
      }
    ]);
  });

  it('matches path document circle preview paths to posted motion-line hints', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }
    ]);
    expect(document.plan.operations).toHaveLength(2);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      lineHints: [4, 5, 6, 7, 8],
      padding: 1
    });

    expect(preview.paths.map((path) => path.line)).toEqual([4, 5, 6, 7, 8]);
    expect(preview.paths.map((path) => path.type)).toEqual(['rapid', 'arc', 'arc', 'arc', 'arc']);
    expect(preview.paths.filter((path) => path.type === 'rapid')).toHaveLength(1);
    expect(preview.paths[1].segmentId).toBe(document.plan.operations[0].segmentRefs[0].segmentId);
    expect(preview.paths[2].segmentId).toBe(document.plan.operations[0].segmentRefs[0].segmentId);
  });

  it('uses stable synthetic line ids when path document preview has stale line hints', () => {
    const document = createPathPlanningDocumentFromDxfEntities([
      line(0, 0, 10, 0),
      line(10, 0, 10, 5),
      line(10, 5, 0, 5),
      line(0, 5, 0, 0)
    ]);

    const preview = buildEditorPathDocumentPreviewGeometry(document, {
      lineHints: [9],
      padding: 1
    });

    expect(preview.paths.map((path) => path.line)).toEqual([9, 2, 3, 4, 5]);
  });

  it('expands the fit viewBox to the rendered viewport aspect instead of letterboxing the SVG', () => {
    expect(
      fitViewBoxToViewportAspect(
        {
          minX: -42,
          minY: -1,
          width: 54,
          height: 12
        },
        1336,
        1158
      )
    ).toEqual({
      minX: -42,
      minY: -18.402695,
      width: 54,
      height: 46.805389
    });
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
