import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPreviewCapture, MAX_PREVIEW_CAPTURE_BYTES, preparePreviewCapture, type EditorPreviewCapture } from './previewCapture';

export const pngCapture: EditorPreviewCapture = {
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDSkAAAAASUVORK5CYII=',
  width: 1, height: 1, source: '2d'
};
const identity = { projectId: 'project.one', draftVersion: 'draft.one', dirty: true };
const signal = new AbortController().signal;
afterEach(() => vi.restoreAllMocks());

describe('editor preview PNG artifacts', () => {
  it('retains exact PNG bytes behind a local preview URL and downloads only that artifact', async () => {
    let blob!: Blob;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:preview'; });
    const capture = await preparePreviewCapture(pngCapture, identity, signal);
    expect(capture).toMatchObject({ ...identity, source: '2d', width: 1, height: 1, mimeType: 'image/png', previewUrl: 'blob:preview', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(blob.type).toBe('image/png');
    expect(capture.byteLength).toBe(blob.size);
    expect(JSON.stringify(capture)).not.toContain('base64');
    let link!: HTMLAnchorElement;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { link = this; });
    downloadPreviewCapture(capture);
    expect(link.href).toBe('blob:preview');
    expect(link.download).toBe('editor-preview-2d.png');
    expect(link.isConnected).toBe(false);
  });

  it.each([
    { ...pngCapture, dataUrl: 'https://example.com/capture.png' },
    { ...pngCapture, dataUrl: 'data:image/png;base64,invalid!' },
    { ...pngCapture, dataUrl: 'data:image/png;base64,' + 'A'.repeat(4 * Math.ceil(MAX_PREVIEW_CAPTURE_BYTES / 3) + 4) },
    { ...pngCapture, width: 2 },
    { ...pngCapture, width: 1601 },
    { ...pngCapture, height: 0 }
  ])('rejects malformed or out-of-bounds captures before retaining a URL %#', async image => {
    const create = vi.spyOn(URL, 'createObjectURL');
    await expect(preparePreviewCapture(image, identity, signal)).rejects.toMatchObject({ code: 'CAPTURE_INVALID' });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not retain image data after cancellation', async () => {
    const abort = new AbortController();
    abort.abort();
    const create = vi.spyOn(URL, 'createObjectURL');
    await expect(preparePreviewCapture(pngCapture, identity, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(create).not.toHaveBeenCalled();
  });
});
