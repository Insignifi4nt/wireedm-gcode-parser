import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { EditorScalePanel } from '../EditorScalePanel';

it('previews a longest-side fit, applies its exact factor/origin, and respects mutation locks', async () => {
  const node = document.createElement('div'); document.body.append(node);
  const root = createRoot(node), onApply = vi.fn();
  const doc = createUpidFromDxfEntities([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 10 }]);
  try {
    await act(async () => root.render(<EditorScalePanel document={doc} disabled={false} onApply={onApply} onDraftChange={vi.fn()} />));
    expect(node.textContent).toContain('140.000 × 140.000 mm');
    const apply = node.querySelector('button');
    if (!apply) throw new Error('Missing scale command');
    await act(async () => apply.click());
    expect(onApply).toHaveBeenCalledWith(7, { x: 0, y: 0 });
    await act(async () => root.render(<EditorScalePanel document={doc} disabled onApply={onApply} onDraftChange={vi.fn()} />));
    expect(apply.disabled).toBe(true);
    await act(async () => apply.click());
    expect(onApply).toHaveBeenCalledTimes(1);
  } finally { act(() => root.unmount()); node.remove(); }
});
