import type { Point2 } from './types';

export function exactQuadrantTrig(delta: number) {
  const quadrant = Math.round(delta / (Math.PI / 2));
  if (delta !== quadrant * (Math.PI / 2)) return null;
  switch (((quadrant % 4) + 4) % 4) {
    case 0: return { sin: 0, cosMinusOne: 0 };
    case 1: return { sin: 1, cosMinusOne: -1 };
    case 2: return { sin: 0, cosMinusOne: -2 };
    default: return { sin: -1, cosMinusOne: -1 };
  }
}

/** Rotate from an exact start with radial components that callers may precompute. */
export function rotateCircularPoint(start: Point2, radialX: number, radialY: number, delta: number): Point2 {
  const quadrant = exactQuadrantTrig(delta);
  const sinDelta = quadrant?.sin ?? Math.sin(delta);
  const sinHalf = quadrant ? 0 : Math.sin(delta / 2);
  // Multiply the radial component before squaring a tiny half-angle, so a
  // representable sag is not erased by an underflowing intermediate value.
  const offsetX = quadrant ? quadrant.cosMinusOne * radialX : -2 * sinHalf * (sinHalf * radialX);
  const offsetY = quadrant ? quadrant.cosMinusOne * radialY : -2 * sinHalf * (sinHalf * radialY);
  return {
    x: start.x + offsetX - sinDelta * radialY,
    y: start.y + sinDelta * radialX + offsetY
  };
}

/** Principal signed angle between radial vectors, preserving exact endpoint travel. */
export function signedRadialAngle(start: Point2, end: Point2, center: Point2): number {
  const startX = start.x - center.x;
  const startY = start.y - center.y;
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  // B=A+D. Compute D from the exact endpoints, since subtracting a distant
  // center first can erase a small displacement. Scale before forming products.
  const scale = Math.max(Math.abs(startX), Math.abs(startY), Math.abs(deltaX), Math.abs(deltaY));
  const scaledStartX = startX / scale;
  const scaledStartY = startY / scale;
  const scaledDeltaX = deltaX / scale;
  const scaledDeltaY = deltaY / scale;
  return Math.atan2(
    scaledStartX * scaledDeltaY - scaledStartY * scaledDeltaX,
    scaledStartX * scaledStartX + scaledStartY * scaledStartY +
      scaledStartX * scaledDeltaX + scaledStartY * scaledDeltaY
  );
}

/** Distance from a circle whose radius is measured from this exact start point. */
export function circularRadialDistance(point: Point2, start: Point2, center: Point2, radius: number): number {
  const pointRadius = Math.hypot(point.x - center.x, point.y - center.y);
  const scale = Math.max(radius, pointRadius);
  const denominator = radius / scale + pointRadius / scale;
  // |B|-|A| = (B-A) dot (B+A) / (|B|+|A|). Form B-A directly from
  // point and start so subtracting a distant center cannot erase the offset.
  const directionX = ((point.x - center.x) / scale + (start.x - center.x) / scale) / denominator;
  const directionY = ((point.y - center.y) / scale + (start.y - center.y) / scale) / denominator;
  return Math.abs((point.x - start.x) * directionX + (point.y - start.y) * directionY);
}
