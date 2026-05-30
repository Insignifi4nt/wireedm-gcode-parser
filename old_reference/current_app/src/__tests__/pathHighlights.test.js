import { describe, it, expect, vi } from 'vitest';
import { renderPath } from '../components/canvas/PathHighlights.js';

function createMockContext() {
  return {
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    arc: vi.fn(),
    strokeStyle: '',
    lineWidth: 1
  };
}

describe('PathHighlights', () => {
  it('renders a hover marker for the first parsed path point', () => {
    const markerRenderer = vi.fn();

    renderPath(createMockContext(), { zoom: 1 }, [
      { type: 'position', x: 0, y: 0, line: 1 }
    ], {
      hoverHighlight: { type: 'point', index: 0 },
      markerRenderer
    });

    expect(markerRenderer).toHaveBeenCalledWith(
      { x: 0, y: 0 },
      expect.objectContaining({ LABEL: 'L1' })
    );
  });

  it('can render hover markers separately from path segments', () => {
    const ctx = createMockContext();
    const markerRenderer = vi.fn();

    renderPath(ctx, { zoom: 1 }, [
      { type: 'position', x: 0, y: 0, line: 1 },
      { type: 'cut', x: 10, y: 0, line: 2 }
    ], {
      drawSegments: false,
      hoverHighlight: { type: 'point', index: 1 },
      markerRenderer
    });

    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(markerRenderer).toHaveBeenCalledWith(
      { x: 10, y: 0 },
      expect.objectContaining({ LABEL: 'L2' })
    );
  });

  it('renders pinned highlights with pinned marker styling', () => {
    const markerRenderer = vi.fn();

    renderPath(createMockContext(), { zoom: 1 }, [
      { type: 'position', x: 0, y: 0, line: 1 }
    ], {
      pinnedHighlights: new Set([0]),
      markerRenderer
    });

    expect(markerRenderer).toHaveBeenCalledWith(
      { x: 0, y: 0 },
      expect.objectContaining({
        COLOR: '#ff4d4d',
        LABEL: 'PIN L1'
      })
    );
  });
});
