export interface CadFitArea { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
export type CadFitAreaReader = (viewport: HTMLElement) => CadFitArea | null;

/** Largest axis-aligned clear rectangle, in viewport-local pixels. Read only when fitting. */
export function cadUnobscuredFitArea(viewport: CadFitArea, occlusions: readonly CadFitArea[]): CadFitArea | null {
  if (![viewport, ...occlusions].every(rect => [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0)
    || !(viewport.width > 0 && viewport.height > 0)) return null;
  const blocked = occlusions.map(rect => ({ left: Math.max(0, rect.left - viewport.left), top: Math.max(0, rect.top - viewport.top),
    right: Math.min(viewport.width, rect.left + rect.width - viewport.left), bottom: Math.min(viewport.height, rect.top + rect.height - viewport.top) }))
    .filter(rect => rect.right > rect.left && rect.bottom > rect.top);
  const xs = [...new Set([0, viewport.width, ...blocked.flatMap(rect => [rect.left, rect.right])])].sort((a, b) => a - b);
  const ys = [...new Set([0, viewport.height, ...blocked.flatMap(rect => [rect.top, rect.bottom])])].sort((a, b) => a - b);
  let best: CadFitArea | null = null;
  for (let x = 0; x < xs.length - 1; x++) for (let endX = x + 1; endX < xs.length; endX++) {
    for (let y = 0; y < ys.length - 1; y++) for (let endY = y + 1; endY < ys.length; endY++) {
      const left = xs[x], right = xs[endX], top = ys[y], bottom = ys[endY];
      if (blocked.some(rect => left < rect.right && right > rect.left && top < rect.bottom && bottom > rect.top)) continue;
      const width = right - left, height = bottom - top;
      if (!best || width * height > best.width * best.height) best = { left, top, width, height };
    }
  }
  return best;
}

export function readCadFitArea(viewport: HTMLElement, reader?: CadFitAreaReader): CadFitArea | null {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  if (!width || !height) return null;
  const area = reader ? reader(viewport) : { left: 0, top: 0, width, height };
  return area && [area.left, area.top, area.width, area.height].every(Number.isFinite) && area.width > 0 && area.height > 0
    && area.left >= 0 && area.top >= 0 && area.left + area.width <= width && area.top + area.height <= height ? area : null;
}
