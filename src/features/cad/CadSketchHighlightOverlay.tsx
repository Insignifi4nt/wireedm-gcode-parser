import { memo, useMemo, useSyncExternalStore } from 'react';
import { cadSketchGraphPlacedFrom } from '@/domain/cad/cadSketchGraph';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import type { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import type { SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { CAD_SKETCH_AXIS_PIXELS } from './cadSketchGraphSelection';
import { CAD_SKETCH_H_AXIS_ID, CAD_SKETCH_ORIGIN_ID, CAD_SKETCH_V_AXIS_ID } from '@/domain/cad/sketch-relations/cadSketchVirtualElements';
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
    return { pointIds: new Set(parts.flatMap(part => part.pointIds)), entityIds: new Set(parts.flatMap(part => part.entityIds)) };
  }, [graph, selectedRelationIds, source]);
  if (!highlight.pointIds.size && !highlight.entityIds.size) return null;
  // The origin and the axes are lit where the canvas marks them: a ring at the origin and each axis's arrow from it.
  const origin: SketchPoint = [-center[0], -center[1]], axis = CAD_SKETCH_AXIS_PIXELS * mmPerPixel;
  return <g className="cad-sketch-highlight" data-cad-sketch-highlight="" pointerEvents="none" aria-hidden="true">
    {prepared.geometry.segments.filter(segment => highlight.entityIds.has(segment.id)).map(segment => {
      const boundary = cadSketchGraphBoundary(segment);
      return <g key={segment.id} data-cad-highlight-entity={segment.id}>
        {boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
          : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
            : <path d={cadArcSvgPath(boundary, center)} />}
      </g>;
    })}
    {[CAD_SKETCH_H_AXIS_ID, CAD_SKETCH_V_AXIS_ID].filter(id => highlight.entityIds.has(id)).map(id => <line key={id} data-cad-highlight-entity={id}
      x1={origin[0]} y1={origin[1]} x2={origin[0] + (id === CAD_SKETCH_H_AXIS_ID ? axis : 0)} y2={origin[1] + (id === CAD_SKETCH_V_AXIS_ID ? axis : 0)} />)}
    {highlight.pointIds.has(CAD_SKETCH_ORIGIN_ID) && <circle data-cad-highlight-point={CAD_SKETCH_ORIGIN_ID} cx={origin[0]} cy={origin[1]} r={4 * mmPerPixel} />}
    {prepared.points.filter(point => highlight.pointIds.has(point.id)).map(point => <circle key={point.id} data-cad-highlight-point={point.id} className="cad-sketch-highlight-point"
      cx={point.position[0] - center[0]} cy={point.position[1] - center[1]} r={3 * mmPerPixel} />)}
  </g>;
});
