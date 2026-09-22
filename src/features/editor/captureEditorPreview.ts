import {
  MAX_PREVIEW_CAPTURE_BYTES, MAX_PREVIEW_CAPTURE_DIMENSION,
  type EditorPreviewCapture
} from '@/features/webmcp/previewCapture';
import { ToolError } from '@/features/webmcp/siteTools';

/** Bound the actual preview pixels before handing an artifact to an agent. */
export function captureCanvas(canvas: HTMLCanvasElement, source: '2d' | '3d'): EditorPreviewCapture {
  let scale = Math.min(1, MAX_PREVIEW_CAPTURE_DIMENSION / Math.max(canvas.width, canvas.height));
  if (!canvas.width || !canvas.height) throw new ToolError('CAPTURE_UNAVAILABLE', 'The preview has no visible area yet.');
  const copy = document.createElement('canvas');
  const context = copy.getContext('2d');
  if (!context) throw new ToolError('CAPTURE_UNAVAILABLE', 'This browser cannot capture the preview.');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    copy.width = Math.max(1, Math.round(canvas.width * scale));
    copy.height = Math.max(1, Math.round(canvas.height * scale));
    context.drawImage(canvas, 0, 0, copy.width, copy.height);
    const dataUrl = copy.toDataURL('image/png');
    if ((dataUrl.length - 'data:image/png;base64,'.length) * 3 / 4 <= MAX_PREVIEW_CAPTURE_BYTES) {
      return { dataUrl, width: copy.width, height: copy.height, source };
    }
    scale *= 0.75;
  }
  throw new ToolError('CAPTURE_UNAVAILABLE', 'The preview image exceeds the capture size limit.');
}

export async function captureSvgPreview(svg: SVGSVGElement, signal: AbortSignal): Promise<EditorPreviewCapture> {
  signal.throwIfAborted();
  const bounds = svg.getBoundingClientRect();
  if (!bounds.width || !bounds.height) throw new ToolError('CAPTURE_UNAVAILABLE', 'The path preview is not visible.');
  const clone = svg.cloneNode(true) as SVGSVGElement;
  // SVG rasterization cannot inherit the page stylesheet. Freeze only display styles,
  // preserving the current viewBox, selected geometry and pan/zoom transforms.
  const sourceNodes = [svg, ...svg.querySelectorAll('*')];
  const targetNodes = [clone, ...clone.querySelectorAll('*')];
  const properties = ['color', 'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity',
    'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'font-family', 'font-size',
    'font-weight', 'text-anchor', 'opacity', 'visibility', 'display'];
  sourceNodes.forEach((node, index) => {
    const style = getComputedStyle(node);
    const target = targetNodes[index] as SVGElement;
    for (const property of properties) target.style.setProperty(property, style.getPropertyValue(property));
  });
  clone.setAttribute('width', String(Math.round(bounds.width)));
  clone.setAttribute('height', String(Math.round(bounds.height)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      const abort = () => { image.src = ''; reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); };
      image.onload = () => { signal.removeEventListener('abort', abort); resolve(); };
      image.onerror = () => { signal.removeEventListener('abort', abort); reject(new ToolError('CAPTURE_UNAVAILABLE', 'The path preview could not be rasterized.')); };
      signal.addEventListener('abort', abort, { once: true });
      image.src = url;
    });
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_PREVIEW_CAPTURE_DIMENSION / Math.max(bounds.width, bounds.height));
    canvas.width = Math.max(1, Math.round(bounds.width * scale));
    canvas.height = Math.max(1, Math.round(bounds.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new ToolError('CAPTURE_UNAVAILABLE', 'This browser cannot capture the preview.');
    const backgrounds: string[] = [];
    for (let element: Element | null = svg; element; element = element.parentElement) backgrounds.push(getComputedStyle(element).backgroundColor);
    for (const background of backgrounds.reverse()) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return captureCanvas(canvas, '2d');
  } finally { URL.revokeObjectURL(url); }
}
