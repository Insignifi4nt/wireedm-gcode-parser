import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { cadSketchGraphPointTranslation, prepareCadSketchGraphInteraction, type CadSketchGraphPointControl, type CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { snapSketchPoint, type SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { formatCadQuantity } from './cadDisplayQuantity';
import { CadSketchGraphDimensions } from './CadSketchGraphDimensions';
import type { CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import type { CadSketchGraphPickFilter } from './cadSketchGraphSelection';

type Prepared = ReturnType<typeof prepareCadSketchGraphInteraction>;
export interface CadSketchGraphControls {
  readonly document: CadDocument;
  readonly selection: readonly CadSketchGraphSelection[];
  readonly relation?: CadSketchGraphRelation | null;
  readonly inspection?: { readonly pointIds: readonly string[]; readonly entityIds: readonly string[] } | null;
  readonly degreesOfFreedom?: number | null;
  readonly showDimensions?: boolean;
  onSelect(selection: CadSketchGraphSelection | null, additive?: boolean): void;
  onSelectSet?(selections: readonly CadSketchGraphSelection[]): void;
  onDelete?(selection: CadSketchGraphSelection): void;
  onConfigureRelation?(relation: CadSketchDimensionRelation): void;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  readonly onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument?(document: CadDocument | null): void;
}
interface Intent { readonly point: CadSketchGraphPointControl; readonly translation: SketchPoint }
interface Drag {
  readonly point: CadSketchGraphPointControl; readonly pointerId: number; readonly element: SVGGElement;
  readonly clientX: number; readonly clientY: number; readonly step: number; readonly snap: boolean;
  readonly scaleX: number; readonly scaleY: number;
  moved: boolean; translation: SketchPoint;
}

function Boundary({ boundary, center }: { boundary: CadAnalyticBoundary; center: SketchPoint }) {
  return boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
    : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
      : <path d={cadArcSvgPath(boundary, center)} />;
}

/** Graph handles own individual points. Their solved preview never becomes accepted geometry. */
export function CadSketchGraphLayer({ controls, sketch, version, prepared, visual, center, scaleX, scaleY, gridStep, snap, active, locked, cancelSignal, onPendingChange, onError, filter = 'auto', pickAt, highlighted }: {
  controls: CadSketchGraphControls; sketch: CadSketchFeature; version?: string; prepared: Prepared; visual?: Prepared;
  center: SketchPoint; scaleX: number; scaleY: number; gridStep: number; snap: boolean; active: boolean; locked: boolean; cancelSignal: number;
  onPendingChange(pending: boolean): void; onError(message: string): void;
  filter?: CadSketchGraphPickFilter;
  pickAt?(event: { clientX: number; clientY: number }): CadSketchGraphSelection | null;
  highlighted?: CadSketchGraphSelection | null;
}) {
  const submission = useCadEditSubmission();
  const [intent, setIntent] = useState<Intent | null>(null);
  const drag = useRef<Drag | null>(null);
  const publishedPreview = useRef(false);
  const callbacks = useRef({ controls, onPendingChange, onError }); callbacks.current = { controls, onPendingChange, onError };
  const lastPreview = useRef<{ source: CadDocument; document: CadDocument } | null>(null);
  const release = useCallback(() => {
    const owned = drag.current; drag.current = null;
    try { if (owned?.element.hasPointerCapture?.(owned.pointerId)) owned.element.releasePointerCapture(owned.pointerId); } catch { /* Capture may already be released. */ }
  }, []);
  const cancel = useCallback(() => {
    release(); submission.cancel(); lastPreview.current = null; setIntent(null);
    callbacks.current.onPendingChange(false);
    if (publishedPreview.current) { publishedPreview.current = false; callbacks.current.controls.onPreviewDocument?.(null); }
  }, [release, submission.cancel]);
  const source = useRef({ document: controls.document, version, cancelSignal });
  useLayoutEffect(() => {
    const previous = source.current; source.current = { document: controls.document, version, cancelSignal };
    if (previous.document === controls.document && previous.version === version && previous.cancelSignal === cancelSignal) return;
    cancel();
    if (previous.document.id !== controls.document.id || previous.cancelSignal !== cancelSignal) callbacks.current.controls.onSelect(null);
  }, [controls.document, version, cancelSignal, cancel]);
  useEffect(() => { if (!active || locked) cancel(); }, [active, locked, cancel]);
  useEffect(() => {
    const blur = () => cancel(); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); release(); callbacks.current.onPendingChange(false); if (publishedPreview.current) callbacks.current.controls.onPreviewDocument?.(null); };
  }, [cancel, release]);
  const edits = useMemo<readonly CadEdit[] | null>(() => intent?.translation.some(value => value !== 0)
    ? [{ kind: 'move-sketch-point', sketchId: sketch.id, pointId: intent.point.id, translation: intent.translation }] : null, [intent, sketch.id]);
  const preview = useCadPreparedPreview(controls.document, edits, controls.onPrepareEdits, Boolean(intent && !submission.applying), 16);
  if (preview.kind === 'ready') lastPreview.current = { source: controls.document, document: preview.document };
  const previewDocument = intent && lastPreview.current?.source === controls.document ? lastPreview.current.document : null;
  useLayoutEffect(() => {
    if (previewDocument) { publishedPreview.current = true; controls.onPreviewDocument?.(previewDocument); }
    else if (publishedPreview.current) { publishedPreview.current = false; controls.onPreviewDocument?.(null); }
  }, [previewDocument, controls.onPreviewDocument]);
  const displayed = useMemo(() => {
    const candidate = previewDocument?.features.find(feature => feature.id === sketch.id);
    return candidate?.kind === 'sketch' && candidate.graph ? prepareCadSketchGraphInteraction(candidate.graph, previewDocument!.parameters) : visual ?? prepared;
  }, [previewDocument, sketch.id, visual, prepared]);
  const construction = useMemo(() => new Set(sketch.graph?.entities.filter(entity => entity.construction).map(entity => entity.id)), [sketch.graph]);
  const entities = useMemo(() => new Map(sketch.graph?.entities.map(entity => [entity.id, entity])), [sketch.graph]);
  const sourcePoints = useMemo(() => new Map(prepared.points.map(point => [point.id, point])), [prepared]);
  // Undo and selection cleanup can render one frame with an old inspector relation.
  const currentRelation = controls.relation && displayed.graph.relations.find(relation => relation.id === controls.relation?.id);
  const relatedPoints = new Set(controls.inspection?.pointIds ?? (currentRelation ? cadSketchRelationPointIds(displayed.graph, currentRelation) : []));
  const relatedEntities = new Set(controls.inspection?.entityIds ?? (currentRelation ? cadSketchRelationEntityIds(currentRelation) : []));
  const referenceCorners = new Set(displayed.graph.relations.filter(relation => relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner').map(relation => relation.pointId));
  const choose = (selection: CadSketchGraphSelection, additive = false) => {
    if (active && !locked && !submission.applying) {
      try { if (additive) controls.onSelect(selection, true); else controls.onSelect(selection); }
      catch (cause) { onError(cause instanceof Error ? cause.message : 'Unable to select this geometry.'); }
    }
  };
  const commit = (next: Intent) => {
    if (!next.translation.some(value => value !== 0)) { cancel(); return; }
    callbacks.current.onPendingChange(true); setIntent(next);
    submission.submit(signal => controls.onEditMany([{ kind: 'move-sketch-point', sketchId: sketch.id, pointId: next.point.id, translation: next.translation }], signal), cancel,
      error => { cancel(); callbacks.current.onError(error instanceof Error ? error.message : 'Unable to move this sketch point.'); });
  };
  const move = (event: PointerEvent<SVGGElement>, released = false) => {
    const owned = drag.current;
    if (!owned || owned.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!released && !(event.buttons & 1)) { cancel(); return; }
    if (!owned.moved && Math.hypot(event.clientX - owned.clientX, event.clientY - owned.clientY) <= 4) return;
    owned.moved = true;
    const target = snapSketchPoint([owned.point.position[0] + (event.clientX - owned.clientX) * owned.scaleX,
      owned.point.position[1] - (event.clientY - owned.clientY) * owned.scaleY], owned.step, owned.snap);
    owned.translation = cadSketchGraphPointTranslation(owned.point, target);
    setIntent(current => current && current.translation.every((value, index) => value === owned.translation[index]) ? current : { point: owned.point, translation: owned.translation });
  };
  const interactive = active && !locked && !submission.applying;
  const edgesInteractive = interactive && filter !== 'points', pointsInteractive = interactive && filter !== 'edges';
  const selected = (kind: CadSketchGraphSelection['kind'], id: string) => controls.selection.some(selection => selection.kind === kind && selection.id === id);
  const focusTarget = (element: SVGGElement, target: CadSketchGraphSelection) => element.closest('.cad-sketch-graph')?.querySelector<SVGGElement>(`[data-cad-sketch-${target.kind === 'point' ? 'point' : 'entity'}="${target.id}"]`)?.focus({ preventScroll: true });
  const clickTarget = (event: MouseEvent<SVGGElement>, target: CadSketchGraphSelection, eligible: boolean) => {
    if (!active) return;
    if (event.detail === 0) { if (eligible) { event.stopPropagation(); choose(target, event.shiftKey); } }
    else if (pickAt ? pickAt(event) : eligible) event.stopPropagation();
  };
  return <g className="cad-sketch-graph" onKeyDown={event => { if (event.key === 'Escape' && (drag.current || intent || submission.applying)) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    {displayed.geometry.segments.map((segment, index) => {
      const boundary = cadSketchGraphBoundary(segment), isSelected = selected('entity', segment.id);
      const entity = entities.get(segment.id);
      const related = relatedEntities.has(segment.id) || entity?.kind === 'line' && relatedPoints.has(entity.startPointId) && relatedPoints.has(entity.endPointId);
      return <g key={segment.id} data-cad-sketch-entity={segment.id} className={`cad-profile cad-sketch-entity${isSelected ? ' is-selected' : ''}${related ? ' is-relation-highlighted' : ''}${highlighted?.kind === 'entity' && highlighted.id === segment.id ? ' is-pick-highlighted' : ''}${construction.has(segment.id) ? ' is-construction' : ''}`}
        role="button" aria-label={`${segment.kind[0].toUpperCase()}${segment.kind.slice(1)} ${index + 1} in ${sketch.name}`} aria-pressed={isSelected} aria-disabled={!edgesInteractive || undefined} tabIndex={edgesInteractive ? 0 : -1}
        strokeDasharray={construction.has(segment.id) ? `${scaleY * 6} ${scaleY * 4}` : undefined}
        onPointerDown={event => { if (event.button !== 0 || !active) return; const target = pickAt ? pickAt(event) : filter === 'points' ? null : { kind: 'entity' as const, id: segment.id }; if (!target) return; event.stopPropagation(); if (event.isPrimary === false || drag.current || !interactive) return; event.preventDefault(); focusTarget(event.currentTarget, target); choose(target, event.shiftKey); }}
        onClick={event => clickTarget(event, { kind: 'entity', id: segment.id }, edgesInteractive)}
        onKeyDown={event => {
          if (!edgesInteractive || drag.current || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose({ kind: 'entity', id: segment.id }, event.shiftKey); }
          else if (event.key === 'Delete' && controls.onDelete) { event.preventDefault(); event.stopPropagation(); controls.onDelete({ kind: 'entity', id: segment.id }); }
        }}>
        <Boundary boundary={boundary} center={center} />
        {active && <g className="cad-sketch-entity-hit" strokeWidth={12 * scaleY}><Boundary boundary={boundary} center={center} /></g>}
      </g>;
    })}
    {active && displayed.points.map((point, index) => {
      const original = sourcePoints.get(point.id) ?? point;
      // Numeric coordinates allow a move request; they do not establish this point's freedom.
      const coordinateDriven = !original.freeAxes.some(Boolean), canRequestMove = controls.degreesOfFreedom !== 0 && !coordinateDriven;
      const movementHint = coordinateDriven ? 'Coordinates follow dimensions or expressions' : controls.degreesOfFreedom === 0
        ? 'Fully constrained by dimensions and relations' : `Movement follows dimensions and relations${original.freeAxes.every(Boolean) ? '' : ` · ${original.freeAxes[0] ? 'Y' : 'X'} coordinate is driven`}`;
      const referenceCorner = referenceCorners.has(point.id), x = point.position[0] - center[0], y = point.position[1] - center[1];
      return <g key={point.id} data-cad-sketch-point={point.id} data-cad-reference-corner={referenceCorner || undefined} role="button" aria-label={`${referenceCorner ? 'Reference corner' : 'Point'} ${index + 1} in ${sketch.name}`} aria-pressed={selected('point', point.id)} aria-disabled={!pointsInteractive || undefined}
        tabIndex={pointsInteractive ? 0 : -1} className={`cad-sketch-graph-point${selected('point', point.id) ? ' is-active' : ''}${relatedPoints.has(point.id) ? ' is-relation-highlighted' : ''}${highlighted?.kind === 'point' && highlighted.id === point.id ? ' is-pick-highlighted' : ''}${canRequestMove ? '' : ' is-locked'}`}
        onPointerDown={event => {
          if (event.button !== 0 || !active) return;
          const target = pickAt ? pickAt(event) : filter === 'edges' ? null : { kind: 'point' as const, id: point.id };
          if (!target) return;
          event.stopPropagation(); if (event.isPrimary === false || drag.current || !interactive) return;
          event.preventDefault(); focusTarget(event.currentTarget, target); choose(target, event.shiftKey);
          if (target.kind !== 'point' || target.id !== point.id) return;
          if (event.shiftKey || controls.selection.length > 1 || !canRequestMove) return;
          callbacks.current.onPendingChange(true);
          drag.current = { point: original, pointerId: event.pointerId, element: event.currentTarget, clientX: event.clientX, clientY: event.clientY, step: gridStep, snap, scaleX, scaleY, moved: false, translation: [0, 0] };
          setIntent({ point: original, translation: [0, 0] });
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { cancel(); }
        }}
        onPointerMove={move} onPointerUp={event => {
          const owned = drag.current; if (!owned || owned.pointerId !== event.pointerId) return;
          event.preventDefault(); event.stopPropagation(); if (event.button === 0) move(event, true); release();
          if (event.button === 0 && owned.moved) commit({ point: owned.point, translation: owned.translation }); else cancel();
        }} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) { event.stopPropagation(); cancel(); } }}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
        onClick={event => clickTarget(event, { kind: 'point', id: point.id }, pointsInteractive)}
        onKeyDown={event => {
          if (!pointsInteractive || drag.current || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose({ kind: 'point', id: point.id }, event.shiftKey); return; }
          if (event.key === 'Delete' && controls.onDelete) { event.preventDefault(); event.stopPropagation(); controls.onDelete({ kind: 'point', id: point.id }); return; }
          const step = gridStep * (event.shiftKey ? 10 : 1);
          const delta: SketchPoint | null = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, step] : event.key === 'ArrowDown' ? [0, -step] : null;
          if (!delta) return;
          event.preventDefault(); event.stopPropagation(); if (controls.selection.length > 1) return; choose({ kind: 'point', id: point.id });
          if (canRequestMove) commit({ point: original, translation: cadSketchGraphPointTranslation(original, [original.position[0] + delta[0], original.position[1] + delta[1]]) });
        }}>
        <circle cx={point.position[0] - center[0]} cy={point.position[1] - center[1]} r={7 * scaleY} className="cad-sketch-point-hit" />
        {referenceCorner ? <path d={`M ${x} ${y + 4 * scaleY} L ${x + 4 * scaleX} ${y} L ${x} ${y - 4 * scaleY} L ${x - 4 * scaleX} ${y} Z`} className="cad-sketch-point-mark" />
          : <circle cx={x} cy={y} r={3 * scaleY} className="cad-sketch-point-mark" />}
        <title>{referenceCorner ? 'Original reference corner · ' : ''}{formatCadQuantity(point.position[0])}, {formatCadQuantity(point.position[1])} mm · {movementHint}</title>
      </g>;
    })}
    {active && controls.showDimensions !== false && <CadSketchGraphDimensions graph={displayed.graph} parameters={displayed.parameters} center={center} mmPerPixel={scaleY}
      selectedRelationId={controls.relation?.id} interactive={interactive && !drag.current && Boolean(controls.onConfigureRelation)} onConfigure={relation => controls.onConfigureRelation?.(relation)} />}
    {intent && drag.current?.moved && <circle className={`cad-sketch-drag-target${preview.kind === 'error' ? ' is-invalid' : ''}`} cx={intent.point.position[0] + intent.translation[0] - center[0]} cy={intent.point.position[1] + intent.translation[1] - center[1]} r={5 * scaleY}><title>{preview.kind === 'error' ? preview.message : 'Drag target'}</title></circle>}
  </g>;
}
