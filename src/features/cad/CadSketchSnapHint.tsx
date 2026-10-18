import type { CadSketchSnapCandidate } from './cadSketchGeometrySnaps';
import type { SketchPoint } from './cadSketchInteraction';

/** Pixel-sized inference graphics stay upright inside the sketch's Y-up frame. */
export function CadSketchSnapHint({ candidate, center, scaleX, scaleY, label, attained = true }: {
  candidate: CadSketchSnapCandidate; center: SketchPoint; scaleX: number; scaleY: number; label: string; attained?: boolean;
}) {
  const target = candidate.target;
  const id = 'pointId' in target ? target.pointId : 'entityId' in target ? target.entityId : target.kind === 'profile-position'
    ? `${target.profileId}/${target.location.kind}${'boundaryIndex' in target.location ? `/${target.location.boundaryIndex}` : ''}` : 'draft-start';
  const kind = target.kind === 'profile-position' ? target.location.kind === 'arc-center' ? 'center' : target.location.kind : target.kind;
  return <g className={`cad-sketch-snap-hint${attained ? ' is-attained' : ''}`} data-cad-sketch-snap={id} data-cad-sketch-snap-kind={target.kind}
    transform={`translate(${candidate.point[0] - center[0]},${candidate.point[1] - center[1]}) scale(${scaleX},${-scaleY})`} aria-label={label}>
    {kind === 'midpoint' ? <path className="cad-sketch-snap-target" d="M 0 -6 L 6 5 H -6 Z" />
      : kind === 'center' ? <><circle className="cad-sketch-snap-target" r="5" /><path className="cad-sketch-snap-target" d="M -8 0 H 8 M 0 -8 V 8" /></>
        : <rect className="cad-sketch-snap-target" x="-5" y="-5" width="10" height="10" />}
    <rect className="cad-sketch-snap-label-bg" x="9" y="-25" width={label.length * 5.5 + 12} height="19" rx="3" />
    <text className="cad-sketch-snap-label" x="15" y="-12">{label}</text><title>{label}</title>
  </g>;
}
