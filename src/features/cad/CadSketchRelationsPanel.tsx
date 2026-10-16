import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, ConfirmIcon, LinkIcon, MeasureIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationPointIds, mapCadSketchRelationScalars } from '@/domain/cad/cadSketchGraphReferences';
import { cadSketchExternalReferenceForSelection, cadSketchExternalReferenceLockReason } from '@/domain/cad/cadSketchExternalReferences';
import { reduceCadEditIntents, validateCadEditBatch, type CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadSketchLineAngleSectors, createCadSketchLineAngleRelation } from '@/domain/cad/cadSketchAngleRelations';
import { CadError } from '@/domain/cad/cadError';
import { CadScalarEditContext, ScalarField, SelectField, type CadScalarValueDraft } from './CadFields';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { formatCadQuantity } from './cadDisplayQuantity';
import { CadContextHelp } from './CadContextHelp';
import { CadSketchAngleSectors } from './CadSketchAngleSectors';
import { CadSketchSelectionMeasurements } from './CadSketchSelectionMeasurements';
import { CadSketchPreparationError, describeCadSketchConstraintSource, type CadSketchConstraintFeedback, type CadSketchConstraintFeedbackSubject } from './cadSketchConstraintFeedback';
import './cad-sketch-profile.css';

const entityPoints = (entity: CadSketchGraphEntity) => entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
  : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];
const relationLabels = {
  'fixed-point': 'Fixed point', distance: 'Length', coincident: 'Coincident', midpoint: 'Midpoint', horizontal: 'Horizontal', vertical: 'Vertical', 'external-reference': 'Linked reference',
  parallel: 'Parallel', perpendicular: 'Perpendicular', collinear: 'Collinear', 'equal-length': 'Equal length', 'equal-radius': 'Equal radius', 'line-angle': 'Angle', 'fillet-corner': 'Fillet', 'chamfer-corner': 'Chamfer'
} satisfies Record<Exclude<CadSketchGraphRelation['kind'], 'fixed-axis' | 'radial-size' | 'axis-distance'>, string>;
const relationLabel = (relation: CadSketchGraphRelation): string => relation.kind === 'fixed-axis' ? `Fix ${relation.axis.toUpperCase()}`
  : relation.kind === 'axis-distance' ? relation.axis === 'x' ? 'Horizontal distance' : 'Vertical distance'
    : relation.kind === 'radial-size' ? relation.quantity === 'radius' ? 'Radius' : 'Diameter' : relationLabels[relation.kind];
const samePair = (relation: CadSketchGraphRelation, pointIds: readonly [string, string]) => 'pointIds' in relation
  && relation.pointIds.includes(pointIds[0]) && relation.pointIds.includes(pointIds[1]);
const selectedPointPair = (selection: readonly CadSketchGraphSelection[]): readonly [string, string] | null => selection.length === 2
  && selection[0].kind === 'point' && selection[1].kind === 'point' && selection[0].id !== selection[1].id ? [selection[0].id, selection[1].id] : null;
function selectedPointLine(selection: readonly CadSketchGraphSelection[], graph: CadSketchGraph): { readonly pointId: string; readonly lineId: string } | null {
  if (selection.length !== 2) return null;
  const point = selection.find(atom => atom.kind === 'point'), edge = selection.find(atom => atom.kind === 'entity');
  const line = edge && graph.entities.find(entity => entity.id === edge.id);
  return point && line?.kind === 'line' && point.id !== line.startPointId && point.id !== line.endPointId ? { pointId: point.id, lineId: line.id } : null;
}
const selectedEntityPair = (selection: readonly CadSketchGraphSelection[], graph: CadSketchGraph, kind: 'line' | 'curve'): readonly [string, string] | null => selection.length === 2
  && selection.every(atom => atom.kind === 'entity' && graph.entities.some(entity => entity.id === atom.id && (kind === 'line' ? entity.kind === 'line' : entity.kind !== 'line')))
  && selection[0].id !== selection[1].id ? [selection[0].id, selection[1].id] : null;
const sameEntityPair = (relation: CadSketchGraphRelation, pair: readonly [string, string]) => {
  const ids = relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear' || relation.kind === 'equal-length' ? relation.lineIds
    : relation.kind === 'equal-radius' ? relation.curveIds : relation.kind === 'line-angle' ? relation.rays.map(ray => ray.lineId) : null;
  return Boolean(ids?.includes(pair[0]) && ids.includes(pair[1]));
};
function relationQuantity(value: CadScalar, parameters: CadDocument['parameters'], unit: 'mm' | 'deg' = 'mm'): string {
  try { return `${formatCadQuantity(evaluateCadScalar(value, parameters))}${unit === 'deg' ? '°' : ' mm'}`; }
  catch { return '—'; }
}
const distanceForPair = (graph: CadSketchGraph, pointIds: readonly [string, string], axis?: 'x' | 'y') => graph.relations.find(
  (relation): relation is Extract<CadSketchGraphRelation, { kind: 'distance' | 'axis-distance' }> =>
    (axis === undefined ? relation.kind === 'distance' : relation.kind === 'axis-distance' && relation.axis === axis) && samePair(relation, pointIds));
function distanceRelation(graph: CadSketchGraph, pointIds: readonly [string, string], parameters: CadDocument['parameters'], axis?: 'x' | 'y') {
  const existing = distanceForPair(graph, pointIds, axis);
  if (existing) return existing;
  const positions = pointIds.map(id => {
    const point = graph.points.find(point => point.id === id);
    if (!point) throw new Error('The selected points are no longer available.');
    return point.position.map(value => evaluateCadScalar(value, parameters));
  });
  return axis === undefined ? { id: crypto.randomUUID(), kind: 'distance' as const, pointIds,
    value: Math.hypot(positions[0][0] - positions[1][0], positions[0][1] - positions[1][1]) }
    : { id: crypto.randomUUID(), kind: 'axis-distance' as const, pointIds, axis, value: positions[1][axis === 'x' ? 0 : 1] - positions[0][axis === 'x' ? 0 : 1] };
}
const radialRelationForEntity = (graph: CadSketchGraph, entityId: string) => graph.relations.find(relation => relation.kind === 'radial-size' && relation.entityId === entityId
  || relation.kind === 'fillet-corner' && relation.arcId === entityId);
