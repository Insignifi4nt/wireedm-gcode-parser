import { ToolError } from './siteTools';

export const MAX_PREVIEW_CAPTURE_BYTES = 1024 * 1024;
export const MAX_PREVIEW_CAPTURE_DIMENSION = 1600;

/** Actual pixels from the active editor preview; never a desktop/screen capture. */
export interface EditorPreviewCapture {
  readonly dataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly source: '2d' | '3d';
}

export interface PreviewCaptureArtifact {
  readonly captureId: string;
  readonly projectId: string | null;
  readonly draftVersion: string;
  readonly dirty: boolean;
  readonly source: EditorPreviewCapture['source'];
  readonly contentSource: 'editor-draft' | 'saved-project';
  readonly width: number;
  readonly height: number;
  readonly mimeType: 'image/png';
  readonly byteLength: number;
  readonly sha256: string;
  readonly fileName: string;
  readonly previewUrl: string;
}

export async function preparePreviewCapture(
  image: EditorPreviewCapture,
  identity: Pick<PreviewCaptureArtifact, 'projectId' | 'draftVersion' | 'dirty'>,
  signal: AbortSignal
): Promise<PreviewCaptureArtifact> {
  signal.throwIfAborted();
  const prefix = 'data:image/png;base64,';
  if (!image.dataUrl.startsWith(prefix) || image.dataUrl.length > prefix.length + 4 * Math.ceil(MAX_PREVIEW_CAPTURE_BYTES / 3) ||
      !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 ||
      image.width > MAX_PREVIEW_CAPTURE_DIMENSION || image.height > MAX_PREVIEW_CAPTURE_DIMENSION ||
      !['2d', '3d'].includes(image.source)) {
    throw new ToolError('CAPTURE_INVALID', 'The editor preview could not produce a bounded PNG capture.');
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(image.dataUrl.slice(prefix.length)), character => character.charCodeAt(0));
  } catch {
    throw new ToolError('CAPTURE_INVALID', 'The editor returned an invalid PNG capture.');
  }
  // Check the PNG signature and IHDR dimensions as well as the callback metadata.
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const view = new DataView(bytes.buffer);
  if (bytes.length < 33 || bytes.length > MAX_PREVIEW_CAPTURE_BYTES || signature.some((byte, index) => bytes[index] !== byte) ||
      view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR' ||
      view.getUint32(16) !== image.width || view.getUint32(20) !== image.height) {
    throw new ToolError('CAPTURE_INVALID', 'The editor returned an invalid PNG capture.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  signal.throwIfAborted();
  return {
    ...identity, captureId: crypto.randomUUID(), source: image.source,
    contentSource: image.source === '3d' ? 'saved-project' : 'editor-draft', width: image.width, height: image.height,
    mimeType: 'image/png', byteLength: bytes.length,
    sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
    fileName: `editor-preview-${image.source}.png`,
    previewUrl: URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  };
}

/** Only accepts the locally created artifact, never a tool-supplied URL or path. */
export function downloadPreviewCapture(capture: PreviewCaptureArtifact) {
  const link = document.createElement('a');
  link.href = capture.previewUrl;
  link.download = capture.fileName;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); }
}
