import { memo } from 'react';
import type { ResolvedCadPathSegment } from '@/domain/cad/cadSketchGeometry';
import { cadArcSvgPath } from './cadSketchSvg';

/** Render only the numeric segment supplied; partial chains are never closed or validated here. */
export function CadPathSegmentGeometry({ segment }: { segment: ResolvedCadPathSegment }) {
  if (segment.kind === 'line') return <line x1={segment.start[0]} y1={segment.start[1]} x2={segment.end[0]} y2={segment.end[1]} />;
  const startAngle = segment.startAngle * Math.PI / 180;
  const sweep = segment.sweep * Math.PI / 180;
  const endAngle = startAngle + sweep;
  const at = (angle: number) => ({ x: segment.center[0] + segment.radius * Math.cos(angle), y: segment.center[1] + segment.radius * Math.sin(angle) });
  return <path d={cadArcSvgPath({ type: 'arc', layer: null, center: { x: segment.center[0], y: segment.center[1] }, radius: segment.radius,
    startAngle, endAngle, sweepRadians: sweep, clockwise: sweep < 0, start: at(startAngle), end: at(endAngle) })} />;
}

export const CadPathDraftGeometry = memo(function CadPathDraftGeometry({ segments, preview = true }: { segments: readonly ResolvedCadPathSegment[]; preview?: boolean }) {
  return <g data-cad-path-segments className={`cad-profile ${preview ? 'cad-profile-preview' : ''}`}>{segments.map((segment, index) => <CadPathSegmentGeometry key={index} segment={segment} />)}</g>;
});
