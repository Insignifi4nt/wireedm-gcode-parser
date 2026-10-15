import { memo, useMemo } from 'react';
import type { ResolvedCadPathSegment } from '@/domain/cad/cadSketchGeometry';
import { cadArcSvgPath } from './cadSketchSvg';

/** Render only the numeric segment supplied; partial chains are never closed or validated here. */
export function CadPathSegmentGeometry({ segment, origin = [0, 0] }: { segment: ResolvedCadPathSegment; origin?: readonly [number, number] }) {
  if (segment.kind === 'line') return <line x1={segment.start[0] - origin[0]} y1={segment.start[1] - origin[1]} x2={segment.end[0] - origin[0]} y2={segment.end[1] - origin[1]} />;
  const startAngle = segment.startAngle * Math.PI / 180;
  const sweep = segment.sweep * Math.PI / 180;
  const endAngle = startAngle + sweep;
  const at = (angle: number) => ({ x: segment.center[0] + segment.radius * Math.cos(angle), y: segment.center[1] + segment.radius * Math.sin(angle) });
  return <path d={cadArcSvgPath({ type: 'arc', layer: null, center: { x: segment.center[0], y: segment.center[1] }, radius: segment.radius,
    startAngle, endAngle, sweepRadians: sweep, clockwise: sweep < 0, start: at(startAngle), end: at(endAngle) }, origin)} />;
}

export const CadPathDraftGeometry = memo(function CadPathDraftGeometry({ segments, preview = true, viewCenter = [0, 0] }: { segments: readonly ResolvedCadPathSegment[]; preview?: boolean; viewCenter?: readonly [number, number] }) {
  const prepared = useMemo(() => {
    const first = segments[0]; const origin = !first ? [0, 0] as const : first.kind === 'line' ? first.start : first.center;
    return { origin, content: segments.map((segment, index) => <CadPathSegmentGeometry key={index} segment={segment} origin={origin} />) };
  }, [segments]);
  return <g data-cad-path-segments transform={`translate(${prepared.origin[0] - viewCenter[0]},${prepared.origin[1] - viewCenter[1]})`} className={`cad-profile ${preview ? 'cad-profile-preview' : ''}`}>{prepared.content}</g>;
});
