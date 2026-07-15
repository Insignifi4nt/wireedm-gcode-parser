function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

const VISUAL_BASE_RATE_MM_PER_SECOND = 25;

export function advanceSimulationProgress(
  current: number,
  elapsedSeconds: number,
  speed: number,
  totalDistanceMm: number,
): number {
  if (!Number.isFinite(totalDistanceMm) || totalDistanceMm <= 0) return 0;

  const progress = clampProgress(current);
  if (
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0 ||
    !Number.isFinite(speed) ||
    speed <= 0
  ) {
    return progress;
  }

  const visualDistanceMm = elapsedSeconds * VISUAL_BASE_RATE_MM_PER_SECOND * speed;
  return clampProgress(progress + visualDistanceMm / totalDistanceMm);
}
