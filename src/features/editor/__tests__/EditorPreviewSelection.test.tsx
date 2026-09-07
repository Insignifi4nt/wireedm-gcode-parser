import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { UpidPathElementRef } from '@/domain/upid/projectRail';
import { EditorPreview } from '../EditorPreview';

it('cycles distinct overlapping features and rejects filtered canvas picks without editing', () => {
  const document = createPathPlanningDocumentFromDxfEntities([
    { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
    { type: 'line', layer: 'CUT', start: { x: -10, y: 0 }, end: { x: 10, y: 0 } }
  ]);
  const original = JSON.stringify(document);
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const onSelect = vi.fn();
  function Harness() {
    const [selected, setSelected] = useState<UpidPathElementRef | null>(null);
    return <EditorPreview program={null} pathDocument={document} canvasMouseMode="select"
      hoveredLine={null} measurementPoints={[]} pinnedLines={[]} selectedLines={[]}
      selectedPathElement={selected} onPathElementClick={(element) => { onSelect(element); setSelected(element); }} />;
  }
  try {
    act(() => root.render(<Harness />));
    const svg = container.querySelector<SVGSVGElement>('svg[data-preview-model]');
    if (!svg) throw new Error('Missing preview');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 220, 120));
    const clientPoint = (x: number, y: number) => {
      const [minX, minY, width, height] = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
      const scale = Math.min(220 / width, 120 / height);
      const clientX = (220 - width * scale) / 2 + (x - minX) * scale;
      const clientY = (120 - height * scale) / 2 + (-y - minY) * scale;
      return { clientX, clientY };
    };
    const click = (x: number, y: number, altKey = false) => {
      act(() => svg.dispatchEvent(new MouseEvent('click', { bubbles: true, ...clientPoint(x, y), altKey })));
    };
    click(5, 0, true);
    const first = onSelect.mock.lastCall?.[0].segmentId;
    click(5, 0, true);
    const second = onSelect.mock.lastCall?.[0].segmentId;
    expect(second).not.toBe(first);
    click(5, 0, true);
    expect(onSelect.mock.lastCall?.[0].segmentId).toBe(first);
    expect(container.querySelector('[data-preview-overlap-selection]')?.textContent).toContain('/2');

    const filter = container.querySelector<HTMLSelectElement>('[aria-label="Canvas selection filter"]');
    if (!filter) throw new Error('Missing filter');
    act(() => { filter.value = 'line'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
    const callCount = onSelect.mock.calls.length;
    click(0, 5);
    expect(onSelect).toHaveBeenCalledTimes(callCount);
    click(5, 0);
    expect(onSelect.mock.lastCall?.[0].segmentId).toBe(document.segments.find((segment) => segment.kind === 'line')?.id);
    act(() => { filter.value = 'circle'; filter.dispatchEvent(new Event('change', { bubbles: true })); });
    vi.useFakeTimers();
    const touch = { ...clientPoint(0, 5), identifier: 1, target: svg };
    act(() => {
      for (const type of ['touchstart', 'touchend']) {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, {
          touches: { value: type === 'touchstart' ? [touch] : [] }, changedTouches: { value: [touch] }
        });
        svg.dispatchEvent(event);
      }
      vi.runOnlyPendingTimers();
    });
    expect(onSelect.mock.lastCall?.[0].segmentId).toBe(document.segments.find((segment) => segment.kind === 'circle')?.id);
    expect(JSON.stringify(document)).toBe(original);
  } finally {
    vi.useRealTimers();
    act(() => root.unmount());
    container.remove();
  }
});