function radialDimension(graph: CadSketchGraph, entity: CadSketchGraphEntity, parameters: CadDocument['parameters']): CadSketchGraphRelation | null {
  if (entity.kind === 'line' || cadSketchExternalReferenceForSelection(graph, { kind: 'entity', id: entity.id })) return null;
  const existing = radialRelationForEntity(graph, entity.id);
  if (existing) return existing;
  // A source expression already drives this circle; never silently transfer it.
  if (entity.kind === 'circle' && typeof entity.radius === 'string') return null;
  const point = (id: string) => {
    const found = graph.points.find(point => point.id === id);
    if (!found) throw new Error('The selected curve is no longer available.');
    return found.position.map(value => evaluateCadScalar(value, parameters));
  };
  let radius: number;
  if (entity.kind === 'circle') radius = evaluateCadScalar(entity.radius, parameters);
  else {
    const center = point(entity.centerPointId), start = point(entity.startPointId);
    radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  }
  const quantity = entity.kind === 'circle' ? 'diameter' : 'radius';
  return { id: crypto.randomUUID(), kind: 'radial-size', entityId: entity.id, quantity, value: radius * (quantity === 'diameter' ? 2 : 1) };
}
export type CadSketchRelationCommand = { readonly kind: 'inspect'; readonly relationId: string } | { readonly kind: 'length' | 'distance' | 'point-dimensions' | 'radial-size' | 'line-angle' | 'fillet' | 'chamfer' | 'move' };
type GeometryDraft = { readonly kind: 'fillet'; readonly radius: CadScalar } | { readonly kind: 'chamfer'; readonly setbacks: readonly [CadScalar, CadScalar] }
  | { readonly kind: 'move'; readonly x: string; readonly y: string };

export interface CadSketchRelationsPanelProps {
  document: CadDocument;
  sketch: CadSketchFeature;
  selection: readonly CadSketchGraphSelection[];
  initialCommand?: CadSketchRelationCommand;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPendingChange(pending: boolean): void;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument?(document: CadDocument | null): void;
  onInspectRelation?(relation: CadSketchGraphRelation | null): void;
  onInspectSubject?(subject: CadSketchConstraintFeedbackSubject | null): void;
  onCornerAccepted?(entityId: string, relationId: string): void;
  interactionLocked: boolean;
  cancelSignal: number;
}

/** A selection change disposes the old form, its preview and any pending application. */
export function CadSketchRelationsPanel(props: CadSketchRelationsPanelProps) {
  const graph = props.sketch.graph;
  if (!graph || !props.selection.length || props.selection.some(atom => !(atom.kind === 'point' ? graph.points : graph.entities).some(item => item.id === atom.id))) return null;
  return <RelationsForm key={JSON.stringify([props.document.id, props.sketch.id, props.selection, props.cancelSignal])} {...props} graph={graph} />;
}

