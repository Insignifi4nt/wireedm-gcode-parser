import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PREVIEW_CAPTURE_BYTES } from '@/features/webmcp/previewCapture';
import { captureCanvas, captureSvgPreview } from '../captureEditorPreview';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=';

describe('editor preview capture', () => {
  let image: HTMLImageElement;
  let svgBlob: Blob;
  let context: { drawImage: ReturnType<typeof vi.fn>; fillRect: ReturnType<typeof vi.fn>; fillStyle: string };

  beforeEach(() => {
    image = document.createElement('img');
    vi.stubGlobal('Image', vi.fn(function () { return image; }));
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => {
      svgBlob = value as Blob;
      return 'blob:editor-svg';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    context = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '' };
    // jsdom has no canvas renderer. Keep DOM cloning, styles, serialization,
    // parsing, Blob URLs and abort events real; substitute only rasterization.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('serializes a valid self-contained SVG with the visible styles and current transform', async () => {
    const svg = preview(1, 1);
    svg.setAttribute('viewBox', '-20 -10 40 20');
    svg.innerHTML = '<g transform="translate(3 4) scale(2)"><path d="M0 0L10 5" /></g>';
    const path = svg.querySelector('path')!;
    path.style.stroke = 'rgb(239, 68, 68)';
    path.style.fill = 'none';
    const capture = captureSvgPreview(svg, new AbortController().signal);
    const serialized = await readBlob(svgBlob);
    image.dispatchEvent(new Event('load'));
    await expect(capture).resolves.toEqual({ dataUrl: png, width: 1, height: 1, source: '2d' });

    const parsed = new DOMParser().parseFromString(serialized, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')?.textContent).toBeUndefined();
    expect(parsed.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(parsed.documentElement.getAttribute('viewBox')).toBe('-20 -10 40 20');
    expect(parsed.querySelector('g')?.getAttribute('transform')).toBe('translate(3 4) scale(2)');
    expect(parsed.querySelector('path')?.getAttribute('style')).toContain('stroke: rgb(239, 68, 68)');
    expect(svg.hasAttribute('xmlns')).toBe(false);
    expect(svgBlob.type).toBe('image/svg+xml');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-svg');
  });

  it('cancels an SVG decode without drawing or retaining its temporary URL', async () => {
    const abort = new AbortController();
    const capture = captureSvgPreview(preview(200, 100), abort.signal);
    const rejection = expect(capture).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort();
    await rejection;
    expect(image.getAttribute('src')).toBe('');
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-svg');
  });

  it('does not allocate a preview URL for a request already cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(captureSvgPreview(preview(200, 100), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('reports rasterization failure and releases the temporary SVG URL', async () => {
    const capture = captureSvgPreview(preview(200, 100), new AbortController().signal);
    const rejection = expect(capture).rejects.toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    image.dispatchEvent(new Event('error'));
    await rejection;
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:editor-svg');
  });

  it('bounds a 3D canvas to 1600 pixels and reduces it further when the encoded PNG is too large', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3200;
    canvas.height = 1800;
    vi.mocked(HTMLCanvasElement.prototype.toDataURL)
      .mockReturnValueOnce('data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_PREVIEW_CAPTURE_BYTES / 3) * 4 + 4))
      .mockReturnValueOnce(png);
    expect(captureCanvas(canvas, '3d')).toEqual({ dataUrl: png, width: 1200, height: 675, source: '3d' });
    expect(context.drawImage.mock.calls).toEqual([
      [canvas, 0, 0, 1600, 900],
      [canvas, 0, 0, 1200, 675]
    ]);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('rejects a zero-area preview before decoding or rendering', async () => {
    await expect(captureSvgPreview(preview(0, 100), new AbortController().signal)).rejects.toMatchObject({ code: 'CAPTURE_UNAVAILABLE' });
    const canvas = document.createElement('canvas');
    canvas.width = 0;
    expect(() => captureCanvas(canvas, '3d')).toThrow('no visible area');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(context.drawImage).not.toHaveBeenCalled();
  });
});

function preview(width: number, height: number) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.appendChild(svg);
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, bottom: height, right: width, width, height, toJSON: () => ({}) });
  return svg;
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
