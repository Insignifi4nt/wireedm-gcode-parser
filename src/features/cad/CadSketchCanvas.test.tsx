import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadSketchFeature } from '@/domain/cad/cadDocument';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';
import { CadSketchCanvas } from './CadSketchCanvas';
import type { CadRenderedViewControls } from './cadViewportControls';

const rasterize = vi.hoisted(() => vi.fn());
vi.mock('@/features/editor/captureEditorPreview', () => ({ captureSvgPreview: rasterize }));
let root: Root;
let container: HTMLDivElement;
let controls: CadRenderedViewControls | null;
let notifyResize: () => void;
let width: number;
let height: number;
const image: EditorPreviewCapture = { dataUrl: 'data:image/png;base64,AA==', width: 1000, height: 500, source: '2d' };
const sketch: CadSketchFeature = { id: 'sketch', kind: 'sketch', name: 'Sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [] };
function currentControls() { if (!controls) throw new Error('Sketch controls unavailable'); return controls; }
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred not initialized'); };
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
beforeEach(() => {
  width = 1000; height = 500; controls = null; rasterize.mockReset();
  notifyResize = () => { throw new Error('Resize observer not initialized'); };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notifyResize = callback; } observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () { return width; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () { return height; });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() {
  await act(async () => root.render(<CadSketchCanvas sketch={sketch} parameters={{}} tool="select" selectedProfileId={null}
    onSelectProfile={vi.fn()} onAddProfile={vi.fn()} onPendingChange={vi.fn()} onError={vi.fn()} cancelSignal={0}
    onControlsReady={value => { controls = value; }} />));
}
describe('sketch preview capture layout', () => {
  it('measures the visible aspect before publishing controls so initial observer delivery cannot stale capture', async () => {
    await mount(); expect(currentControls().getState().available).toBe(true);
    const rendered = container.querySelector('svg');
    expect(rendered?.getAttribute('viewBox')).toBe('-160 -80 320 160');
    const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const operation = currentControls().capture(new AbortController().signal);
    await act(async () => notifyResize());
    pending.resolve(image); await expect(operation).resolves.toBe(image);
  });
  it('still rejects a real resize while SVG pixels are rasterizing', async () => {
    await mount(); const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const operation = currentControls().capture(new AbortController().signal);
    await act(async () => { width = 1200; notifyResize(); });
    pending.resolve(image); await expect(operation).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('still rejects a grid change while SVG pixels are rasterizing', async () => {
    await mount(); const pending = deferred<EditorPreviewCapture>(); rasterize.mockReturnValue(pending.promise);
    const operation = currentControls().capture(new AbortController().signal);
    await act(async () => currentControls().setGrid(false));
    pending.resolve(image); await expect(operation).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
});
