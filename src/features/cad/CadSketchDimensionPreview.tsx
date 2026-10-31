import { memo, useSyncExternalStore } from 'react';
import type { Point2 } from '@/domain/path-intel/types';
import { cadSketchDimensionBatchAt, cadSketchDimensionCandidateAt, type CadSketchDimensionPlan } from './cadSketchDimensionPlacement';
import { cadSketchDimensionArcPath, cadSketchGraphDimensionLabel, placeCadSketchDimensions } from './cadSketchGraphDimensionLayout';
import type { SketchPoint } from './cadSketchInteraction';
import { formatCadQuantity } from './cadDisplayQuantity';
import './cad-sketch-graph-dimensions.css';

/** The last sketch position of the pointer over the canvas. Only the preview subscribes, so moving the pointer renders nothing else. */
export interface CadSketchPointerStore {
  get(): Point2 | null;
  /** Millimetres per screen pixel of the view the pointer was last over, which a dimension placed at the pointer is drawn with. */
  scale(): number | null;
  set(point: Point2 | null, mmPerPixel?: number): void;
  subscribe(listener: () => void): () => void;
}
export function createCadSketchPointerStore(): CadSketchPointerStore {
  let current: Point2 | null = null, scale: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    scale: () => scale,
    set: (point, mmPerPixel) => {
      if (mmPerPixel !== undefined) scale = mmPerPixel;
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
 * The dimension the Dimension tool would place, drawn at the pointer in the placed dimensions' thin style from the relations a click there
 * stores, placed as the click places them: an existing or reused dimension where it would move, keeping the sector or side it measures.
 * It runs no solve or analysis: the plan holds every measurement, so a pointer move only lays out the marks again.
 */
export const CadSketchDimensionPreview = memo(function CadSketchDimensionPreview({ plan, pointer, center, mmPerPixel }: {
  readonly plan: CadSketchDimensionPlan; readonly pointer: CadSketchPointerStore; readonly center: SketchPoint; readonly mmPerPixel: number;
}) {
  const at = useSyncExternalStore(pointer.subscribe, pointer.get);
  const candidate = at ? cadSketchDimensionCandidateAt(plan, at) : null, batch = at && candidate ? cadSketchDimensionBatchAt(plan, candidate, at) : null;
  if (!at || !candidate || !batch?.added || !plan.graph) return null;
  const { marks } = placeCadSketchDimensions(plan.graph, plan.parameters, [...batch.added, ...batch.moved], at, mmPerPixel);
  if (!marks.length) return null;
  const segment = (points: readonly [SketchPoint, SketchPoint], className?: string) => <line className={className} x1={points[0][0] - center[0]} y1={points[0][1] - center[1]}
    x2={points[1][0] - center[0]} y2={points[1][1] - center[1]} />;
  return <g className="cad-sketch-dimension-preview" data-cad-dimension-preview={candidate.form} aria-hidden="true">
    {marks.map((mark, index) => {
      // An existing dimension, and a blocked one that only its reference measures, read in a reference's parentheses.
      const { text } = cadSketchGraphDimensionLabel(mark.value, mark.kind, candidate.state !== 'available');
      return <g key={index} className="cad-sketch-graph-dimension is-preview" data-cad-dimension-kind={mark.kind}>
        <g className="cad-sketch-graph-dimension-lines">
          {mark.extensions.map((extension, part) => <g key={part}>{segment(extension, 'cad-sketch-graph-dimension-extension')}</g>)}
          {mark.arc ? <path className="cad-sketch-graph-dimension-line" d={cadSketchDimensionArcPath(mark.arc, center)} />
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
