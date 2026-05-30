import { describe, expect, it } from 'vitest';

import { parseGCodeProgram } from '../gcodeParser';
import { buildEditorPreviewGeometry, fitViewBoxToViewportAspect } from '../previewGeometry';

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
        d: 'M 0 0 L 0 0',
        end: {
          x: 0,
          y: 0
        },
        line: 1
      },
      {
        type: 'cut',
        d: 'M 0 0 L 10 0',
        end: {
          x: 10,
          y: 0
        },
        line: 2
      },
      {
        type: 'arc',
        d: 'M 10 0 A 10 10 0 0 1 20 10',
        end: {
          x: 20,
          y: 10
        },
        line: 3
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
