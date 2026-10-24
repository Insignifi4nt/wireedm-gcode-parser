import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { EditorPreview } from '../EditorPreview';

it('keeps a dense selected contour readable without expanding every segment into point labels', () => {
  const count = 1_200;
  const point = (index: number) => ({ x: 50 * Math.cos(index / count * 2 * Math.PI), y: 50 * Math.sin(index / count * 2 * Math.PI) });
  const pathDocument = createPathPlanningDocumentFromDxfEntities(Array.from({ length: count }, (_, index) => ({
    type: 'line', layer: 'CUT', start: point(index), end: point((index + 1) % count)
  })));
  const original = JSON.stringify(pathDocument);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() => root.render(<EditorPreview program={null} pathDocument={pathDocument}
      hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]}
      selectedPathElement={{ operationId: pathDocument.plan.operations[0].id, segmentId: null }} />));
    const labels = container.querySelectorAll('[data-preview-path-point-label]');
    const handles = container.querySelectorAll('[data-preview-path-endpoint]');
    expect(container.querySelectorAll('path[data-preview-selected="true"]').length).toBe(count);
    expect(labels).toHaveLength(0);
    expect(handles).toHaveLength(0);
    expect(JSON.stringify(pathDocument)).toBe(original);

    const segment = { operationId: pathDocument.plan.operations[0].id, segmentId: pathDocument.segments[400].id };
    const onPick = vi.fn();
    act(() => root.render(<EditorPreview program={null} pathDocument={pathDocument}
      hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]}
      selectedPathElement={{ operationId: segment.operationId, segmentId: null }}
      hoveredPathElement={segment} onPathElementClick={onPick} />));
    expect(container.querySelectorAll('[data-preview-path-point-label]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-preview-path-endpoint]')).toHaveLength(2);
    const endpoint = container.querySelector('[data-preview-path-endpoint][data-preview-point-role="end"]');
    act(() => endpoint?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ ...segment, pointRole: 'end' }));
    expect(JSON.stringify(pathDocument)).toBe(original);
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('reveals only an individually selected arc center while contour selection stays quiet', () => {
  const pathDocument = createPathPlanningDocumentFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 20 }
  ]);
  const container = document.createElement('div');
  const root = createRoot(container);
  const operationId = pathDocument.plan.operations[0].id;
  const render = (segmentId: string | null) => act(() => root.render(<EditorPreview program={null} pathDocument={pathDocument}
    hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]}
    selectedPathElement={{ operationId, segmentId }} />));
  try {
    render(null);
    expect(container.querySelectorAll('[data-preview-arc-center-handle]')).toHaveLength(0);
    render(pathDocument.segments[0].id);
    expect(container.querySelectorAll('[data-preview-arc-center-handle]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-preview-path-point-label]')).toHaveLength(1);
  } finally { act(() => root.unmount()); }
});

it('keeps exact original endpoint targets and operation guards during an explicit endpoint tool', () => {
  const pathDocument = createPathPlanningDocumentFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
  ]);
  const operationId = pathDocument.plan.operations[0].id;
  const container = document.createElement('div');
  const root = createRoot(container);
  const onEndpoint = vi.fn();
  try {
    act(() => root.render(<EditorPreview program={null} pathDocument={pathDocument}
      hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]}
      selectedPathElement={{ operationId, segmentId: null }}
      onPathEndpointClick={onEndpoint} pathEndpointActionOperationId={operationId} />));
    expect(container.querySelectorAll('[data-preview-path-endpoint]')).toHaveLength(4);
    const blocked = container.querySelector('[data-preview-path-endpoint][aria-disabled="true"]');
    act(() => blocked?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onEndpoint).not.toHaveBeenCalled();
    const allowed = container.querySelector(`[data-preview-path-endpoint][data-preview-operation="${operationId}"]`);
    act(() => allowed?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onEndpoint).toHaveBeenCalledWith(expect.objectContaining({ operationId, pointRole: 'start' }));
  } finally { act(() => root.unmount()); }
});
