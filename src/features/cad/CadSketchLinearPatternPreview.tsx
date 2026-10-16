import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadSketchLinearPatternInstances } from '@/domain/cad/cadSketchLinearPattern';
import type { CadSketchLinearPatternInteraction } from './CadSketchLinearPatternEditor';
import type { SketchPoint } from './cadSketchInteraction';

/** Intent overlay only; shared edit preparation certifies the actual material preview. */
export function CadSketchLinearPatternPreview({ graph, parameters, interaction, center, mmPerPixel }: {
  graph: CadSketchGraph; parameters: Readonly<Record<string, number>>; interaction: CadSketchLinearPatternInteraction;
  center: SketchPoint; mmPerPixel: number;
}) {
  const { relation, detaching, onToggleInstance } = interaction;
  const seed = graph.entities.find(entity => entity.id === relation.seed.entityId), origin = graph.points.find(point => point.id === relation.seed.centerPointId);
  if (seed?.kind !== 'circle' || !origin) return null;
  let x: number, y: number, radius: number, pitch: number;
  try { x = evaluateCadScalar(origin.position[0], parameters) - center[0]; y = evaluateCadScalar(origin.position[1], parameters) - center[1];
    radius = evaluateCadScalar(seed.radius, parameters); pitch = evaluateCadScalar(relation.spacing, parameters); } catch { return null; }
  if (![x,y,radius,pitch].every(Number.isFinite) || radius <= 0 || pitch <= 0) return null;
  const sign = relation.direction.startsWith('-') ? -1 : 1, horizontal = relation.direction.endsWith('x');
  const end = sign * (relation.count - 1) * pitch;
  return <g className="cad-sketch-pattern-preview" aria-label="Pattern occurrences" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
    <line className="cad-sketch-pattern-axis" x1={x} y1={y} x2={x + (horizontal ? end : 0)} y2={y + (horizontal ? 0 : end)} strokeDasharray={`${4 * mmPerPixel} ${4 * mmPerPixel}`} pointerEvents="none" />
    <circle className="cad-sketch-pattern-seed" cx={x} cy={y} r={radius} pointerEvents="none" />
    {cadSketchLinearPatternInstances(relation).filter(member => member.inRange).map(member => {
      const dx = x + (horizontal ? sign * member.index * pitch : 0), dy = y + (horizontal ? 0 : sign * member.index * pitch);
      return <g key={member.index} className={`cad-sketch-pattern-instance${member.omitted ? ' is-omitted' : ''}`}
        data-cad-pattern-instance={member.index} role="checkbox" aria-label={`Include occurrence ${member.index + 1}`} aria-checked={!member.omitted} aria-disabled={detaching || undefined} tabIndex={detaching ? -1 : 0}
        onClick={event => { event.preventDefault(); event.stopPropagation(); if (!detaching) onToggleInstance(member.index); }}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (!detaching) onToggleInstance(member.index); } }}>
        <circle className="cad-sketch-pattern-instance-hit" cx={dx} cy={dy} r={radius} strokeWidth={12 * mmPerPixel} />
        {member.omitted && <circle className="cad-sketch-pattern-ghost" cx={dx} cy={dy} r={radius} strokeDasharray={`${3 * mmPerPixel} ${3 * mmPerPixel}`} />}
        <g transform={`translate(${dx} ${dy + radius + 11 * mmPerPixel}) scale(1,-1)`}>
          <circle r={8 * mmPerPixel} className="cad-sketch-pattern-index" /><text textAnchor="middle" dominantBaseline="central" fontSize={10 * mmPerPixel}>{member.index + 1}</text>
        </g><title>{member.omitted ? 'Restore' : 'Exclude'} occurrence {member.index + 1}</title>
      </g>;
    })}
  </g>;
}
