import { describe, expect, it } from 'vitest';

import { resolvePathDragTarget } from './pathSelectionGeometry';

describe('pathSelectionGeometry', () => {
  it('uses the dragged contour when the current selection belongs to another contour', () => {
    const selected = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: null
    };
    const dragged = {
      operationId: 'op_0002',
      pathElementId: 'contour_0002',
      segmentId: 'seg_0002'
    };

    expect(resolvePathDragTarget(selected, dragged)).toEqual(dragged);
  });

  it('keeps a selected contour as the drag target when dragging one of its own segments', () => {
    const selected = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: null
    };
    const dragged = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: 'seg_0001'
    };

    expect(resolvePathDragTarget(selected, dragged)).toEqual(selected);
  });

  it('keeps a selected operation as the drag target when dragging one of its own segments', () => {
    const selected = {
      operationId: 'op_0001',
      pathElementId: null,
      segmentId: null
    };
    const dragged = {
      operationId: 'op_0001',
      pathElementId: null,
      segmentId: 'seg_0001'
    };

    expect(resolvePathDragTarget(selected, dragged)).toEqual(selected);
  });

  it('keeps a selected segment as the drag target when dragging that same segment', () => {
    const selected = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: 'seg_0001'
    };
    const dragged = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: 'seg_0001'
    };

    expect(resolvePathDragTarget(selected, dragged)).toEqual(selected);
  });

  it('uses the dragged segment when a different segment in the same contour is selected', () => {
    const selected = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: 'seg_0001'
    };
    const dragged = {
      operationId: 'op_0001',
      pathElementId: 'contour_0001',
      segmentId: 'seg_0002'
    };

    expect(resolvePathDragTarget(selected, dragged)).toEqual(dragged);
  });
});
