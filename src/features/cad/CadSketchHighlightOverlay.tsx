import { memo, useMemo, useSyncExternalStore } from 'react';
import { cadSketchGraphPlacedFrom } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import type { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import type { SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { CAD_SKETCH_AXIS_PIXELS, type CadSketchDatum } from './cadSketchGraphSelection';
import { cadSketchHighlightRelationIds, cadSketchRelationHighlight, type CadSketchHighlight, type CadSketchHighlightStore } from './cadSketchDimensionSelection';
import './cad-sketch-graph-dimensions.css';

type Prepared = ReturnType<typeof prepareCadSketchGraphInteraction>;

/**
 * The geometry a hovered or selected dimension or relation names, drawn above the sketch rows. It is the only subscriber to the hover
 * store, so hovering a dimension or a dock row renders this leaf alone; the rows and their selection classes stay unchanged.
 */
export const CadSketchHighlightOverlay = memo(function CadSketchHighlightOverlay({ store, prepared, center, mmPerPixel, selectedRelationIds }: {
  store: CadSketchHighlightStore; prepared: Prepared; center: SketchPoint; mmPerPixel: number; selectedRelationIds: readonly string[];
}) {
  const source = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // What a relation names does not depend on where its dimension is placed.
  const graph = cadSketchGraphPlacedFrom(prepared.graph);
  const highlight = useMemo(() => {
    const parts: CadSketchHighlight[] = [];
    const relation = (id: string) => graph.relations.find(item => item.id === id);
    for (const id of selectedRelationIds) { const found = relation(id); if (found) parts.push(cadSketchRelationHighlight(graph, found)); }
    if (source?.kind === 'geometry') parts.push(source);
    else for (const id of cadSketchHighlightRelationIds(source)) { const found = relation(id); if (found) parts.push(cadSketchRelationHighlight(graph, found)); }
    return { pointIds: new Set(parts.flatMap(part => part.pointIds)), entityIds: new Set(parts.flatMap(part => part.entityIds)), datums: new Set(parts.flatMap(part => part.datums)) };
  }, [graph, selectedRelationIds, source]);
  if (!highlight.pointIds.size && !highlight.entityIds.size && !highlight.datums.size) return null;
  const origin: SketchPoint = [-center[0], -center[1]], axis = CAD_SKETCH_AXIS_PIXELS * mmPerPixel;
  const datum = (kind: CadSketchDatum) => kind === 'origin' ? <circle key={kind} data-cad-highlight-datum={kind} cx={origin[0]} cy={origin[1]} r={4 * mmPerPixel} />
    : <line key={kind} data-cad-highlight-datum={kind} x1={origin[0]} y1={origin[1]} x2={origin[0] + (kind === 'x-axis' ? axis : 0)} y2={origin[1] + (kind === 'y-axis' ? axis : 0)} />;
  return <g className="cad-sketch-highlight" data-cad-sketch-highlight="" pointerEvents="none" aria-hidden="true">
    {prepared.geometry.segments.filter(segment => highlight.entityIds.has(segment.id)).map(segment => {
      const boundary = cadSketchGraphBoundary(segment);
      return <g key={segment.id} data-cad-highlight-entity={segment.id}>
        {boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
          : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
            : <path d={cadArcSvgPath(boundary, center)} />}
      </g>;
    })}
    {[...highlight.datums].map(datum)}
    {prepared.points.filter(point => highlight.pointIds.has(point.id)).map(point => <circle key={point.id} data-cad-highlight-point={point.id} className="cad-sketch-highlight-point"
      cx={point.position[0] - center[0]} cy={point.position[1] - center[1]} r={3 * mmPerPixel} />)}
  </g>;
});