function RelationsForm({ document: cadDocument, sketch, graph, selection, initialCommand, onEditMany, onPendingChange, onPrepareEdits, onPreviewDocument, onInspectRelation, onInspectSubject, onCornerAccepted, interactionLocked }: CadSketchRelationsPanelProps & { graph: CadSketchGraph }) {
  const submission = useCadEditSubmission();
  const singleton = selection.length === 1 ? selection[0] : null;
  const pointPair = selectedPointPair(selection);
  const pointLine = selectedPointLine(selection, graph);
  const linePair = selectedEntityPair(selection, graph, 'line'), curvePair = selectedEntityPair(selection, graph, 'curve');
  const entityPair = linePair ?? curvePair;
  const [angleId] = useState(() => crypto.randomUUID());
  const [initialAngle] = useState(() => {
    if (initialCommand?.kind !== 'line-angle' || !linePair) return null;
    const existing = graph.relations.find(relation => relation.kind === 'line-angle' && sameEntityPair(relation, linePair));
    const orientation = graph.relations.find(relation => (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') && sameEntityPair(relation, linePair));
    if (!existing && orientation) return { relation: null, choose: false, error: `Remove ${relationLabel(orientation)} before adding Angle.` };
    try { return { relation: existing ?? createCadSketchLineAngleRelation({ graph, parameters: cadDocument.parameters, lineIds: linePair, relationId: angleId }), choose: false, error: null }; }
    catch (cause) { return { relation: null, choose: cause instanceof CadError && cause.code === 'ambiguous-sketch-angle-sector',
      error: cause instanceof CadError && cause.code === 'ambiguous-sketch-angle-sector' ? null : cause instanceof Error ? cause.message : 'Unable to read this angle.' }; }
  });
  const [choosingAngle, setChoosingAngle] = useState(initialAngle?.choose ?? false);
  const latest = useRef({ document: cadDocument, sketch, graph }); latest.current = { document: cadDocument, sketch, graph };
  const [initialDimension] = useState(() => {
    if (initialCommand?.kind === 'line-angle') return initialAngle?.relation ?? null;
    const entity = singleton?.kind === 'entity' ? graph.entities.find(entity => entity.id === singleton.id) : null;
    if (initialCommand?.kind === 'radial-size' && entity) return radialDimension(graph, entity, cadDocument.parameters);
    const pair = initialCommand?.kind === 'distance' ? pointPair : initialCommand?.kind === 'length' && entity?.kind === 'line' ? [entity.startPointId, entity.endPointId] as const : null;
    return pair ? distanceRelation(graph, pair, cadDocument.parameters) : null;
  });
  const [source, setSource] = useState(latest.current), [draft, setDraft] = useState<CadSketchGraph>(() => initialDimension && !graph.relations.some(relation => relation.id === initialDimension.id)
    ? { ...graph, relations: [...graph.relations, initialDimension] } : graph);
  const [geometryDraft, setGeometryDraft] = useState<GeometryDraft | null>(() => initialCommand?.kind === 'move' ? { kind: 'move', x: '0', y: '0' }
    : singleton?.kind === 'point' && initialCommand?.kind === 'fillet' ? { kind: 'fillet', radius: 1 }
      : singleton?.kind === 'point' && initialCommand?.kind === 'chamfer' ? { kind: 'chamfer', setbacks: [1, 1] } : null);
  const move = geometryDraft?.kind === 'move' ? geometryDraft : null, corner = geometryDraft?.kind === 'move' ? null : geometryDraft;
  const [cornerIds] = useState(() => initialCommand?.kind === 'fillet' || initialCommand?.kind === 'chamfer'
    ? { trimPointIds: [crypto.randomUUID(), crypto.randomUUID()] as const, centerPointId: crypto.randomUUID(), entityId: crypto.randomUUID(), relationId: crypto.randomUUID() } : null);
  const [parameterEdits, setParameterEdits] = useState<Readonly<Record<string, number>>>({});
  const [valueDrafts, setValueDrafts] = useState<Readonly<Record<string, CadScalarValueDraft>>>({});
  const [fieldIssues, setFieldIssues] = useState<Readonly<Record<string, string>>>({});
  const [relationPending, setRelationPending] = useState<Readonly<Record<string, boolean>>>({});
  const [relationEdits, setRelationEdits] = useState<Readonly<Record<string, boolean>>>({});
  const [error, setError] = useState<string | CadSketchConstraintFeedback | null>(initialAngle?.error ?? null), [resetVersion, setResetVersion] = useState(0);
  const [inspectedFailure, setInspectedFailure] = useState<{ feedback: CadSketchConstraintFeedback; subject: CadSketchConstraintFeedbackSubject } | null>(null);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(initialCommand?.kind === 'inspect' ? initialCommand.relationId : initialDimension?.id ?? null);
  const callbacks = useRef({ onPendingChange, onPreviewDocument, onInspectRelation, onInspectSubject }); callbacks.current = { onPendingChange, onPreviewDocument, onInspectRelation, onInspectSubject };
  const reset = useCallback(() => {
    submission.cancel(); setSource(latest.current); setDraft(latest.current.graph); setGeometryDraft(null);
    setParameterEdits({}); setValueDrafts({}); setFieldIssues({}); setRelationPending({}); setRelationEdits({}); setError(null);
    setActiveRelationId(null); setChoosingAngle(false);
    setInspectedFailure(null);
    setResetVersion(version => version + 1);
  }, [submission.cancel]);
  const setValueDraft = useCallback((key: string, value: CadScalarValueDraft | null) => {
    setError(null); setValueDrafts(previous => {
      const next = { ...previous }; if (value) next[key] = value; else delete next[key]; return next;
    });
  }, []);
  const setIssue = useCallback((key: string, issue: string | null) => setFieldIssues(previous => {
    if ((previous[key] ?? null) === issue) return previous;
    const next = { ...previous }; if (issue) next[key] = issue; else delete next[key]; return next;
  }), []);
  const setBindingPending = useCallback((key: string, pending: boolean) => setRelationPending(previous => {
    if (Boolean(previous[key]) === pending) return previous;
    const next = { ...previous }; if (pending) next[key] = true; else delete next[key]; return next;
  }), []);
  const markRelationEdited = useCallback((key: string) => setRelationEdits(previous => previous[key] ? previous : { ...previous, [key]: true }), []);
  const changeParameter = useCallback((name: string, value: number) => {
    setError(null); setParameterEdits(previous => {
      const next = { ...previous }; if (value === source.document.parameters[name]) delete next[name]; else next[name] = value; return next;
    });
  }, [source.document]);
  const parameters = useMemo(() => ({ ...source.document.parameters, ...parameterEdits }), [source.document, parameterEdits]);
  const selectedEntity = singleton?.kind === 'entity' ? draft.entities.find(entity => entity.id === singleton.id) : null;
  const selectedPoint = singleton?.kind === 'point' ? draft.points.find(point => point.id === singleton.id) : null;
  const selectedReference = singleton ? cadSketchExternalReferenceForSelection(draft, singleton) : undefined;
  const referenceLock = singleton ? cadSketchExternalReferenceLockReason(draft, singleton) : null;
  const referenceSourceName = selectedReference ? source.document.features.find(feature => feature.id === selectedReference.sourceSketchId)?.name : null;
  const originalPoint = singleton?.kind === 'point' ? source.graph.points.find(point => point.id === singleton.id) : null;
  const originalEntity = singleton?.kind === 'entity' ? source.graph.entities.find(entity => entity.id === singleton.id) : null;
  const dimensionPair = selectedEntity?.kind === 'line' ? [selectedEntity.startPointId, selectedEntity.endPointId] as const : pointPair;
  const labelRelation = (relation: CadSketchGraphRelation) => relation.kind === 'distance' && pointPair && samePair(relation, pointPair) ? 'Distance' : relationLabel(relation);
  const acceptedScalars = useMemo(() => {
    const values: Record<string, CadScalar> = {};
    if (originalEntity?.kind === 'circle') values.radius = originalEntity.radius;
    if (originalPoint) { values['coordinate/x'] = originalPoint.position[0]; values['coordinate/y'] = originalPoint.position[1]; }
    for (const relation of source.graph.relations) {
      mapCadSketchRelationScalars(relation, (value, key) => { values[`${relation.id}/${key}`] = value; return value; });
    }
    return values;
  }, [originalEntity, originalPoint, source.graph]);
  const relevantPoints = new Set(selection.flatMap(atom => atom.kind === 'point' ? [atom.id] : draft.entities.filter(entity => entity.id === atom.id).flatMap(entityPoints)));
  const relations = draft.relations.filter(relation => cadSketchRelationPointIds(draft, relation).some(id => relevantPoints.has(id)));
  const activeRelation = relations.find(relation => relation.id === activeRelationId);
  const pointRoles = activeRelation?.kind === 'axis-distance' ? activeRelation.pointIds : pointPair;
  const angleOwner = linePair && draft.relations.find(relation => relation.kind === 'line-angle' && sameEntityPair(relation, linePair));
  const orientationOwner = linePair && draft.relations.find(relation => (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') && sameEntityPair(relation, linePair));
  const angleChoices = useMemo(() => {
    if (!choosingAngle || !linePair) return null;
    try { return cadSketchLineAngleSectors({ graph: draft, parameters, lineIds: linePair, relationId: angleId }); }
    catch { return null; }
  }, [choosingAngle, linePair?.[0], linePair?.[1], draft, parameters, angleId]);
  const radialOwner = selectedEntity && radialRelationForEntity(draft, selectedEntity.id);
  const acceptedRadial = selectedEntity && source.graph.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'radial-size' }> => relation.kind === 'radial-size' && relation.entityId === selectedEntity.id);
  useLayoutEffect(() => { onInspectRelation?.(activeRelation ?? null); return () => onInspectRelation?.(null); }, [activeRelation, onInspectRelation]);
  const changeRelation = (relation: CadSketchGraphRelation) => {
    setError(null); setDraft(current => ({ ...current, relations: current.relations.some(item => item.id === relation.id)
      ? current.relations.map(item => item.id === relation.id ? relation : item) : [...current.relations, relation] }));
  };
  const removeRelation = (id: string) => {
    setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.id !== id) }));
    setActiveRelationId(current => current === id ? null : current);
  };
  const toggleLineAxis = (kind: 'horizontal' | 'vertical', enabled: boolean) => {
    if (selectedEntity?.kind !== 'line') return;
    setError(null);
    setDraft(current => {
      const pair = [selectedEntity.startPointId, selectedEntity.endPointId] as const;
      const retained = current.relations.filter(relation => !samePair(relation, pair)
        || relation.kind !== (enabled ? kind === 'horizontal' ? 'vertical' : 'horizontal' : kind));
      if (enabled && !retained.some(relation => relation.kind === kind && samePair(relation, pair))) retained.push(
        source.graph.relations.find(relation => relation.kind === kind && samePair(relation, pair))
        ?? { id: crypto.randomUUID(), kind, pointIds: [selectedEntity.startPointId, selectedEntity.endPointId] }
      );
      return { ...current, relations: retained };
    });
  };
  const togglePairRelation = (kind: 'coincident' | 'horizontal' | 'vertical', enabled: boolean) => {
    if (!pointPair) return;
    // Keep other relations for the shared preparation/conflict checks.
    if (enabled) {
      changeRelation(source.graph.relations.find(relation => relation.kind === kind && samePair(relation, pointPair))
        ?? { id: crypto.randomUUID(), kind, pointIds: pointPair });
    } else {
      setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.kind !== kind || !samePair(relation, pointPair)) }));
    }
  };
  const toggleEntityPairRelation = (kind: 'parallel' | 'perpendicular' | 'equal-length' | 'equal-radius', enabled: boolean) => {
    const pair = kind === 'equal-radius' ? curvePair : linePair;
    if (!pair) return;
    if (enabled) {
      if (kind === 'parallel' || kind === 'perpendicular') setChoosingAngle(false);
      changeRelation(source.graph.relations.find(relation => relation.kind === kind && sameEntityPair(relation, pair))
        ?? (kind === 'equal-radius' ? { id: crypto.randomUUID(), kind, curveIds: pair } : { id: crypto.randomUUID(), kind, lineIds: pair }));
    } else {
      setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.kind !== kind || !sameEntityPair(relation, pair)) }));
    }
  };
  const toggleMidpoint = (enabled: boolean) => {
    if (!pointLine) return;
    const existing = draft.relations.find(relation => relation.kind === 'midpoint' && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId);
    if (enabled) changeRelation(source.graph.relations.find(relation => relation.kind === 'midpoint' && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId)
      ?? { id: crypto.randomUUID(), kind: 'midpoint', ...pointLine });
    else if (existing) { setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.id !== existing.id) })); }
  };
  const addLength = (axis?: 'x' | 'y') => {
    if (!dimensionPair) return;
    try {
      const relation = distanceForPair(draft, dimensionPair, axis)
        ?? distanceForPair(source.graph, dimensionPair, axis)
        ?? distanceRelation(draft, dimensionPair, parameters, axis);
      changeRelation(relation); setActiveRelationId(relation.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read this distance.'); }
  };
  const addRadialSize = () => {
    if (!selectedEntity) return;
    try {
      const relation = acceptedRadial ?? radialDimension(draft, selectedEntity, parameters);
      if (relation) { changeRelation(relation); setActiveRelationId(relation.id); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read this curve size.'); }
  };
  const addAngle = () => {
    if (!linePair || orientationOwner) return;
    try {
      const relation = angleOwner ?? source.graph.relations.find(relation => relation.kind === 'line-angle' && sameEntityPair(relation, linePair))
        ?? createCadSketchLineAngleRelation({ graph: draft, parameters, lineIds: linePair, relationId: angleId });
      changeRelation(relation); setActiveRelationId(relation.id); setChoosingAngle(false);
    } catch (cause) {
      if (cause instanceof CadError && cause.code === 'ambiguous-sketch-angle-sector') { setError(null); setChoosingAngle(true); }
      else setError(cause instanceof Error ? cause.message : 'Unable to read this angle.');
    }
  };
  const togglePointAxis = (axis: 'x' | 'y', enabled: boolean) => {
    if (!selectedPoint) return;
    const scalar = selectedPoint.position[axis === 'x' ? 0 : 1];
    if (enabled) {
      if (typeof scalar !== 'number') return;
      const relation = source.graph.relations.find(relation => relation.kind === 'fixed-axis' && relation.pointId === selectedPoint.id && relation.axis === axis)
        ?? { id: crypto.randomUUID(), kind: 'fixed-axis' as const, pointId: selectedPoint.id, axis, value: scalar };
      changeRelation(relation); setActiveRelationId(relation.id);
    } else {
      setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => !(relation.kind === 'fixed-axis' && relation.pointId === selectedPoint.id && relation.axis === axis)) }));
    }
  };
  const candidate = useMemo(() => {
    try {
      const edits: CadEdit[] = Object.entries(parameterEdits).map(([name, value]) => ({ kind: 'set-parameter', name, value }));
      let created: { entityId: string; relationId: string } | undefined;
      if (move) {
        const dx = Number(move.x), dy = Number(move.y);
        if (!move.x.trim() || !move.y.trim() || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Enter finite movement distances.');
        if (dx || dy) edits.push({ kind: 'translate-sketch-geometry', sketchId: sketch.id, selections: selection, translation: [dx, dy] });
      } else if (corner) {
        if (singleton?.kind !== 'point' || !cornerIds) throw new Error('Select the shared corner of two lines.');
        edits.push({ kind: 'create-sketch-corner', sketchId: sketch.id, pointId: singleton.id, treatment: corner.kind === 'fillet'
          ? { ...corner, ...cornerIds } : { ...corner, trimPointIds: cornerIds.trimPointIds, entityId: cornerIds.entityId, relationId: cornerIds.relationId } });
        created = cornerIds;
      } else {
        const pointChanged = originalPoint && selectedPoint && originalPoint.position.some((value, index) => value !== selectedPoint.position[index]);
        if (pointChanged || originalEntity?.kind === 'circle' && selectedEntity?.kind === 'circle' && originalEntity.radius !== selectedEntity.radius) {
          edits.push({ kind: 'update-feature', feature: { ...source.sketch, graph: { ...source.graph, points: draft.points, entities: draft.entities } } });
        }
        const originals = new Map(source.graph.relations.map(relation => [relation.id, relation]));
        const current = new Map(draft.relations.map(relation => [relation.id, relation]));
        for (const relation of source.graph.relations) if (!current.has(relation.id)) edits.push({ kind: 'remove-sketch-relation', sketchId: sketch.id, relationId: relation.id });
        for (const relation of draft.relations) if (JSON.stringify(originals.get(relation.id)) !== JSON.stringify(relation)) edits.push({ kind: 'set-sketch-relation', sketchId: sketch.id, relation });
      }
      if (edits.length) {
        if (source.document !== cadDocument) throw new Error('The part changed. Cancel this edit and use the current selection.');
        // Preparation solves preceding parameter changes before geometry-dependent commands.
        if (onPrepareEdits) validateCadEditBatch(edits);
        else reduceCadEditIntents(cadDocument, edits);
      }
      return { edits, issue: null, created };
    } catch (cause) { return { edits: null, issue: cause instanceof Error ? cause.message : 'Invalid sketch relation.' }; }
  }, [parameterEdits, parameters, move, corner, cornerIds, singleton?.kind, singleton?.id, originalEntity, selectedEntity, originalPoint, selectedPoint, source, draft, cadDocument, sketch.id, selection, onPrepareEdits]);
  const scalarPending = Object.keys(fieldIssues).length > 0 || Object.values(relationPending).some(Boolean);
  const changed = Boolean(candidate.edits?.length) || candidate.issue !== null;
  const pending = Boolean(move) || choosingAngle || changed || scalarPending || submission.applying;
  useLayoutEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useLayoutEffect(() => () => { callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument?.(null); callbacks.current.onInspectRelation?.(null); callbacks.current.onInspectSubject?.(null); }, []);
  useEffect(() => { if (source.document !== cadDocument && !pending) reset(); }, [source.document, cadDocument, pending, reset]);
  const prepared = useCadPreparedPreview(cadDocument, candidate.edits, onPrepareEdits, Boolean(onPrepareEdits && changed && !scalarPending && !submission.applying && !interactionLocked));
  useLayoutEffect(() => {
    onPreviewDocument?.(prepared.kind === 'ready' ? prepared.document : null);
    return () => onPreviewDocument?.(null);
  }, [prepared, onPreviewDocument]);
  const blockingIssue = candidate.issue ?? (prepared.kind === 'error' ? prepared.message : null);
  const feedback = source.document === cadDocument ? typeof error === 'object' && error !== null ? error : prepared.kind === 'error' ? prepared.feedback : undefined : undefined;
  const issue = typeof error === 'string' ? error : feedback?.message ?? blockingIssue;
  const canInspectFeedback = feedback?.sketchId === sketch.id;
  const inspectedSubject = canInspectFeedback && inspectedFailure && inspectedFailure.feedback === feedback ? inspectedFailure.subject : null;
  useLayoutEffect(() => {
    onInspectSubject?.(inspectedSubject);
    return () => onInspectSubject?.(null);
  }, [inspectedSubject, onInspectSubject]);
  const scalarContext = { parameters, acceptedScalars, relationEdits, valueDrafts, setValueDraft, setIssue,
    setRelationPending: setBindingPending, markRelationEdited, changeParameter };
  const relationList = <ul className="cad-sketch-constraint-list" aria-label="Sketch relations">{relations.map(relation => <li key={relation.id}>
          <Button type="button" aria-label={`Inspect ${describeCadSketchConstraintSource(draft, { kind: 'relation', id: relation.id }).label}`} aria-pressed={activeRelationId === relation.id} onClick={() => { setInspectedFailure(null); setActiveRelationId(current => current === relation.id ? null : relation.id); }}>
            {labelRelation(relation)}{(relation.kind === 'distance' || relation.kind === 'axis-distance' || relation.kind === 'fixed-axis' || relation.kind === 'fillet-corner' || relation.kind === 'radial-size' || relation.kind === 'line-angle') && <span>{relationQuantity(relation.value, parameters, relation.kind === 'line-angle' ? 'deg' : 'mm')}</span>}
            {relation.kind === 'chamfer-corner' && <span>{relation.values.map(value => relationQuantity(value, parameters)).join(' / ')}</span>}
          </Button><Button type="button" aria-label={relation.kind === 'external-reference' ? 'Detach reference' : `Remove ${describeCadSketchConstraintSource(draft, { kind: 'relation', id: relation.id }).label}`} title={relation.kind === 'external-reference' ? 'Detach this source link and retain the current geometry' : 'Remove this relation and retain the current geometry'} onClick={() => removeRelation(relation.id)}><CloseIcon size={12} /></Button>
        </li>)}</ul>;
  return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Sketch relations" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && pending && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); reset(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (interactionLocked || submission.applying || scalarPending || !candidate.edits?.length || blockingIssue) return;
      setError(null);
      submission.submit(signal => onEditMany(candidate.edits ?? [], signal), () => {
        reset(); if (candidate.created) onCornerAccepted?.(candidate.created.entityId, candidate.created.relationId);
      }, cause => setError(cause instanceof CadSketchPreparationError ? cause.feedback : cause instanceof Error ? cause.message : 'Unable to apply this sketch relation.'));
    }}>
    <div className="cad-property-title">{move ? 'Move selection' : corner ? corner.kind === 'fillet' ? 'Sketch fillet' : 'Sketch chamfer' : pointPair ? 'Point pair' : linePair ? 'Line pair' : curvePair ? 'Curve pair' : selection.length > 1 ? `${selection.length} selected` : selectedPoint ? 'Point' : selectedEntity?.kind === 'circle' ? 'Circle' : selectedEntity?.kind === 'line' ? 'Line' : 'Arc'}
      {move && <CadContextHelp label="Move selection">Translate the selected points and edges together without changing their sizes. Shared endpoints also change their incident edges. Outside points and existing dimensions stay in place; a blocked move rejects instead of stretching the selection or releasing constraints.</CadContextHelp>}
      {corner && <CadContextHelp label="Corner treatment">The original corner stays as a reference, preserving its dimensions. Fillet radius rounds this corner tangentially. Chamfer setbacks measure from the original corner along the two incident lines.</CadContextHelp>}
      {!move && pointPair && <CadContextHelp label="Point pair dimensions">Aligned measures straight-line distance. Horizontal measures ΔX; Vertical measures ΔY, from the first point to the second. Positive X is right and positive Y is up; negative values reverse the direction. These dimensions keep the separation, leaving the reference free until you fix it. Horizontal/Vertical checkboxes align points without setting a size.</CadContextHelp>}
      {!move && pointLine && <CadContextHelp label="Midpoint">Keeps this point halfway between the line’s endpoints as they change. Construction lines work too. The guide itself remains free until you constrain it. Remove Midpoint to keep the current point position without attachment.</CadContextHelp>}
      {!move && linePair && <CadContextHelp label="Line pair relations">Angle drives the displayed corner in degrees. Parallel keeps directions aligned; Perpendicular keeps a right angle. Equal length keeps finite lengths equal. Lines may share a joint or be separate; construction lines also work. Existing drivers stay in force.</CadContextHelp>}
      {!move && curvePair && <CadContextHelp label="Equal radius">Keeps the actual radii of these circles or arcs equal. Arc sweep and position remain independent. Add a radius or diameter dimension to control their shared size; two free curves still have a size freedom. Existing drivers stay in force.</CadContextHelp>}</div>
    <fieldset key={resetVersion} className="cad-feature-fields" disabled={interactionLocked || submission.applying}>
      {!pending && sketch.graph && <CadSketchSelectionMeasurements graph={sketch.graph} parameters={cadDocument.parameters} selection={selection} pointPair={pointRoles} />}
      {selectedReference && <div className="cad-sketch-profile-heading"><LinkIcon size={13} /><span className="min-w-0 truncate">{referenceSourceName}</span>
        <CadContextHelp label="Linked reference">This construction edge follows its source sketch. Its position and size are read-only; use it for snaps or to constrain other geometry. Detach retains the current shape and local relations.</CadContextHelp>
        {selectedEntity?.kind === 'circle' && <span>R {formatCadQuantity(evaluateCadScalar(selectedEntity.radius, parameters))} mm</span>}
      </div>}
      {move ? <div className="cad-placement-row"><label><span>ΔX</span><Input aria-label="Move X" autoFocus value={move.x} onChange={event => { setError(null); setGeometryDraft({ ...move, x: event.target.value }); }} /></label>
        <label><span>ΔY</span><Input aria-label="Move Y" value={move.y} onChange={event => { setError(null); setGeometryDraft({ ...move, y: event.target.value }); }} /></label><small>mm</small></div> : <>
      {selection.length > 1 && <div className="text-xs text-muted-foreground">{pointRoles ? pointRoles.map((id, index) => `${index ? 'To' : 'From'} Point ${graph.points.findIndex(point => point.id === id) + 1}`).join(' → ') : entityPair ? entityPair.map(id => describeCadSketchConstraintSource(graph, { kind: 'entity', id }).label).join(' · ') : pointLine ? `Point ${graph.points.findIndex(point => point.id === pointLine.pointId) + 1} · ${describeCadSketchConstraintSource(graph, { kind: 'entity', id: pointLine.lineId }).label}` : `${selection.filter(atom => atom.kind === 'point').length} points · ${selection.filter(atom => atom.kind === 'entity').length} edges`}</div>}
      {selectedEntity?.kind === 'line' && dimensionPair && <div className="cad-sketch-profile-actions">
        {(['horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind === 'horizontal' ? 'Horizontal' : 'Vertical'}
          disabled={Boolean(selectedReference)} title={referenceLock ?? undefined} checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, dimensionPair))} onChange={event => toggleLineAxis(kind, event.target.checked)} />{kind === 'horizontal' ? 'Horizontal' : 'Vertical'}</label>)}
        <Button type="button" title={referenceLock ?? undefined} disabled={Boolean(selectedReference) || draft.relations.some(relation => relation.kind === 'distance' && samePair(relation, dimensionPair))} onClick={() => addLength()}><MeasureIcon size={13} /> Add length</Button>
      </div>}
      {pointPair && <div className="cad-sketch-profile-actions cad-sketch-pair-actions">
        {(['coincident', 'horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind[0].toUpperCase() + kind.slice(1)}
          title={kind === 'coincident' ? 'Keeps the selected points together as a shared sketch joint.' : undefined}
          checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, pointPair))} onChange={event => togglePairRelation(kind, event.target.checked)} />{kind[0].toUpperCase() + kind.slice(1)}</label>)}
        <Button type="button" autoFocus={initialCommand?.kind === 'point-dimensions'} onClick={() => addLength()}><MeasureIcon size={13} /> Aligned distance</Button>
        {(['x', 'y'] as const).map(axis => <Button type="button" key={axis} onClick={() => addLength(axis)}><MeasureIcon size={13} />{axis === 'x' ? 'Horizontal distance' : 'Vertical distance'}</Button>)}
      </div>}
      {pointLine && <div className="cad-sketch-profile-actions cad-sketch-pair-actions"><label className="cad-check"><Input type="checkbox" aria-label="Midpoint"
        checked={draft.relations.some(relation => relation.kind === 'midpoint' && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId)}
        onChange={event => toggleMidpoint(event.target.checked)} />Midpoint</label></div>}
      {linePair && <div className="cad-sketch-profile-actions cad-sketch-pair-actions">
        {(['parallel', 'perpendicular'] as const).map(kind => {
          const checked = draft.relations.some(relation => relation.kind === kind && sameEntityPair(relation, linePair));
          const blocker = angleOwner ?? orientationOwner, blocked = !checked && Boolean(blocker);
          return <label key={kind} className="cad-check"><Input type="checkbox" aria-label={relationLabels[kind]}
            checked={checked} disabled={blocked}
            title={blocked && blocker ? `Remove ${relationLabel(blocker)} before adding ${relationLabels[kind]}.` : undefined}
            onChange={event => toggleEntityPairRelation(kind, event.target.checked)} />{relationLabels[kind]}</label>;
        })}
        <Button type="button" disabled={Boolean(orientationOwner)} title={orientationOwner ? `Remove ${relationLabel(orientationOwner)} before adding Angle.` : 'Drive the actual corner angle'} onClick={addAngle}><MeasureIcon size={13} /> {angleOwner ? 'Edit angle' : 'Add angle'}</Button>
      </div>}
      {choosingAngle && angleChoices && <CadSketchAngleSectors sectors={angleChoices} onChoose={relation => { changeRelation(relation); setActiveRelationId(relation.id); setChoosingAngle(false); }} />}
      {entityPair && <div className="cad-sketch-profile-actions cad-sketch-pair-actions"><label className="cad-check"><Input type="checkbox" aria-label={linePair ? 'Equal length' : 'Equal radius'}
        checked={draft.relations.some(relation => relation.kind === (linePair ? 'equal-length' : 'equal-radius') && sameEntityPair(relation, entityPair))}
        onChange={event => toggleEntityPairRelation(linePair ? 'equal-length' : 'equal-radius', event.target.checked)} />{linePair ? 'Equal length' : 'Equal radius'}</label></div>}
      {selectedEntity && selectedEntity.kind !== 'line' && !radialOwner && !selectedReference && <div className="cad-sketch-profile-actions">
        <Button type="button" disabled={selectedEntity.kind === 'circle' && typeof selectedEntity.radius === 'string'}
          title={selectedEntity.kind === 'circle' && typeof selectedEntity.radius === 'string' ? 'Radius already follows an expression. Edit or release it with fx.' : 'Add a driving radial dimension'} onClick={addRadialSize}>
          <MeasureIcon size={13} /> {acceptedRadial ? 'Restore' : 'Add'} {acceptedRadial?.quantity ?? (selectedEntity.kind === 'circle' ? 'diameter' : 'radius')}
        </Button>
      </div>}
      {!corner && selectedPoint && <div className="cad-sketch-profile-actions">{(['x', 'y'] as const).map(axis => {
        const fixed = draft.relations.some(relation => relation.kind === 'fixed-point' && relation.pointId === selectedPoint.id);
        const own = draft.relations.some(relation => relation.kind === 'fixed-axis' && relation.pointId === selectedPoint.id && relation.axis === axis);
        const driven = typeof selectedPoint.position[axis === 'x' ? 0 : 1] === 'string';
        return <label key={axis} className="cad-check"><Input type="checkbox" aria-label={`Fix ${axis.toUpperCase()}`} checked={fixed || own || driven || Boolean(selectedReference)} disabled={fixed || driven || Boolean(selectedReference)}
          title={referenceLock ?? (fixed ? 'Remove the fixed-point relation to release either axis.' : driven ? 'This coordinate already follows an exact expression.' : undefined)} onChange={event => togglePointAxis(axis, event.target.checked)} />Fix {axis.toUpperCase()}</label>;
      })}</div>}
      <CadScalarEditContext.Provider value={scalarContext}>
        {corner?.kind === 'fillet' && <ScalarField fieldKey="corner/value" label="Fillet radius" value={corner.radius} parameters={parameters} onChange={radius => setGeometryDraft({ kind: 'fillet', radius })} />}
        {corner?.kind === 'chamfer' && ([0, 1] as const).map(index => <ScalarField key={index} fieldKey={`corner/values.${index}`} label={`Setback ${index + 1}`} value={corner.setbacks[index]} parameters={parameters}
          onChange={value => setGeometryDraft({ ...corner, setbacks: index === 0 ? [value, corner.setbacks[1]] : [corner.setbacks[0], value] })} />)}
        {!corner && selectedPoint && (['x', 'y'] as const).map((axis, index) => typeof selectedPoint.position[index] === 'string' || typeof originalPoint?.position[index] === 'string'
          ? <ScalarField key={axis} fieldKey={`coordinate/${axis}`} label={axis.toUpperCase()} value={selectedPoint.position[index]} parameters={parameters} onChange={value => {
            setError(null); setDraft(current => ({ ...current, points: current.points.map(point => point.id === selectedPoint.id
              ? { ...point, position: axis === 'x' ? [value, point.position[1]] : [point.position[0], value] } : point) }));
          }} /> : null)}
        {selectedEntity?.kind === 'circle' && !radialOwner && !selectedReference && <ScalarField fieldKey="radius" label="Radius" value={selectedEntity.radius} parameters={parameters} onChange={radius => {
          setError(null); setDraft(current => ({ ...current, entities: current.entities.map(entity => entity.id === selectedEntity.id && entity.kind === 'circle' ? { ...entity, radius } : entity) }));
        }} />}
        {!corner && relations.length > 0 && (relations.length > 4
          ? <details className="cad-sketch-relations-disclosure" open={Boolean(activeRelation)}><summary>Relations <span>{relations.length}</span></summary>{relationList}</details>
          : relationList)}
        {activeRelation && (activeRelation.kind === 'distance' || activeRelation.kind === 'axis-distance' || activeRelation.kind === 'fixed-axis' || activeRelation.kind === 'line-angle') && <ScalarField fieldKey={`${activeRelation.id}/value`} label={labelRelation(activeRelation)} unit={activeRelation.kind === 'line-angle' ? 'deg' : 'mm'} value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />}
        {activeRelation?.kind === 'radial-size' && <>
          {!source.graph.relations.some(relation => relation.id === activeRelation.id) && <SelectField label="Dimension quantity" value={activeRelation.quantity}
            options={[{ value: 'radius', label: 'Radius' }, { value: 'diameter', label: 'Diameter' }]} onChange={quantity => {
              if (quantity === activeRelation.quantity) return;
              const value = typeof activeRelation.value === 'number' ? activeRelation.value * (quantity === 'diameter' ? 2 : .5)
                : `(${activeRelation.value}) ${quantity === 'diameter' ? '*' : '/'} 2`;
              changeRelation({ ...activeRelation, quantity, value });
            }} />}
          <ScalarField fieldKey={`${activeRelation.id}/value`} label={labelRelation(activeRelation)} value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />
        </>}
        {activeRelation?.kind === 'fillet-corner' && <ScalarField fieldKey={`${activeRelation.id}/value`} label="Fillet radius" value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />}
        {activeRelation?.kind === 'chamfer-corner' && ([0, 1] as const).map(index => <ScalarField key={index} fieldKey={`${activeRelation.id}/values.${index}`} label={`Setback ${index + 1}`} value={activeRelation.values[index]} parameters={parameters}
          onChange={value => changeRelation({ ...activeRelation, values: index === 0 ? [value, activeRelation.values[1]] : [activeRelation.values[0], value] })} />)}
        {activeRelation?.kind === 'fixed-point' && <>{(['x', 'y'] as const).map((axis, index) => <ScalarField key={axis} fieldKey={`${activeRelation.id}/position.${index}`} label={`Fixed ${axis.toUpperCase()}`} value={activeRelation.position[index]} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, position: axis === 'x' ? [value, activeRelation.position[1]] : [activeRelation.position[0], value] })} />)}</>}
      </CadScalarEditContext.Provider>
      </>}
    </fieldset>
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    {feedback && feedback.subjects.length > 0 && <ul className="cad-sketch-diagnostic-list" aria-label="Constraint issues">{feedback.subjects.map((subject, index) => <li key={`${subject.category}/${subject.source.kind}/${subject.source.id}/${index}`}>
      <Button type="button" data-cad-diagnostic-source={subject.source.id} aria-pressed={inspectedSubject === subject} disabled={interactionLocked || submission.applying || !canInspectFeedback} title={!canInspectFeedback ? 'Finish or cancel this edit before opening the affected sketch.' : subject.category === 'issue' ? subject.detail : 'Highlight the geometry involved in this constraint issue'}
        onClick={() => setInspectedFailure(current => current?.feedback === feedback && current.subject === subject ? null : { feedback, subject })}>
        <span>{subject.label}</span><small>{subject.category === 'partially-redundant' ? 'Partly redundant' : subject.category === 'issue' ? 'Geometry issue' : subject.category === 'conflicting' ? 'Conflict' : 'Redundant'}</small>
      </Button>
    </li>)}{feedback.omittedSubjectCount > 0 && <li className="text-xs text-muted-foreground">{feedback.omittedSubjectCount} more affected items</li>}</ul>}
    {pending && <div className="cad-form-actions"><Button type="button" onClick={reset}><CloseIcon size={13} /> Cancel</Button><Button variant="primary" type="submit" disabled={interactionLocked || submission.applying || scalarPending || !candidate.edits?.length || Boolean(blockingIssue)}><ConfirmIcon size={13} /> Apply</Button></div>}
  </form>;
}
