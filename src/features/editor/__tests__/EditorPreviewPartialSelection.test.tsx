import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import { EditorPreview } from '../EditorPreview';

it('selects the source and span while exposing only original editable endpoints', () => {
  const source = createPathPlanningDocumentFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  const segmentId = source.segments[0].id;
  const partial = setMachiningSpanParticipation(source, {
    sourceSegmentId: segmentId, range: { start: 0, end: 0.4 }, participation: 'inactive-reference'
  })!;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  try {
    act(() => root.render(<EditorPreview program={null} pathDocument={partial}
      hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]}
      onPathElementClick={onSelect} />));
    const paths = [...container.querySelectorAll<SVGPathElement>('path[data-preview-segment]')];
    const clipped = paths.find((path) => path.getAttribute('d')?.includes('4'));
    expect(clipped).toBeDefined();
    act(() => clipped!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      operationId: source.plan.operations[0].id, segmentId, machiningSpanId: expect.any(String)
    }));
    const endpoints = [...container.querySelectorAll('[data-preview-path-endpoint]')];
    expect(endpoints.map((point) => Number(point.getAttribute('cx'))).sort((a, b) => a - b)).toEqual([0, 10]);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
