import { userFacingMessage } from '@/lib/userMessage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type MouseEvent } from 'react';
import type { CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadEdit } from '@/domain/cad/cadOperations';
import type { CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchEntityPointIds, cadSketchRelationEntityIds, cadSketchRelationPointIds } from '@/domain/cad/cadSketchGraphReferences';
import type { CadAnalyticBoundary } from '@/domain/cad/cadSketchGeometry';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { cadPathClosureTolerance } from '@/domain/cad/cadAnalyticSegments';
import { cadSketchGraphCircleControl, cadSketchGraphCircleRadiusEdit, cadSketchGraphPointTranslation, prepareCadSketchGraphInteraction, type CadSketchGraphPointControl, type CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { DRAG_GRID_CATCH_PIXELS, magnetSketchPoint, magnetSketchValue, type SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { formatCadQuantity } from './cadDisplayQuantity';
import { CadSketchGraphDimensions } from './CadSketchGraphDimensions';
import type { CadSketchDimensionRelation } from './cadSketchGraphDimensionLayout';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadContinuousPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { cadSketchGeometryPickAllows, type CadSketchDatum, type CadSketchGeometryPick, type CadSketchGraphPickFilter } from './cadSketchGraphSelection';
import { cadSketchSnapTargetLabel, type CadSketchSnapCandidate } from './cadSketchGeometrySnaps';
import { cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { CadSketchSnapHint } from './CadSketchSnapHint';

type Prepared = ReturnType<typeof prepareCadSketchGraphInteraction>;
export interface CadSketchGraphControls {
  readonly document: CadDocument;
  readonly selection: readonly CadSketchGraphSelection[];
  readonly relation?: CadSketchGraphRelation | null;
  readonly inspection?: { readonly pointIds: readonly string[]; readonly entityIds: readonly string[] } | null;
  readonly degreesOfFreedom?: number | null;
  readonly showDimensions?: boolean;
  readonly geometryPick?: CadSketchGeometryPick;
  readonly positionPick?: { readonly label: string; onPick(point: SketchPoint): void; onCancel(): void };
  readonly placement?: { readonly anchor: SketchPoint | null; readonly target: SketchPoint | null; readonly angleDegrees: number };
  readonly patternInteraction?: import('./CadSketchLinearPatternEditor').CadSketchLinearPatternInteraction;
  onEditPattern?(relationId: string): void;
  onSelect(selection: CadSketchGraphSelection | null, additive?: boolean): void;
  onSelectSet?(selections: readonly CadSketchGraphSelection[]): void;
  /** Plane references in the plain selection, beside the sketch geometry; a command pick lists its own. */
  readonly datumSelection?: readonly CadSketchDatum[];
  onSelectDatum?(datum: CadSketchDatum, additive: boolean): void;
  onDelete?(selection: CadSketchGraphSelection): void;
  onConfigureRelation?(relation: CadSketchDimensionRelation): void;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  readonly onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument?(document: CadDocument | null): void;
}
type CircleControl = ReturnType<typeof cadSketchGraphCircleControl>;
type Intent = { readonly kind: 'point'; readonly point: CadSketchGraphPointControl; readonly translation: SketchPoint; readonly snap: CadSketchSnapCandidate | null }
  | { readonly kind: 'radius'; readonly circle: CircleControl; readonly radius: number }
  | { readonly kind: 'translate'; readonly selections: readonly CadSketchGraphSelection[]; readonly anchor: SketchPoint; readonly translation: SketchPoint };
interface DragFrame {
  readonly pointerId: number; readonly element: SVGGElement;
  readonly clientX: number; readonly clientY: number; readonly step: number; readonly snap: boolean; readonly gridSnap: boolean;
  readonly scaleX: number; readonly scaleY: number;
  cursor: SketchPoint; suppressed: boolean;
  moved: boolean;
  /** A press on an item that is already part of a multi-selection keeps the set for dragging; a plain click still selects the item alone. */
  readonly pick?: CadSketchGraphSelection;
}
type Drag = DragFrame & ({ readonly kind: 'point'; readonly point: CadSketchGraphPointControl; readonly prepared: Prepared; readonly guides: readonly SketchPoint[]; translation: SketchPoint; candidate: CadSketchSnapCandidate | null }
  | { readonly kind: 'radius'; readonly circle: CircleControl; radius: number }
  | { readonly kind: 'translate'; readonly selections: readonly CadSketchGraphSelection[]; readonly anchor: SketchPoint; readonly normal: SketchPoint | null; translation: SketchPoint });

/** The far ends of the lines that meet at a point, which a drag can line up with. */
function lineNeighbours(prepared: Prepared, pointId: string): readonly SketchPoint[] {
  const ids = prepared.graph.entities.flatMap(entity => entity.kind !== 'line' ? [] : entity.startPointId === pointId ? [entity.endPointId] : entity.endPointId === pointId ? [entity.startPointId] : []);
  return prepared.points.filter(point => ids.includes(point.id) && point.id !== pointId).map(point => point.position);
}
/** Exact translation accepts at most this many selections at once. */
const MAX_TRANSLATED_SELECTIONS = 64;

function Boundary({ boundary, center }: { boundary: CadAnalyticBoundary; center: SketchPoint }) {
  return boundary.type === 'line' ? <line x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]} x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
    : boundary.type === 'circle' ? <circle cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />
      : <path d={cadArcSvgPath(boundary, center)} />;
}

/** Point and size handles share one gesture owner; solved previews never become accepted geometry. */
export function CadSketchGraphLayer({ controls, sketch, version, prepared, visual, center, scaleX, scaleY, gridStep, snap, gridSnap = false, active, locked, cancelSignal, onPendingChange, onError, filter = 'auto', pickAt, highlighted }: {
  controls: CadSketchGraphControls; sketch: CadSketchFeature; version?: string; prepared: Prepared; visual?: Prepared;
  center: SketchPoint; scaleX: number; scaleY: number; gridStep: number; snap: boolean; gridSnap?: boolean; active: boolean; locked: boolean; cancelSignal: number;
  onPendingChange(pending: boolean): void; onError(message: string): void;
  filter?: CadSketchGraphPickFilter;
  pickAt?(event: { clientX: number; clientY: number }): CadSketchGraphSelection | null;
  highlighted?: CadSketchGraphSelection | null;
}) {
  const submission = useCadEditSubmission();
  const [intent, setIntent] = useState<Intent | null>(null);
  const drag = useRef<Drag | null>(null);
  const callbacks = useRef({ controls, onPendingChange, onError }); callbacks.current = { controls, onPendingChange, onError };
  const lastPreview = useRef<{ source: CadDocument; document: CadDocument } | null>(null);
  const release = useCallback(() => {
    const owned = drag.current; drag.current = null;
    try { if (owned?.element.hasPointerCapture?.(owned.pointerId)) owned.element.releasePointerCapture(owned.pointerId); } catch { /* Capture may already be released. */ }
  }, []);
  const cancel = useCallback(() => {
    release(); submission.cancel(); lastPreview.current = null; setIntent(null);
    callbacks.current.onPendingChange(false);
  }, [release, submission.cancel]);
  const frame = `${center[0]},${center[1]},${scaleX},${scaleY},${filter}`;
  const source = useRef({ document: controls.document, version, cancelSignal, frame, prepared, sketchId: sketch.id });
  useLayoutEffect(() => {
    const previous = source.current; source.current = { document: controls.document, version, cancelSignal, frame, prepared, sketchId: sketch.id };
    if (previous.document === controls.document && previous.version === version && previous.cancelSignal === cancelSignal
      && previous.frame === frame && previous.prepared === prepared && previous.sketchId === sketch.id) return;
    cancel();
    if (previous.document.id !== controls.document.id || previous.cancelSignal !== cancelSignal) callbacks.current.controls.onSelect(null);
  }, [controls.document, version, cancelSignal, frame, prepared, sketch.id, cancel]);
  useEffect(() => { if (!active || locked) cancel(); }, [active, locked, cancel]);
  useEffect(() => {
    const blur = () => cancel(); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('blur', blur); release(); callbacks.current.onPendingChange(false); };
  }, [cancel, release]);
  const updateDrag = useCallback((owned: Drag) => {
    if (!owned.moved) return;
    // Geometry targets follow Snap; grid nodes catch only when grid snapping is switched on.
    const enabled = owned.snap && !owned.suppressed, grid = owned.gridSnap && !owned.suppressed, catchRadius = DRAG_GRID_CATCH_PIXELS * Math.max(owned.scaleX, owned.scaleY);
    if (owned.kind === 'translate') {
      const raw: SketchPoint = [owned.cursor[0] - owned.anchor[0], owned.cursor[1] - owned.anchor[1]], normal = owned.normal;
      const distance = normal ? magnetSketchValue(raw[0] * normal[0] + raw[1] * normal[1], owned.step, grid, catchRadius) : 0;
      const translation = normal ? [normal[0] * distance, normal[1] * distance] as const : magnetSketchPoint(raw, owned.step, grid, catchRadius);
      owned.translation = translation;
      setIntent(current => current?.kind === 'translate' && current.translation[0] === translation[0] && current.translation[1] === translation[1] ? current
        : { kind: 'translate', selections: owned.selections, anchor: owned.anchor, translation });
      return;
    }
    if (owned.kind === 'radius') {
      const distance = Math.hypot(owned.cursor[0] - owned.circle.center[0], owned.cursor[1] - owned.circle.center[1]);
      owned.radius = magnetSketchValue(distance, owned.step, grid, catchRadius);
      setIntent(current => current?.kind === 'radius' && Object.is(current.radius, owned.radius) ? current : { kind: 'radius', circle: owned.circle, radius: owned.radius });
      return;
    }
    // Edges, axes and the origin attract the point as they do while drawing; its line neighbours offer horizontal and vertical guides.
    const result = enabled ? owned.prepared.snap({ cursor: owned.cursor, mmPerPixel: [owned.scaleX, owned.scaleY], excludePointIds: [owned.point.id], references: true, alignTo: owned.guides }) : null;
    let candidate = result?.kind === 'hit' ? result.candidate : null;
    if (candidate) {
      const target = candidate.point;
      const tolerance = cadPathClosureTolerance([{ x: owned.point.position[0], y: owned.point.position[1] }, { x: target[0], y: target[1] }]);
      if (owned.point.freeAxes.some((free, axis) => !free && Math.abs(target[axis] - owned.point.position[axis]) > tolerance)) candidate = null;
    }
    owned.candidate = candidate;
    const target = candidate?.point ?? magnetSketchPoint(owned.cursor, owned.step, grid, catchRadius);
    owned.translation = cadSketchGraphPointTranslation(owned.point, target);
    const key = (snap: CadSketchSnapCandidate | null) => !snap ? '' : `${snap.target.kind}:${snap.target.kind === 'midpoint' ? snap.target.entityId : 'pointId' in snap.target ? snap.target.pointId : ''}`;
    setIntent(current => current?.kind === 'point' && current.translation.every((value, index) => value === owned.translation[index]) && key(current.snap) === key(candidate)
      ? current : { kind: 'point', point: owned.point, translation: owned.translation, snap: candidate });
  }, []);
  useEffect(() => {
    const modifier = (event: KeyboardEvent) => {
      const owned = drag.current;
      if (!owned || event.isComposing || (event.key !== 'Control' && event.key !== 'Meta')) return;
      owned.suppressed = event.ctrlKey || event.metaKey;
      updateDrag(owned);
    };
    window.addEventListener('keydown', modifier); window.addEventListener('keyup', modifier);
    return () => { window.removeEventListener('keydown', modifier); window.removeEventListener('keyup', modifier); };
  }, [updateDrag]);
  const editFor = useCallback((next: Intent): CadEdit | null => next.kind === 'translate'
    ? next.translation.some(value => value !== 0) ? { kind: 'translate-sketch-geometry', sketchId: sketch.id, selections: next.selections, translation: next.translation } : null
    : next.kind === 'point'
    ? next.translation.some(value => value !== 0) ? { kind: 'move-sketch-point', sketchId: sketch.id, pointId: next.point.id, translation: next.translation } : null
    : next.radius === next.circle.radius ? null : cadSketchGraphCircleRadiusEdit(sketch, controls.document.parameters, next.circle.entityId, next.radius), [sketch, controls.document.parameters]);
  const candidate = useMemo(() => {
    try { const edit = intent ? editFor(intent) : null; return { edits: edit ? [edit] : null, issue: null }; }
    catch (cause) { return { edits: null, issue: userFacingMessage(cause, 'Invalid circle radius.') }; }
  }, [intent, editFor]);
  const edits = candidate.edits;
  // A drag solves continuously and draws its result here only; publishing every frame would re-render the whole workbench.
  const preview = useCadContinuousPreview(controls.document, edits, controls.onPrepareEdits, Boolean(intent && !submission.applying));
  if (!edits) lastPreview.current = null;
  if (preview.kind === 'ready') lastPreview.current = { source: controls.document, document: preview.document };
  const previewDocument = intent && lastPreview.current?.source === controls.document ? lastPreview.current.document : null;
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
  // Vertices stay quiet until they matter: free points, selected geometry, relations, picks, hover and keyboard focus reveal them.
  const supportedPoints = useMemo(() => new Set(displayed.graph.entities.flatMap(cadSketchEntityPointIds)), [displayed.graph.entities]);
  const pointUses = useMemo(() => {
    const uses = new Map<string, number>();
    for (const entity of prepared.graph.entities) for (const id of new Set(cadSketchEntityPointIds(entity))) uses.set(id, (uses.get(id) ?? 0) + 1);
    return uses;
  }, [prepared.graph.entities]);
  const selectionPoints = new Set(controls.selection.flatMap(selection => {
    const entity = selection.kind === 'entity' ? displayed.graph.entities.find(candidate => candidate.id === selection.id) : undefined;
    return entity ? cadSketchEntityPointIds(entity) : [];
  }));
  const choose = (selection: CadSketchGraphSelection, additive = false) => {
    if (active && !locked && !submission.applying) {
      if (controls.geometryPick) {
        if (cadSketchGeometryPickAllows(controls.geometryPick, selection)) controls.geometryPick.onPick(selection);
        return;
      }
      try { if (additive) controls.onSelect(selection, true); else controls.onSelect(selection); }
      catch (cause) { onError(userFacingMessage(cause, 'Unable to select this geometry.')); }
    }
  };
  const commit = (next: Intent) => {
    let edit: CadEdit | null;
    try { edit = editFor(next); } catch (cause) { cancel(); callbacks.current.onError(userFacingMessage(cause, 'Unable to resize this circle.')); return; }
    if (!edit) { cancel(); return; }
    callbacks.current.onPendingChange(true); setIntent(next);
    submission.submit(signal => controls.onEditMany([edit], signal), cancel,
      error => { cancel(); callbacks.current.onError(userFacingMessage(error, 'Unable to edit this sketch geometry.')); });
  };
  const move = (event: PointerEvent<SVGGElement>, released = false) => {
    const owned = drag.current;
    if (!owned || owned.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (!released && !(event.buttons & 1)) { cancel(); return; }
    if (!owned.moved && Math.hypot(event.clientX - owned.clientX, event.clientY - owned.clientY) <= 4) return;
    owned.moved = true;
    const origin = owned.kind === 'point' ? owned.point.position : owned.kind === 'translate' ? owned.anchor : [owned.circle.center[0] + owned.circle.radius, owned.circle.center[1]];
    owned.cursor = [origin[0] + (event.clientX - owned.clientX) * owned.scaleX,
      origin[1] - (event.clientY - owned.clientY) * owned.scaleY];
    owned.suppressed = event.ctrlKey || event.metaKey;
    updateDrag(owned);
  };
  const endDrag = (event: PointerEvent<SVGGElement>) => {
    const owned = drag.current; if (!owned || owned.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation(); if (event.button === 0) move(event, true); release();
    if (event.button === 0 && owned.moved) commit(owned.kind === 'point' ? { kind: 'point', point: owned.point, translation: owned.translation, snap: owned.candidate }
      : owned.kind === 'translate' ? { kind: 'translate', selections: owned.selections, anchor: owned.anchor, translation: owned.translation }
      : { kind: 'radius', circle: owned.circle, radius: owned.radius });
    else { cancel(); if (event.button === 0 && owned.pick) choose(owned.pick); }
  };
  const interactive = active && !locked && !submission.applying;
  const snapCandidate = intent?.kind === 'point' ? intent.snap : null;
  const solvedPoint = preview.kind === 'ready' && !preview.stale && intent?.kind === 'point' ? displayed.points.find(point => point.id === intent.point.id) : null;
  const attained = Boolean(snapCandidate && solvedPoint && Math.hypot(solvedPoint.position[0] - snapCandidate.point[0], solvedPoint.position[1] - snapCandidate.point[1])
    <= cadPathClosureTolerance([{ x: solvedPoint.position[0], y: solvedPoint.position[1] }, { x: snapCandidate.point[0], y: snapCandidate.point[1] }]));
  const limited = Boolean(snapCandidate && !preview.stale && (preview.kind === 'error' || preview.kind === 'ready' && !attained));
  const snapLabel = snapCandidate ? `${cadSketchSnapTargetLabel(snapCandidate.target)} · ${limited ? 'Constraints limit movement' : 'No relation'}` : '';
  const edgesInteractive = interactive && filter !== 'points', pointsInteractive = interactive && filter !== 'edges';
  const singleEntity = controls.selection.length === 1 && controls.selection[0].kind === 'entity' ? entities.get(controls.selection[0].id) : null;
  const circle = singleEntity?.kind === 'circle' ? cadSketchGraphCircleControl(prepared.graph, prepared.parameters, singleEntity.id) : null;
  const shownCircle = circle && displayed.graph.entities.some(entity => entity.id === circle.entityId && entity.kind === 'circle')
    ? cadSketchGraphCircleControl(displayed.graph, displayed.parameters, circle.entityId) : null;
  const radiusGripOffset = shownCircle ? Math.max(shownCircle.radius, 16 * Math.max(scaleX, scaleY)) : 0;
  const radiusGripX = shownCircle ? shownCircle.center[0] + radiusGripOffset - center[0] : 0;
  const radiusInteractive = edgesInteractive && !controls.geometryPick && circle?.lockedReason === null && controls.degreesOfFreedom !== 0;
  const selected = (kind: CadSketchGraphSelection['kind'], id: string) => controls.selection.some(selection => selection.kind === kind && selection.id === id);
  const focusTarget = (element: SVGGElement, target: CadSketchGraphSelection) => element.closest('.cad-sketch-graph')?.querySelector<SVGGElement>(`[data-cad-sketch-${target.kind === 'point' ? 'point' : 'entity'}="${target.id}"]`)?.focus({ preventScroll: true });
  /** Pressing an item of the current multi-selection drags the whole set; a click without movement narrows to the item. */
  const grabsSelection = (target: CadSketchGraphSelection, additive: boolean) => !additive && !controls.geometryPick && controls.selection.length > 1
    && controls.selection.length <= MAX_TRANSLATED_SELECTIONS && selected(target.kind, target.id);
  const startTranslate = (event: PointerEvent<SVGGElement>, selections: readonly CadSketchGraphSelection[], anchor: SketchPoint, normal: SketchPoint | null, pick?: CadSketchGraphSelection) => {
    callbacks.current.onPendingChange(true);
    drag.current = { kind: 'translate', selections, anchor, normal, translation: [0, 0], pick, pointerId: event.pointerId, element: event.currentTarget, clientX: event.clientX, clientY: event.clientY,
      step: gridStep, snap, gridSnap, scaleX, scaleY, cursor: anchor, suppressed: event.ctrlKey || event.metaKey, moved: false };
    setIntent({ kind: 'translate', selections, anchor, translation: [0, 0] });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { cancel(); }
  };
  /** The pressed sketch position, so the drag marker sits under the pointer; tests without layout fall back to the edge's own anchor. */
  const pressedPoint = (event: PointerEvent<SVGGElement>, fallback: SketchPoint): SketchPoint => {
    const matrix = event.currentTarget.getScreenCTM?.();
    if (!matrix) return fallback;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return Number.isFinite(local.x) && Number.isFinite(local.y) ? [local.x + center[0], local.y + center[1]] : fallback;
  };
  const clickTarget = (event: MouseEvent<SVGGElement>, target: CadSketchGraphSelection, eligible: boolean) => {
    if (!active) return;
    if (event.detail === 0) { if (eligible) { event.stopPropagation(); choose(target, event.shiftKey); } }
    else if (pickAt ? pickAt(event) : eligible) event.stopPropagation();
  };
  return <g className={`cad-sketch-graph${interactive && !controls.geometryPick ? ' is-draggable' : ''}${intent && !submission.applying ? ' is-dragging' : ''}`} onKeyDown={event => { if (event.key === 'Escape' && (drag.current || intent || submission.applying)) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    {displayed.geometry.segments.map((segment, index) => {
      const boundary = cadSketchGraphBoundary(segment), isSelected = selected('entity', segment.id);
      const entity = entities.get(segment.id);
      const related = relatedEntities.has(segment.id) || entity?.kind === 'line' && relatedPoints.has(entity.startPointId) && relatedPoints.has(entity.endPointId);
      const snapHighlighted = snapCandidate?.entityIds.includes(segment.id);
      const edgeInteractive = edgesInteractive && (!controls.geometryPick || controls.geometryPick.eligibleEntityIds.includes(segment.id));
      return <g key={segment.id} data-cad-sketch-entity={segment.id} className={`cad-profile cad-sketch-entity${isSelected ? ' is-selected' : ''}${related ? ' is-relation-highlighted' : ''}${snapHighlighted || highlighted?.kind === 'entity' && highlighted.id === segment.id ? ' is-pick-highlighted' : ''}${construction.has(segment.id) ? ' is-construction' : ''}`}
        role="button" aria-label={`${segment.kind[0].toUpperCase()}${segment.kind.slice(1)} ${index + 1} in ${sketch.name}`} aria-pressed={isSelected} aria-disabled={!edgeInteractive || undefined} tabIndex={edgeInteractive ? 0 : -1}
        strokeDasharray={construction.has(segment.id) ? `${scaleY * 6} ${scaleY * 4}` : undefined}
        onPointerDown={event => {
          if (event.button !== 0 || !edgeInteractive) return; const target = pickAt ? pickAt(event) : { kind: 'entity' as const, id: segment.id }; if (!target) return;
          event.stopPropagation(); if (event.isPrimary === false || drag.current) return; event.preventDefault(); focusTarget(event.currentTarget, target);
          const own = target.kind === 'entity' && target.id === segment.id, grouped = own && grabsSelection(target, event.shiftKey);
          if (!grouped) choose(target, event.shiftKey);
          if (!own || !interactive || controls.geometryPick || event.shiftKey || controls.degreesOfFreedom === 0) return;
          const anchor = pressedPoint(event, boundary.type === 'line' ? [(boundary.start.x + boundary.end.x) / 2, (boundary.start.y + boundary.end.y) / 2] : [boundary.center.x, boundary.center.y]);
          if (grouped) { startTranslate(event, controls.selection, anchor, null, target); return; }
          // A connected line slides along its normal and stretches its neighbours; free edges, arcs and circles move as they are.
          const length = boundary.type === 'line' ? Math.hypot(boundary.end.x - boundary.start.x, boundary.end.y - boundary.start.y) : 0;
          const connected = entity?.kind === 'line' && [entity.startPointId, entity.endPointId].some(id => (pointUses.get(id) ?? 0) > 1);
          startTranslate(event, [target], anchor, boundary.type === 'line' && connected && length > 0 ? [-(boundary.end.y - boundary.start.y) / length, (boundary.end.x - boundary.start.x) / length] : null);
        }}
        onPointerMove={move} onPointerUp={endDrag} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) { event.stopPropagation(); cancel(); } }}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
        onClick={event => clickTarget(event, { kind: 'entity', id: segment.id }, edgeInteractive)}
        onKeyDown={event => {
          if (!edgeInteractive || drag.current || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose({ kind: 'entity', id: segment.id }, event.shiftKey); }
          else if (event.key === 'Delete' && !controls.geometryPick && controls.onDelete) { event.preventDefault(); event.stopPropagation(); controls.onDelete({ kind: 'entity', id: segment.id }); }
        }}>
        <Boundary boundary={boundary} center={center} />
        {active && <g className="cad-sketch-entity-hit" strokeWidth={12 * scaleY}><Boundary boundary={boundary} center={center} /></g>}
      </g>;
    })}
    {displayed.points.map((point, index) => {
      const original = sourcePoints.get(point.id) ?? point;
      // Numeric coordinates allow a move request; they do not establish this point's freedom.
      const coordinateDriven = !original.freeAxes.some(Boolean), canRequestMove = controls.degreesOfFreedom !== 0 && !coordinateDriven;
      const movementHint = cadSketchLinearPatternLockReason(prepared.graph, {kind:'point',id:point.id}) ?? (coordinateDriven ? 'Coordinates follow dimensions or expressions' : controls.degreesOfFreedom === 0
        ? 'Fully constrained by dimensions and relations' : `Movement follows dimensions and relations${original.freeAxes.every(Boolean) ? '' : ` · ${original.freeAxes[0] ? 'Y' : 'X'} coordinate is driven`}`);
      const pointInteractive = pointsInteractive && (!controls.geometryPick || controls.geometryPick.eligiblePointIds.includes(point.id));
      const referenceCorner = referenceCorners.has(point.id), x = point.position[0] - center[0], y = point.position[1] - center[1];
      const snapTarget = snapCandidate?.target;
      const snapHighlighted = snapTarget && 'pointId' in snapTarget && snapTarget.pointId === point.id;
      const revealed = filter === 'points' || !supportedPoints.has(point.id) || selectionPoints.has(point.id) || selected('point', point.id) || relatedPoints.has(point.id)
        || snapHighlighted || highlighted?.kind === 'point' && highlighted.id === point.id;
      return <g key={point.id} data-cad-sketch-point={point.id} data-cad-reference-corner={referenceCorner || undefined} role="button" aria-label={`${referenceCorner ? 'Reference corner' : 'Point'} ${index + 1} in ${sketch.name}`} aria-pressed={selected('point', point.id)} aria-disabled={!pointInteractive || undefined} pointerEvents={active ? undefined : 'none'}
        tabIndex={pointInteractive ? 0 : -1} className={`cad-sketch-graph-point${revealed ? ' is-revealed' : ''}${selected('point', point.id) ? ' is-active' : ''}${relatedPoints.has(point.id) ? ' is-relation-highlighted' : ''}${snapHighlighted || highlighted?.kind === 'point' && highlighted.id === point.id ? ' is-pick-highlighted' : ''}${canRequestMove ? '' : ' is-locked'}`}
        onPointerDown={event => {
          if (event.button !== 0 || !pointInteractive) return;
          const target = pickAt ? pickAt(event) : { kind: 'point' as const, id: point.id };
          if (!target) return;
          event.stopPropagation(); if (event.isPrimary === false || drag.current || !interactive) return;
          event.preventDefault(); focusTarget(event.currentTarget, target);
          const own = target.kind === 'point' && target.id === point.id;
          if (own && grabsSelection(target, event.shiftKey) && controls.degreesOfFreedom !== 0) { startTranslate(event, controls.selection, original.position, null, target); return; }
          choose(target, event.shiftKey);
          if (controls.geometryPick || !own) return;
          if (event.shiftKey || !canRequestMove) return; // A plain pick above replaces the old set with this point.
          callbacks.current.onPendingChange(true);
          drag.current = { kind: 'point', point: original, pointerId: event.pointerId, element: event.currentTarget, clientX: event.clientX, clientY: event.clientY, step: gridStep, snap, gridSnap, scaleX, scaleY,
            prepared, guides: lineNeighbours(prepared, original.id), cursor: original.position, suppressed: event.ctrlKey || event.metaKey, moved: false, translation: [0, 0], candidate: null };
          setIntent({ kind: 'point', point: original, translation: [0, 0], snap: null });
          try { event.currentTarget.setPointerCapture(event.pointerId); } catch { cancel(); }
        }}
        onPointerMove={move} onPointerUp={endDrag} onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) { event.stopPropagation(); cancel(); } }}
        onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
        onClick={event => clickTarget(event, { kind: 'point', id: point.id }, pointInteractive)}
        onKeyDown={event => {
          if (!pointInteractive || drag.current || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); choose({ kind: 'point', id: point.id }, event.shiftKey); return; }
          if (controls.geometryPick) return;
          if (event.key === 'Delete' && controls.onDelete) { event.preventDefault(); event.stopPropagation(); controls.onDelete({ kind: 'point', id: point.id }); return; }
          const step = gridStep * (event.shiftKey ? 10 : 1);
          const delta: SketchPoint | null = event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowUp' ? [0, step] : event.key === 'ArrowDown' ? [0, -step] : null;
          if (!delta) return;
          event.preventDefault(); event.stopPropagation(); if (controls.selection.length > 1) return; choose({ kind: 'point', id: point.id });
          if (canRequestMove) commit({ kind: 'point', point: original, translation: cadSketchGraphPointTranslation(original, [original.position[0] + delta[0], original.position[1] + delta[1]]), snap: null });
        }}>
        <circle cx={point.position[0] - center[0]} cy={point.position[1] - center[1]} r={7 * scaleY} className="cad-sketch-point-hit" />
        {referenceCorner ? <path d={`M ${x} ${y + 4 * scaleY} L ${x + 4 * scaleX} ${y} L ${x} ${y - 4 * scaleY} L ${x - 4 * scaleX} ${y} Z`} className="cad-sketch-point-mark" />
          : <circle cx={x} cy={y} r={3 * scaleY} className="cad-sketch-point-mark" />}
        <title>{referenceCorner ? 'Original reference corner · ' : ''}{formatCadQuantity(point.position[0])}, {formatCadQuantity(point.position[1])} mm · {movementHint}</title>
      </g>;
    })}
    {circle && shownCircle && active && !controls.geometryPick && <g data-cad-sketch-circle-radius={circle.entityId} className={`cad-sketch-graph-point${radiusInteractive ? '' : ' is-locked'}`}
      role="button" aria-label={`Resize circle radius in ${sketch.name}`} aria-disabled={!radiusInteractive || undefined} tabIndex={radiusInteractive ? 0 : -1}
      onPointerDown={event => {
        if (event.button !== 0 || !active) return; event.stopPropagation();
        if (!radiusInteractive || event.isPrimary === false || drag.current) return;
        event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); choose({ kind: 'entity', id: circle.entityId }, event.shiftKey);
        if (event.shiftKey) return;
        callbacks.current.onPendingChange(true);
        drag.current = { kind: 'radius', circle, pointerId: event.pointerId, element: event.currentTarget, clientX: event.clientX, clientY: event.clientY,
          step: gridStep, snap, gridSnap, scaleX, scaleY, cursor: [circle.center[0] + circle.radius, circle.center[1]], suppressed: event.ctrlKey || event.metaKey, moved: false, radius: circle.radius };
        setIntent({ kind: 'radius', circle, radius: circle.radius });
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { cancel(); }
      }} onPointerMove={move} onPointerUp={endDrag}
      onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) { event.stopPropagation(); cancel(); } }}
      onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(); }}
      onClick={event => { if (active) event.stopPropagation(); }}
      onKeyDown={event => {
        if (!radiusInteractive || drag.current || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
        const sign = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
        if (!sign) return; event.preventDefault(); event.stopPropagation();
        commit({ kind: 'radius', circle, radius: circle.radius + sign * gridStep * (event.shiftKey ? 10 : 1) });
      }}>
      {radiusGripOffset > shownCircle.radius && <line x1={shownCircle.center[0] + shownCircle.radius - center[0]} y1={shownCircle.center[1] - center[1]}
        x2={radiusGripX} y2={shownCircle.center[1] - center[1]} stroke="var(--muted-foreground)" strokeWidth={scaleY} pointerEvents="none" />}
      <circle cx={radiusGripX} cy={shownCircle.center[1] - center[1]} r={7 * scaleY} className="cad-sketch-point-hit" />
      <path d={`M ${radiusGripX} ${shownCircle.center[1] - center[1] + 4 * scaleY} l ${4 * scaleX} ${-4 * scaleY} l ${-4 * scaleX} ${-4 * scaleY} l ${-4 * scaleX} ${4 * scaleY} Z`} className="cad-sketch-point-mark" />
      <title>{circle.lockedReason ?? (controls.degreesOfFreedom === 0 ? 'Fully constrained by dimensions and relations' : `Radius ${formatCadQuantity(shownCircle.radius)} mm · Drag to resize, or use arrow keys`)}</title>
    </g>}
    {active && controls.showDimensions !== false && <CadSketchGraphDimensions graph={displayed.graph} parameters={displayed.parameters} center={center} mmPerPixel={scaleY}
      selectedRelationId={controls.relation?.id} interactive={interactive && !controls.geometryPick && !drag.current && Boolean(controls.onConfigureRelation)} onConfigure={relation => controls.onConfigureRelation?.(relation)} />}
    {intent && drag.current?.moved && <circle className={`cad-sketch-drag-target${preview.kind === 'error' || candidate.issue ? ' is-invalid' : ''}`}
      cx={(intent.kind === 'point' ? intent.point.position[0] + intent.translation[0] : intent.kind === 'translate' ? intent.anchor[0] + intent.translation[0] : intent.circle.center[0] + intent.radius) - center[0]}
      cy={(intent.kind === 'point' ? intent.point.position[1] + intent.translation[1] : intent.kind === 'translate' ? intent.anchor[1] + intent.translation[1] : intent.circle.center[1]) - center[1]} r={5 * scaleY}>
      <title>{candidate.issue ?? (preview.kind === 'error' ? preview.message : 'Drag target')}</title></circle>}
    {snapCandidate && <CadSketchSnapHint candidate={snapCandidate} center={center} scaleX={scaleX} scaleY={scaleY} label={snapLabel} attained={attained} />}
  </g>;
}
