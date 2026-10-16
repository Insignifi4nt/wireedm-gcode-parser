import { useMemo } from 'react';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphDimensionLabel, layoutCadSketchGraphDimensions, type CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import type { SketchPoint } from './cadSketchInteraction';
import './cad-sketch-graph-dimensions.css';

export interface CadSketchGraphDimensionsProps {
  readonly graph: CadSketchGraph;
  readonly parameters: Readonly<Record<string, number>>;
  readonly center: SketchPoint;
  readonly mmPerPixel: number;
  readonly selectedRelationId?: string | null;
  readonly interactive: boolean;
  onConfigure(relation: CadSketchDimensionRelation): void;
}

/** The parent owns scale(1,-1); labels undo that flip and retain screen-pixel sizing. */
export function CadSketchGraphDimensions({ graph, parameters, center, mmPerPixel, selectedRelationId, interactive, onConfigure }: CadSketchGraphDimensionsProps) {
  const dimensions = useMemo(() => layoutCadSketchGraphDimensions(graph, parameters, mmPerPixel), [graph, parameters, mmPerPixel]);
  const line = (points: readonly [SketchPoint, SketchPoint]) => <line x1={points[0][0] - center[0]} y1={points[0][1] - center[1]}
    x2={points[1][0] - center[0]} y2={points[1][1] - center[1]} vectorEffect="non-scaling-stroke" />;
  return <g className="cad-sketch-graph-dimensions" role="group" aria-label="Sketch dimensions">
    {dimensions.map(dimension => {
      const { quantity, text, width, height } = cadSketchGraphDimensionLabel(dimension.kind === 'angle' ? dimension.valueDegrees : dimension.valueMm, dimension.kind);
      const name = dimension.kind === 'radius' || dimension.kind === 'diameter' || dimension.kind === 'angle' ? dimension.kind : dimension.kind === 'setback' ? `chamfer setback ${dimension.side + 1}` : 'distance';
      return <g key={`${dimension.relation.id}/${dimension.kind === 'setback' ? dimension.side : dimension.kind}`} data-cad-sketch-dimension={dimension.relation.id}
        data-cad-dimension-kind={dimension.kind} data-cad-dimension-side={dimension.kind === 'setback' ? dimension.side : undefined}
        style={{ color: selectedRelationId === dimension.relation.id ? 'var(--primary)' : 'var(--muted-foreground)' }}>
        <g fill="none" stroke="currentColor" strokeWidth={1} pointerEvents="none">
          {dimension.extensions.map((extension, index) => <g key={index} opacity={0.6}>{line(extension)}</g>)}
          {dimension.kind === 'angle' ? <path d={`M ${dimension.arc.start[0] - center[0]} ${dimension.arc.start[1] - center[1]} A ${dimension.arc.radius} ${dimension.arc.radius} 0 0 ${dimension.arc.clockwise ? 0 : 1} ${dimension.arc.end[0] - center[0]} ${dimension.arc.end[1] - center[1]}`} vectorEffect="non-scaling-stroke" /> : line(dimension.line)}
          {dimension.arrows.map((arrow, index) => <polygon key={index} fill="currentColor" stroke="none"
            points={arrow.map(point => `${point[0] - center[0]},${point[1] - center[1]}`).join(' ')} />)}
        </g>
        <g className="cad-sketch-graph-dimension-label" role="button" aria-label={`Configure ${name} ${quantity}`} aria-pressed={selectedRelationId === dimension.relation.id}
          aria-disabled={!interactive || undefined} tabIndex={interactive ? 0 : -1} style={{ cursor: interactive ? 'pointer' : 'default' }}
          transform={`translate(${dimension.label[0] - center[0]} ${dimension.label[1] - center[1]}) scale(${mmPerPixel} ${-mmPerPixel})`}
          onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); if (interactive && event.isPrimary !== false) event.currentTarget.focus({ preventScroll: true }); }}
          onClick={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); if (interactive) onConfigure(dimension.relation); }}
          onKeyDown={event => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); event.stopPropagation();
            if (interactive && !event.nativeEvent.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) onConfigure(dimension.relation); }}>
          <rect x={-width / 2 - 3} y={-(height + 6) / 2} width={width + 6} height={height + 6} fill="transparent" stroke="none" />
          <rect className="cad-sketch-graph-dimension-label-box" x={-width / 2} y={-height / 2} width={width} height={height} rx={3}
            fill="var(--card)" stroke="transparent" strokeWidth={0.6} pointerEvents="none" />
          <text x={0} y={0} dominantBaseline="central" textAnchor="middle" fontFamily="var(--font-mono)" fontSize={11}
            fill="currentColor" stroke="none" pointerEvents="none">{text}</text>
        </g>
      </g>;
    })}
  </g>;
}
