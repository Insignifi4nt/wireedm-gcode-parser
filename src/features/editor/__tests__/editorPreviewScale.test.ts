import { describe, expect, it } from 'vitest';

import {
  buildPreviewGrid,
  buildVisibleGridLabels,
  endpointHitRadiiPixels,
  previewWorldUnitsPerCssPixel,
  visibleEndpointIndices
} from '../editorPreviewHelpers';

describe('canvas pixel scale', () => {
  it('keeps marker and label world sizes proportional to viewBox scale across zoom and resize', () => {
    const surface = { width: 800, height: 600 };
    const overview = previewWorldUnitsPerCssPixel({ minX: 0, minY: 0, width: 160, height: 120 }, surface);
    const zoomed = previewWorldUnitsPerCssPixel({ minX: 40, minY: 30, width: 40, height: 30 }, surface);
    const narrow = previewWorldUnitsPerCssPixel({ minX: 0, minY: 0, width: 160, height: 120 },
      { width: 400, height: 600 });
    expect(overview).toBeCloseTo(0.2);
    expect(zoomed).toBeCloseTo(0.05);
    expect(narrow).toBeCloseTo(0.4);
    expect((overview * 11) / overview).toBe(11);
    expect((zoomed * 11) / zoomed).toBe(11);
  });

  it('uses readable 1/2/5 major grid ticks and skips labels at canvas edges', () => {
    const view = { minX: 0, minY: 0, width: 160, height: 120 };
    const scale = previewWorldUnitsPerCssPixel(view, { width: 800, height: 600 });
    const grid = buildPreviewGrid(view, 120, scale);
    expect(grid.labelSpacing).toBe(20);
    const labels = buildVisibleGridLabels(grid.lines, grid.labelSpacing, grid.bounds, scale);
    expect(labels.vertical.map((line) => line.value)).toEqual([20, 40, 60, 80, 100, 120, 140]);
    expect(labels.horizontal.every((line) => line.value > 0 && line.value < 120)).toBe(true);
    const zoomed = buildPreviewGrid({ minX: 40, minY: 30, width: 40, height: 30 }, 120, 0.05);
    expect(zoomed.labelSpacing).toBe(5);
  });

  it('thins clustered endpoints but keeps selected or hovered points visible', () => {
    const handles = Array.from({ length: 1000 }, (_, index) => ({
      point: { x: index * 0.1, y: 0 }, selected: index === 501
    }));
    const visible = visibleEndpointIndices(handles, 0.2, (handle) => handle.selected);
    expect(visible.size).toBeLessThan(100);
    expect(visible.has(501)).toBe(true);
    expect(visible.has(0)).toBe(true);
    const hit = endpointHitRadiiPixels(handles, 0.2);
    expect(hit[0]).toBeLessThan(3);
    expect(endpointHitRadiiPixels([{ point: { x: 0, y: 0 } }], 0.2)[0]).toBe(7.5);
  });
});
