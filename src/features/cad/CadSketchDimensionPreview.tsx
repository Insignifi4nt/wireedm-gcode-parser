import { memo, useSyncExternalStore } from 'react';
import type { Point2 } from '@/domain/path-intel/types';
import { cadSketchDimensionCandidateAt, type CadSketchDimensionPlan } from './cadSketchDimensionPlacement';
import { cadSketchGraphDimensionLabel, layoutCadSketchDimensionPreview } from './cadSketchGraphDimensionLayout';
import type { SketchPoint } from './cadSketchInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';
import './cad-sketch-graph-dimensions.css';

/** The last sketch position of the pointer over the canvas. Only the preview subscribes, so moving the pointer renders nothing else. */
export interface CadSketchPointerStore {
  get(): Point2 | null;
  set(point: Point2 | null): void;
  subscribe(listener: () => void): () => void;
}
export function createCadSketchPointerStore(): CadSketchPointerStore {
  let current: Point2 | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: point => {
      if (point === current || point && current && point.x === current.x && point.y === current.y) return;
      current = point; for (const listener of [...listeners]) listener();
    },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }
  };
}

/** The pointer coordinates under the view while the preview owns the pointer, so the readout follows it without rendering the canvas. */
export const CadSketchPointerReadout = memo(function CadSketchPointerReadout({ pointer, fallback }: { readonly pointer: CadSketchPointerStore; readonly fallback: SketchPoint }) {
  const at = useSyncExternalStore(pointer.subscribe, pointer.get), [x, y] = at ? [at.x, at.y] : fallback;
  return <>{formatCadQuantity(Number(x.toFixed(3)))}, {formatCadQuantity(Number(y.toFixed(3)))} mm</>;
});

/**
 * The dimension the Dimension tool would place, drawn at the pointer in the placed dimensions' thin style. It runs no solve or analysis:
 * the plan holds every measurement, so a pointer move only lays out the marks again.
 */
export const CadSketchDimensionPreview = memo(function CadSketchDimensionPreview({ plan, pointer, center, mmPerPixel }: {
  readonly plan: CadSketchDimensionPlan; readonly pointer: CadSketchPointerStore; readonly center: SketchPoint; readonly mmPerPixel: number;
}) {
  const at = useSyncExternalStore(pointer.subscribe, pointer.get);
  const candidate = at ? cadSketchDimensionCandidateAt(plan, at) : null;
  if (!at || !candidate?.preview) return null;
  const marks = layoutCadSketchDimensionPreview(candidate.preview, at, mmPerPixel);
  if (!marks.length) return null;
  const segment = (points: readonly [SketchPoint, SketchPoint], className?: string) => <line className={className} x1={points[0][0] - center[0]} y1={points[0][1] - center[1]}
    x2={points[1][0] - center[0]} y2={points[1][1] - center[1]} />;
  return <g className="cad-sketch-dimension-preview" data-cad-dimension-preview={candidate.form} aria-hidden="true">
    {marks.map((mark, index) => {
      const { text } = cadSketchGraphDimensionLabel(mark.value, mark.kind, candidate.state === 'existing');
      return <g key={index} className="cad-sketch-graph-dimension is-preview" data-cad-dimension-kind={mark.kind}>
        <g className="cad-sketch-graph-dimension-lines">
          {mark.extensions.map((extension, part) => <g key={part}>{segment(extension, 'cad-sketch-graph-dimension-extension')}</g>)}
          {mark.arc ? <path className="cad-sketch-graph-dimension-line" d={`M ${mark.arc.start[0] - center[0]} ${mark.arc.start[1] - center[1]} A ${mark.arc.radius} ${mark.arc.radius} 0 0 ${mark.arc.clockwise ? 0 : 1} ${mark.arc.end[0] - center[0]} ${mark.arc.end[1] - center[1]}`} />
            : segment(mark.line, 'cad-sketch-graph-dimension-line')}
          {mark.arrows.map((arrow, part) => <polygon key={part} className="cad-sketch-graph-dimension-arrow" points={arrow.map(point => `${point[0] - center[0]},${point[1] - center[1]}`).join(' ')} />)}
        </g>
        <g className="cad-sketch-graph-dimension-label"
          transform={`translate(${mark.label[0] - center[0]} ${mark.label[1] - center[1]}) scale(${mmPerPixel} ${-mmPerPixel})${mark.labelAngle ? ` rotate(${-mark.labelAngle * 180 / Math.PI})` : ''}`}>
          <text className="cad-sketch-graph-dimension-text" x={0} y={0} dominantBaseline="central" textAnchor="middle">{text}</text>
        </g>
      </g>;
    })}
  </g>;
});
