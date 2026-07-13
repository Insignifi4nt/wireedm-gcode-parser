const FULL_TURN_DEGREES = 360;
const DEGREES_TO_RADIANS = Math.PI / 180;

export function signedDxfArcSweepRadians(
  startDegrees: number,
  endDegrees: number,
  clockwise: boolean
): number | null {
  if (!Number.isFinite(startDegrees) || !Number.isFinite(endDegrees)) return null;

  const directedDifference = clockwise
    ? startDegrees - endDegrees
    : endDegrees - startDegrees;
  if (!Number.isFinite(directedDifference)) return null;

  let magnitudeDegrees = directedDifference % FULL_TURN_DEGREES;
  if (magnitudeDegrees <= 0) magnitudeDegrees += FULL_TURN_DEGREES;
  const magnitudeRadians = magnitudeDegrees * DEGREES_TO_RADIANS;
  if (!Number.isFinite(magnitudeRadians) || magnitudeRadians <= 0) return null;

  return clockwise ? -magnitudeRadians : magnitudeRadians;
}
