import { userFacingMessage } from '@/lib/userMessage';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, ConfirmIcon, LinkIcon, MeasureIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation, CadSketchReferenceDimension, CadSketchTangentJointRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchReferenceDimensionToDriving, measureCadSketchReferenceDimension, resolveCadSketchReferenceDimension } from '@/domain/cad/cadSketchReferenceDimensions';
import { resolveCadSketchSymmetryOperands } from '@/domain/cad/cadSketchSymmetryRelations';
import { resolveCadSketchPointOnLineOperands } from '@/domain/cad/cadSketchPointOnLineRelations';
import { createCadSketchLinePairDistance, createCadSketchPointLineDistance, resolveCadSketchPointLineDistanceOperands } from '@/domain/cad/cadSketchPointLineDistanceRelations';
import { resolveCadSketchTangentJoint } from '@/domain/cad/cadSketchTangentRelations';
import { resolveCadSketchPointIdentities } from '@/domain/cad/cadSketchGraphJoints';
import { cadSketchRelationPointIds, mapCadSketchRelationScalars } from '@/domain/cad/cadSketchGraphReferences';
import { cadSketchLinearPatternForSelection, cadSketchLinearPatternLockReason } from '@/domain/cad/cadSketchLinearPattern';
import { cadSketchExternalReferenceForSelection, cadSketchExternalReferenceLockReason } from '@/domain/cad/cadSketchExternalReferences';
import { reduceCadEditIntents, validateCadEditBatch, type CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadSketchLineAngleSectors, createCadSketchLineAngleRelation } from '@/domain/cad/cadSketchAngleRelations';
import { CadError } from '@/domain/cad/cadError';
import { CadScalarEditContext, ScalarField, SelectField, type CadScalarValueDraft } from './CadFields';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { cadSketchDatumRelationLabel, type CadSketchDatum } from './cadSketchGraphSelection';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { cadPreviewMarks, useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import type { CadSketchDiagnosisMarks } from './cadSketchDefinitionMarks';
import { formatCadQuantity } from './cadDisplayQuantity';
import { CadContextHelp } from './CadContextHelp';
import { CadSketchAngleSectors } from './CadSketchAngleSectors';
import { CadSketchSelectionMeasurements } from './CadSketchSelectionMeasurements';
import { CadSketchPreparationError, describeCadSketchConstraintSource, type CadSketchConstraintFeedback, type CadSketchConstraintFeedbackSubject } from './cadSketchConstraintFeedback';
import './cad-sketch-profile.css';

const entityPoints = (entity: CadSketchGraphEntity) => entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
  : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];
const relationLabels = {
  'tangent-joint': 'Tangent', 'point-on-line': 'Point on line', 'point-on-curve': 'Point on curve', symmetric: 'Symmetric points', 'linear-pattern': 'Linear pattern', 'reference-dimension': 'Reference dimension', 'fixed-point': 'Fixed point', distance: 'Length', 'point-line-distance': 'Point to line distance', coincident: 'Coincident', midpoint: 'Midpoint', horizontal: 'Horizontal', vertical: 'Vertical', 'external-reference': 'Linked reference',
  parallel: 'Parallel', perpendicular: 'Perpendicular', collinear: 'Collinear', 'equal-length': 'Equal length', 'equal-radius': 'Equal radius', 'line-angle': 'Angle', 'fillet-corner': 'Fillet', 'chamfer-corner': 'Chamfer'
} satisfies Record<Exclude<CadSketchGraphRelation['kind'], 'fixed-axis' | 'radial-size' | 'axis-distance'>, string>;
const relationLabel = (relation: CadSketchGraphRelation): string => relation.kind === 'fixed-axis' ? `Fix ${relation.axis.toUpperCase()}`
  : relation.kind === 'axis-distance' ? relation.axis === 'x' ? 'Horizontal distance' : 'Vertical distance'
    : relation.kind === 'radial-size' ? relation.quantity === 'radius' ? 'Radius' : 'Diameter' : relationLabels[relation.kind];
type Measurement = CadSketchReferenceDimension['measurement'];
const sameMeasurement = (a: Measurement, b: Measurement) => a.kind === 'point-distance' ? b.kind === 'point-distance' && a.pointIds.every(id => b.pointIds.includes(id))
  : a.kind === 'point-line-distance' ? b.kind === 'point-line-distance' && a.pointId === b.pointId && a.lineId === b.lineId
  : (b.kind === 'line-length' || b.kind === 'radial-size') && a.kind === b.kind && a.entityId === b.entityId
    && (a.kind !== 'radial-size' || b.kind === 'radial-size' && a.quantity === b.quantity);
function matchingReference(graph: CadSketchGraph, measurement: Measurement) {
  return graph.relations.find((r): r is CadSketchReferenceDimension => r.kind === 'reference-dimension' && sameMeasurement(r.measurement, measurement));
}
// Dimension lookups compare canonical point identities: a coincident alias shares the position, so its dimension already drives this one.
const sameIdentityPair = (identity: (pointId: string) => string, pointIds: readonly [string, string], pair: readonly [string, string]) => {
  const [a, b] = pointIds.map(identity), [c, d] = pair.map(identity);
  return a === c && b === d || a === d && b === c;
};
/** The point and its declared coincident aliases. */
const pointAliases = (graph: CadSketchGraph, pointId: string) => {
  const identity = resolveCadSketchPointIdentities(graph), own = identity(pointId);
  return graph.points.filter(point => identity(point.id) === own);
};
const pointLineDistanceFor = (graph: CadSketchGraph, operands: { readonly pointId: string; readonly lineId: string }) => {
  const identity = resolveCadSketchPointIdentities(graph), point = identity(operands.pointId);
  return graph.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'point-line-distance' }> =>
    relation.kind === 'point-line-distance' && relation.lineId === operands.lineId && identity(relation.pointId) === point);
};
function referenceDrivingLock(graph: CadSketchGraph, relation: CadSketchReferenceDimension): string | null {
  const target = resolveCadSketchReferenceDimension(graph, relation);
  const selections = target.kind === 'distance' ? target.pointIds.map(id => ({kind:'point' as const,id}))
    : target.kind === 'point-line-distance' ? [{kind:'point' as const,id:target.pointId}, {kind:'entity' as const,id:target.lineId}] : [{kind:'entity' as const,id:target.entityId}];
  const owned = selections.map(atom => cadSketchLinearPatternLockReason(graph,atom)).find(Boolean); if (owned) return owned;
  if (target.kind === 'point-line-distance') {
    if (pointLineDistanceFor(graph, target)) return 'An existing dimension already drives this distance. Edit that dimension instead.';
  } else if (target.kind === 'distance') {
    const linked = relation.measurement.kind === 'line-length' ? cadSketchExternalReferenceLockReason(graph, {kind:'entity',id:relation.measurement.entityId}) : null;
    if (linked) return linked;
    if (distanceForPair(graph, target.pointIds)) return 'An existing dimension already drives this distance. Edit that dimension instead.';
  } else {
    const linked = cadSketchExternalReferenceLockReason(graph, { kind:'entity', id:target.entityId });
    if (linked) return linked;
    if (radialRelationForEntity(graph, target.entityId)) return 'An existing dimension already drives this curve. Edit that dimension instead.';
    const entity = graph.entities.find(e => e.id === target.entityId);
    if (entity?.kind === 'circle' && typeof entity.radius === 'string') return 'The circle radius is driven by its source expression. Edit that expression instead.';
  }
  return null;
}
const samePair = (relation: CadSketchGraphRelation, pointIds: readonly [string, string]) => 'pointIds' in relation
  && relation.pointIds.includes(pointIds[0]) && relation.pointIds.includes(pointIds[1]);
const selectedPointPair = (selection: readonly CadSketchGraphSelection[]): readonly [string, string] | null => selection.length === 2
  && selection[0].kind === 'point' && selection[1].kind === 'point' && selection[0].id !== selection[1].id ? [selection[0].id, selection[1].id] : null;
function selectedPointLine(selection: readonly CadSketchGraphSelection[], graph: CadSketchGraph): { readonly pointId: string; readonly lineId: string } | null {
  if (selection.length !== 2) return null;
  const point = selection.find(atom => atom.kind === 'point'), edge = selection.find(atom => atom.kind === 'entity');
  const line = edge && graph.entities.find(entity => entity.id === edge.id);
  if (!point || line?.kind !== 'line') return null;
  const operands = { pointId: point.id, lineId: line.id };
  try { resolveCadSketchPointOnLineOperands(graph, operands); return operands; } catch { return null; }
}
/** A point, or an arc or circle's center, and a line it does not end on. */
function selectedPointLineDistance(selection: readonly CadSketchGraphSelection[], graph: CadSketchGraph): { readonly pointId: string; readonly lineId: string } | null {
  if (selection.length !== 2) return null;
  const line = selection.map(atom => atom.kind === 'entity' ? graph.entities.find(entity => entity.id === atom.id) : undefined).find(entity => entity?.kind === 'line');
  const other = line && selection.find(atom => atom.kind === 'point' || atom.id !== line.id);
  const curve = other?.kind === 'entity' ? graph.entities.find(entity => entity.id === other.id) : undefined;
  const pointId = other?.kind === 'point' ? other.id : curve && curve.kind !== 'line' ? curve.centerPointId : null;
  if (!line || !pointId) return null;
  const operands = { pointId, lineId: line.id };
  try { resolveCadSketchPointLineDistanceOperands(graph, operands); return operands; } catch { return null; }
}
const redundantRelation = (feedback: CadSketchConstraintFeedback, relationId: string) => {
  const subjects = feedback.subjects.filter(subject => subject.source.kind === 'relation' && subject.source.id === relationId);
  return subjects.some(subject => subject.category === 'redundant' || subject.category === 'partially-redundant') && !subjects.some(subject => subject.category === 'conflicting');
};
function selectedSymmetry(selection: readonly CadSketchGraphSelection[], graph: CadSketchGraph) {
  if (selection.length !== 3) return null;
  const axes = selection.filter(atom => atom.kind === 'entity' && graph.entities.some(entity => entity.id === atom.id && entity.kind === 'line'));
  if (axes.length !== 1) return null;
  const targets = selection.filter(atom => atom !== axes[0]);
  const ids = targets.map(atom => atom.kind === 'point' ? atom.id : (() => { const entity = graph.entities.find(entity => entity.id === atom.id); return entity?.kind === 'circle' ? entity.centerPointId : null; })());
  if (!ids[0] || !ids[1]) return null;
  const operands = { pointIds: [ids[0],ids[1]] as const, lineId: axes[0].id };
  try { resolveCadSketchSymmetryOperands(graph,operands); return { ...operands, label: targets.every(atom => atom.kind === 'entity') ? 'Symmetric centers' : 'Symmetric points' }; }
  catch { return null; }
}
function selectedTangent(selection: readonly CadSketchGraphSelection[], graph: CadSketchGraph) {
  if (selection.length !== 2 || selection.some(atom => atom.kind !== 'entity')) return null;
  const [a,b] = selection.map(atom => graph.entities.find(entity => entity.id === atom.id));
  if (!a || !b || !(a.kind === 'line' && b.kind === 'arc' || a.kind === 'arc' && b.kind === 'line')) return null;
  const identity = resolveCadSketchPointIdentities(graph);
  const joints = [a.startPointId,a.endPointId].flatMap(first => [b.startPointId,b.endPointId].filter(second => identity(first) === identity(second))
    .map(second => [{entityId:a.id,pointId:first},{entityId:b.id,pointId:second}] as const));
  if (joints.length !== 1) return { endpoints: null, reason: joints.length ? 'Select a line and arc with one unambiguous shared endpoint.' : 'Join these endpoints with Coincident before adding Tangent.' };
  try { resolveCadSketchTangentJoint(graph,{endpoints:joints[0]}); return {endpoints:joints[0],reason:null}; }
  catch (cause) { return {endpoints:null,reason:userFacingMessage(cause, 'This joint is unavailable.')}; }
}
function sameTangent(relation: CadSketchGraphRelation, endpoints: CadSketchTangentJointRelation['endpoints'] | null) {
  return relation.kind === 'tangent-joint' && endpoints !== null && endpoints.every(endpoint => relation.endpoints.some(other => other.entityId === endpoint.entityId && other.pointId === endpoint.pointId));
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
const distanceForPair = (graph: CadSketchGraph, pointIds: readonly [string, string], axis?: 'x' | 'y') => {
  const identity = resolveCadSketchPointIdentities(graph);
  return graph.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'distance' | 'axis-distance' }> =>
    (relation.kind === 'distance' && axis === undefined || relation.kind === 'axis-distance' && relation.axis === axis) && sameIdentityPair(identity, relation.pointIds, pointIds));
};
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
/** The dimension that drives exactly this measurement; a fillet's own radius stays with its corner. */
function drivingDimensionFor(graph: CadSketchGraph, measurement: Measurement) {
  if (measurement.kind === 'point-line-distance') return pointLineDistanceFor(graph, measurement);
  if (measurement.kind === 'radial-size') return graph.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'radial-size' }> =>
    relation.kind === 'radial-size' && relation.entityId === measurement.entityId);
  const line = measurement.kind === 'line-length' ? graph.entities.find(entity => entity.id === measurement.entityId) : null;
  const pair = measurement.kind === 'point-distance' ? measurement.pointIds : line?.kind === 'line' ? [line.startPointId, line.endPointId] as const : null;
  return pair ? distanceForPair(graph, pair) : undefined;
}
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
/** `relations` lists what constrains the selection without starting a new dimension. */
export type CadSketchRelationCommand = { readonly kind: 'inspect'; readonly relationId: string }
  | { readonly kind: 'relations' | 'length' | 'distance' | 'point-dimensions' | 'radial-size' | 'line-angle' | 'fillet' | 'chamfer' | 'move' }
  /** A point, or an arc or circle's center, held at a distance from a line; or two arcs or circles held at a center distance. */
  | { readonly kind: 'point-line-distance' | 'center-distance' }
  /** A point dimensioned from the sketch origin or an axis: signed X from the Y axis, Y from the X axis. */
  | { readonly kind: 'datum-distance'; readonly datum: CadSketchDatum };
type GeometryDraft = { readonly kind: 'fillet'; readonly radius: CadScalar } | { readonly kind: 'chamfer'; readonly setbacks: readonly [CadScalar, CadScalar] }
  | { readonly kind: 'move'; readonly x: string; readonly y: string };

export interface CadSketchRelationsPanelProps {
  document: CadDocument;
  sketch: CadSketchFeature;
  selection: readonly CadSketchGraphSelection[];
  initialCommand?: CadSketchRelationCommand;
  /** Shows only the dimension that `initialCommand` places; positional relations stay with the Constrain tools and the relations list. */
  dimensionOnly?: boolean;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPendingChange(pending: boolean): void;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument?(document: CadDocument | null, marks?: CadSketchDiagnosisMarks | null): void;
  onInspectRelation?(relation: CadSketchGraphRelation | null): void;
  onInspectSubject?(subject: CadSketchConstraintFeedbackSubject | null): void;
  onCornerAccepted?(entityId: string, relationId: string): void;
  onEditPattern?(relationId: string, detach?: true): void;
  onSelectPatternSeed?(entityId: string): void;
  onPlaceGeometry?(): void;
  interactionLocked: boolean;
  cancelSignal: number;
}

/** A selection change disposes the old form, its preview and any pending application. */
export function CadSketchRelationsPanel(props: CadSketchRelationsPanelProps) {
  const graph = props.sketch.graph;
  if (!graph || !props.selection.length || props.selection.some(atom => !(atom.kind === 'point' ? graph.points : graph.entities).some(item => item.id === atom.id))) return null;
  return <RelationsForm key={JSON.stringify([props.document.id, props.sketch.id, props.selection, props.cancelSignal])} {...props} graph={graph} />;
}

function RelationsForm({ document: cadDocument, sketch, graph, selection, initialCommand, onEditMany, onPendingChange, onPrepareEdits, onPreviewDocument, onInspectRelation, onInspectSubject, onCornerAccepted, onEditPattern, onSelectPatternSeed, onPlaceGeometry, interactionLocked, dimensionOnly: dimensionRequested = false }: CadSketchRelationsPanelProps & { graph: CadSketchGraph }) {
  const submission = useCadEditSubmission();
  const form = useRef<HTMLFormElement>(null);
  const singleton = selection.length === 1 ? selection[0] : null;
  const pointPair = selectedPointPair(selection);
  const pointLine = selectedPointLine(selection, graph);
  const symmetry = selectedSymmetry(selection, graph);
  const tangent = selectedTangent(selection, graph);
  const linePair = selectedEntityPair(selection, graph, 'line'), curvePair = selectedEntityPair(selection, graph, 'curve');
  const entityPair = linePair ?? curvePair;
  const pointLineDistance = selectedPointLineDistance(selection, graph);
  const [angleId] = useState(() => crypto.randomUUID());
  // Lines too close to parallel for an angle take a distance instead. Parallel lines are held parallel unless a relation
  // between them already does; an existing distance between them is reused. Lines a hair off parallel keep their directions.
  const [initialLineDistance] = useState(() => {
    if (initialCommand?.kind !== 'line-angle' || !linePair || graph.relations.some(relation => relation.kind === 'line-angle' && sameEntityPair(relation, linePair))) return null;
    try {
      const created = createCadSketchLinePairDistance({ graph, parameters: cadDocument.parameters, lineIds: linePair, relationId: angleId });
      if (!created) return null;
      const identity = resolveCadSketchPointIdentities(graph);
      const ends = (id: string) => { const line = graph.entities.find(entity => entity.id === id); return line?.kind === 'line' ? [line.startPointId, line.endPointId].map(identity) : []; };
      const existing = graph.relations.find(relation => relation.kind === 'point-line-distance'
        && (relation.lineId === linePair[0] && ends(linePair[1]).includes(identity(relation.pointId)) || relation.lineId === linePair[1] && ends(linePair[0]).includes(identity(relation.pointId))));
      const oriented = graph.relations.some(relation => (relation.kind === 'parallel' || relation.kind === 'collinear') && sameEntityPair(relation, linePair));
      return { relation: existing ?? created.relation, parallelLines: created.parallel,
        parallel: !created.parallel || oriented ? null : { id: crypto.randomUUID(), kind: 'parallel' as const, lineIds: linePair }, error: null };
    } catch (cause) { return { relation: null, parallelLines: false, parallel: null, error: userFacingMessage(cause, 'Unable to read this distance.') }; }
  });
  const [initialDistance] = useState((): { readonly relation: CadSketchGraphRelation | null; readonly error: string | null } | null => {
    try {
      if (initialCommand?.kind === 'point-line-distance') {
        if (!pointLineDistance) return { relation: null, error: 'Choose a point, arc or circle and a line that does not end at it.' };
        return { relation: pointLineDistanceFor(graph, pointLineDistance)
          ?? createCadSketchPointLineDistance({ graph, parameters: cadDocument.parameters, ...pointLineDistance, relationId: angleId }), error: null };
      }
      if (initialCommand?.kind !== 'center-distance') return null;
      const centers = curvePair?.map(id => graph.entities.find(entity => entity.id === id)).map(curve => curve && curve.kind !== 'line' ? curve.centerPointId : null);
      if (!centers?.[0] || !centers[1]) return { relation: null, error: 'Choose two arcs or circles.' };
      const pair = [centers[0], centers[1]] as const, identity = resolveCadSketchPointIdentities(graph);
      const relation = identity(pair[0]) === identity(pair[1]) ? null : distanceForPair(graph, pair) ?? distanceRelation(graph, pair, cadDocument.parameters);
      return relation && (relation.kind !== 'distance' || typeof relation.value !== 'number' || relation.value > 1e-7) ? { relation, error: null }
        : { relation: null, error: 'These curves share a center. Use Concentric to keep them together.' };
    } catch (cause) { return { relation: null, error: userFacingMessage(cause, 'Unable to read this distance.') }; }
  });
  const [initialAngle] = useState(() => {
    if (initialCommand?.kind !== 'line-angle' || !linePair || initialLineDistance) return null;
    const existing = graph.relations.find(relation => relation.kind === 'line-angle' && sameEntityPair(relation, linePair));
    const orientation = graph.relations.find(relation => (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') && sameEntityPair(relation, linePair));
    if (!existing && orientation) return { relation: null, choose: false, error: `Remove ${relationLabel(orientation)} before adding Angle.` };
    try { return { relation: existing ?? createCadSketchLineAngleRelation({ graph, parameters: cadDocument.parameters, lineIds: linePair, relationId: angleId }), choose: false, error: null }; }
    catch (cause) { return { relation: null, choose: cause instanceof CadError && cause.code === 'ambiguous-sketch-angle-sector',
      error: cause instanceof CadError && cause.code === 'ambiguous-sketch-angle-sector' ? null : userFacingMessage(cause, 'Unable to read this angle.') }; }
  });
  const [choosingAngle, setChoosingAngle] = useState(initialAngle?.choose ?? false);
  const latest = useRef({ document: cadDocument, sketch, graph }); latest.current = { document: cadDocument, sketch, graph };
  // Reuses a coordinate the point, or a coincident alias, already keeps; a coordinate driven by an expression or a fixed point has its owner already.
  const [datumDimensions] = useState<readonly Extract<CadSketchGraphRelation, { kind: 'fixed-axis' }>[]>(() => {
    if (initialCommand?.kind !== 'datum-distance' || singleton?.kind !== 'point') return [];
    const point = graph.points.find(item => item.id === singleton.id), aliases = pointAliases(graph, singleton.id), ids = new Set(aliases.map(alias => alias.id));
    if (!point || graph.relations.some(relation => relation.kind === 'fixed-point' && ids.has(relation.pointId))) return [];
    const axes = initialCommand.datum === 'origin' ? ['x', 'y'] as const : initialCommand.datum === 'x-axis' ? ['y'] as const : ['x'] as const;
    return axes.flatMap(axis => {
      const existing = graph.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'fixed-axis' }> => relation.kind === 'fixed-axis' && ids.has(relation.pointId) && relation.axis === axis);
      const index = axis === 'x' ? 0 : 1, value = point.position[index];
      return existing ? [existing] : typeof value === 'number' && aliases.every(alias => typeof alias.position[index] === 'number')
        ? [{ id: crypto.randomUUID(), kind: 'fixed-axis' as const, pointId: point.id, axis, value }] : [];
    });
  });
  const [initialDimension] = useState(() => {
    if (initialCommand?.kind === 'datum-distance') return datumDimensions[0] ?? null;
    if (initialCommand?.kind === 'line-angle') return initialLineDistance?.relation ?? initialAngle?.relation ?? null;
    if (initialDistance) return initialDistance.relation;
    const entity = singleton?.kind === 'entity' ? graph.entities.find(entity => entity.id === singleton.id) : null;
    if (initialCommand?.kind === 'radial-size' && entity) return radialDimension(graph, entity, cadDocument.parameters);
    const pair = initialCommand?.kind === 'distance' ? pointPair : initialCommand?.kind === 'length' && entity?.kind === 'line' ? [entity.startPointId, entity.endPointId] as const : null;
    return pair ? distanceRelation(graph, pair, cadDocument.parameters) : null;
  });
  const [source, setSource] = useState(latest.current), [draft, setDraft] = useState<CadSketchGraph>(() => {
    const added = [initialDimension, initialLineDistance?.parallel ?? null, ...datumDimensions.slice(1)].filter((relation): relation is CadSketchGraphRelation => relation !== null && !graph.relations.some(item => item.id === relation.id));
    return added.length ? { ...graph, relations: [...graph.relations, ...added] } : graph;
  });
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
  const [impliedParallelId, setImpliedParallelId] = useState(() => initialLineDistance?.parallel?.id ?? null);
  const [error, setError] = useState<string | CadSketchConstraintFeedback | null>(initialAngle?.error ?? initialLineDistance?.error ?? initialDistance?.error
    ?? (initialCommand?.kind === 'datum-distance' && !datumDimensions.length ? 'This point already has its position from a fixed point or an expression.' : null)), [resetVersion, setResetVersion] = useState(0);
  const [inspectedFailure, setInspectedFailure] = useState<{ feedback: CadSketchConstraintFeedback; subject: CadSketchConstraintFeedbackSubject } | null>(null);
  /** The full operand marks of the rejected Apply whose feedback `error` holds; any other error drops them. */
  const [appliedFailure, setAppliedFailure] = useState<{ feedback: CadSketchConstraintFeedback; marks: CadSketchDiagnosisMarks | null } | null>(null);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(initialCommand?.kind === 'inspect' ? initialCommand.relationId : initialDimension?.id ?? null);
  // A dimension started from the toolbar or picked on the canvas is ready for typing: its first editable value takes focus, Enter applies and Escape resets.
  const [typedRelationId] = useState(() => initialCommand && initialCommand.kind !== 'relations' ? activeRelationId : null);
  const dimensionOnly = dimensionRequested && (initialCommand?.kind === 'length' || initialCommand?.kind === 'distance' || initialCommand?.kind === 'point-dimensions' || initialCommand?.kind === 'datum-distance' || initialCommand?.kind === 'radial-size' || initialCommand?.kind === 'line-angle'
    || initialCommand?.kind === 'point-line-distance' || initialCommand?.kind === 'center-distance');
  useLayoutEffect(() => {
    if (!typedRelationId) return;
    const field = [...form.current?.querySelectorAll<HTMLInputElement>('input[data-cad-field-key]') ?? []]
      .find(input => input.dataset.cadFieldKey?.startsWith(`${typedRelationId}/`) && !input.readOnly && !input.disabled);
    field?.focus({ preventScroll: true }); field?.select();
  }, [typedRelationId]);
  const callbacks = useRef({ onPendingChange, onPreviewDocument, onInspectRelation, onInspectSubject }); callbacks.current = { onPendingChange, onPreviewDocument, onInspectRelation, onInspectSubject };
  const reset = useCallback(() => {
    submission.cancel(); setSource(latest.current); setDraft(latest.current.graph); setGeometryDraft(null);
    setParameterEdits({}); setValueDrafts({}); setFieldIssues({}); setRelationPending({}); setRelationEdits({}); setError(null);
    setActiveRelationId(null); setChoosingAngle(false); setImpliedParallelId(null);
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
  const curves = curvePair?.map(id => draft.entities.find(e => e.id === id));
  const centerPair = curves?.[0] && curves[0].kind !== 'line' && curves[1] && curves[1].kind !== 'line'
    ? [curves[0].centerPointId, curves[1].centerPointId] as const : null;
  const centerRelation = centerPair && draft.relations.find(r => r.kind === 'coincident' && samePair(r, centerPair));
  const centerIdentity = centerPair && resolveCadSketchPointIdentities(draft);
  const sharedCenter = Boolean(centerPair && !centerRelation && centerIdentity && centerIdentity(centerPair[0]) === centerIdentity(centerPair[1]));
  const selectedPattern = singleton ? cadSketchLinearPatternForSelection(draft,singleton) : null;
  const patternLock = selection.map(atom => cadSketchLinearPatternLockReason(draft,atom)).find(Boolean) ?? null;
  const selectedReference = singleton ? cadSketchExternalReferenceForSelection(draft, singleton) : undefined;
  const referenceLock = singleton ? cadSketchExternalReferenceLockReason(draft, singleton) : null;
  const referenceSourceName = selectedReference ? source.document.features.find(feature => feature.id === selectedReference.sourceSketchId)?.name : null;
  const originalPoint = singleton?.kind === 'point' ? source.graph.points.find(point => point.id === singleton.id) : null;
  const originalEntity = singleton?.kind === 'entity' ? source.graph.entities.find(entity => entity.id === singleton.id) : null;
  const dimensionPair = selectedEntity?.kind === 'line' ? [selectedEntity.startPointId, selectedEntity.endPointId] as const : pointPair;
  const draftIdentity = useMemo(() => resolveCadSketchPointIdentities(draft), [draft]);
  const labelRelation = (relation: CadSketchGraphRelation) => initialCommand?.kind === 'datum-distance' && relation.kind === 'fixed-axis' && datumDimensions.some(item => item.id === relation.id)
    ? initialCommand.datum === 'origin' ? `${relation.axis.toUpperCase()} from origin` : relation.axis === 'x' ? 'X from Y axis' : 'Y from X axis'
    : relation.kind === 'distance' && pointPair && sameIdentityPair(draftIdentity, relation.pointIds, pointPair) ? 'Distance'
      : relation.kind === 'distance' && centerPair && sameIdentityPair(draftIdentity, relation.pointIds, centerPair) ? 'Center distance' : relationLabel(relation);
  // A zero coordinate reads as the plane reference it holds the point on; the value editor keeps the coordinate name.
  const listedRelationLabel = (relation: CadSketchGraphRelation) => datumDimensions.some(item => item.id === relation.id) ? null : cadSketchDatumRelationLabel(relation);
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
  // A reused dimension may sit on a coincident alias of the selection, outside the listed relations.
  const activeRelation = draft.relations.find(relation => relation.id === activeRelationId);
  const lineDistance = initialLineDistance?.relation?.kind === 'point-line-distance' ? initialLineDistance.relation : null;
  // A radius or diameter dimension becomes the same quantity as a reference.
  const radialDriver = selectedEntity ? draft.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'radial-size' }> => relation.kind === 'radial-size' && relation.entityId === selectedEntity.id) : undefined;
  const passiveMeasurement: CadSketchReferenceDimension['measurement'] | null = pointPair ? {kind:'point-distance', pointIds:pointPair}
    : selectedEntity?.kind === 'line' ? {kind:'line-length', entityId:selectedEntity.id}
      : selectedEntity ? {kind:'radial-size', entityId:selectedEntity.id, quantity:radialDriver?.quantity ?? (selectedEntity.kind === 'circle' ? 'diameter' : 'radius')}
        : pointLineDistance ? {kind:'point-line-distance', ...pointLineDistance}
          : lineDistance ? {kind:'point-line-distance', pointId:lineDistance.pointId, lineId:lineDistance.lineId}
            : initialCommand?.kind === 'center-distance' && centerPair && initialDistance?.relation ? {kind:'point-distance', pointIds:centerPair} : null;
  const passiveLabel = passiveMeasurement?.kind === 'radial-size' ? passiveMeasurement.quantity : passiveMeasurement?.kind === 'line-length' ? 'length' : 'distance';
  // A horizontal or vertical distance has no reference form, so Reference is not offered as if it converted one.
  const referenceOffered = Boolean(passiveMeasurement) && activeRelation?.kind !== 'axis-distance';
  const drivingLock = activeRelation?.kind === 'reference-dimension' ? referenceDrivingLock(draft, activeRelation) : null;
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
  const togglePairRelation = (kind: 'coincident' | 'horizontal' | 'vertical', enabled: boolean, pair = pointPair) => {
    if (!pair) return;
    // Keep other relations for the shared preparation/conflict checks.
    if (enabled) {
      changeRelation(source.graph.relations.find(relation => relation.kind === kind && samePair(relation, pair))
        ?? { id: crypto.randomUUID(), kind, pointIds: pair });
    } else {
      setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.kind !== kind || !samePair(relation, pair)) }));
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
  const toggleSymmetry = (enabled: boolean) => {
    if (!symmetry || patternLock) return;
    const matches = (relation: CadSketchGraphRelation) => relation.kind === 'symmetric' && relation.lineId === symmetry.lineId && samePair(relation,symmetry.pointIds);
    if (enabled) changeRelation(source.graph.relations.find(matches) ?? {id:crypto.randomUUID(),kind:'symmetric',pointIds:symmetry.pointIds,lineId:symmetry.lineId});
    else { setError(null); setDraft(current=>({...current,relations:current.relations.filter(relation=>!matches(relation))})); }
  };
  const toggleTangent = (enabled: boolean) => {
    if (!tangent?.endpoints || patternLock) return;
    const endpoints = tangent.endpoints, matches = (relation: CadSketchGraphRelation) => sameTangent(relation,endpoints);
    if (enabled) changeRelation(source.graph.relations.find(matches) ?? {id:crypto.randomUUID(),kind:'tangent-joint',endpoints});
    else { setError(null); setDraft(current=>({...current,relations:current.relations.filter(relation=>!matches(relation))})); }
  };
  const togglePointLine = (kind: 'midpoint' | 'point-on-line', enabled: boolean) => {
    if (!pointLine) return;
    const existing = draft.relations.find(relation => relation.kind === kind && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId);
    if (enabled) changeRelation(source.graph.relations.find(relation => relation.kind === kind && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId)
      ?? { id: crypto.randomUUID(), kind, ...pointLine });
    else if (existing) { setError(null); setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.id !== existing.id) })); }
  };
  const addLength = (axis?: 'x' | 'y') => {
    if (!dimensionPair) return;
    try {
      const relation = distanceForPair(draft, dimensionPair, axis)
        ?? distanceForPair(source.graph, dimensionPair, axis)
        ?? distanceRelation(draft, dimensionPair, parameters, axis);
      changeRelation(relation); setActiveRelationId(relation.id);
    } catch (cause) { setError(userFacingMessage(cause, 'Unable to read this distance.')); }
  };
  const addRadialSize = () => {
    if (!selectedEntity) return;
    try {
      const relation = acceptedRadial ?? radialDimension(draft, selectedEntity, parameters);
      if (relation) { changeRelation(relation); setActiveRelationId(relation.id); }
    } catch (cause) { setError(userFacingMessage(cause, 'Unable to read this curve size.')); }
  };
  const addReference = () => {
    if (!passiveMeasurement) return;
    // The dimension driving this measurement, saved or new, becomes it under the same identity, so it stops driving in the same edit.
    const driver = drivingDimensionFor(draft, passiveMeasurement);
    const relation = matchingReference(draft, passiveMeasurement) ?? matchingReference(source.graph, passiveMeasurement)
      ?? {id:driver?.id ?? (initialDimension && !source.graph.relations.some(r => r.id === initialDimension.id) ? initialDimension.id : crypto.randomUUID()),
        kind:'reference-dimension' as const, measurement:passiveMeasurement};
    if (driver && driver.id !== relation.id) removeRelation(driver.id);
    if (initialDimension && initialDimension.id !== relation.id && initialDimension.id !== driver?.id && !source.graph.relations.some(r => r.id === initialDimension.id)) removeRelation(initialDimension.id);
    // A measurement drives nothing, so it never holds the lines parallel either.
    if (impliedParallelId) { removeRelation(impliedParallelId); setImpliedParallelId(null); }
    changeRelation(relation); setActiveRelationId(relation.id);
  };
  const makeDriving = () => {
    if (activeRelation?.kind !== 'reference-dimension' || drivingLock || !measurementDocument || !measurementGraph) return;
    try { changeRelation(cadSketchReferenceDimensionToDriving(measurementGraph, measurementDocument.parameters, activeRelation)); }
    catch (cause) { setError(userFacingMessage(cause, 'Unable to drive this measurement.')); }
  };
  const referenceValue = (relation: CadSketchReferenceDimension) => {
    if (!measurementDocument || !measurementGraph) return '—';
    try { return relationQuantity(measureCadSketchReferenceDimension(measurementGraph, measurementDocument.parameters, relation), measurementDocument.parameters); }
    catch { return '—'; }
  };
  const addAngle = () => {
    if (!linePair || orientationOwner) return;
    try {
      const relation = angleOwner ?? source.graph.relations.find(relation => relation.kind === 'line-angle' && sameEntityPair(relation, linePair))
        ?? createCadSketchLineAngleRelation({ graph: draft, parameters, lineIds: linePair, relationId: angleId });
      changeRelation(relation); setActiveRelationId(relation.id); setChoosingAngle(false);
    } catch (cause) {
      if (cause instanceof CadError && cause.code === 'ambiguous-sketch-angle-sector') { setError(null); setChoosingAngle(true); }
      else setError(userFacingMessage(cause, 'Unable to read this angle.'));
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
    } catch (cause) { return { edits: null, issue: userFacingMessage(cause, 'Invalid sketch relation.') }; }
  }, [parameterEdits, parameters, move, corner, cornerIds, singleton?.kind, singleton?.id, originalEntity, selectedEntity, originalPoint, selectedPoint, source, draft, cadDocument, sketch.id, selection, onPrepareEdits]);
  const scalarPending = Object.keys(fieldIssues).length > 0 || Object.values(relationPending).some(Boolean);
  const changed = Boolean(candidate.edits?.length) || candidate.issue !== null;
  const pending = Boolean(move) || choosingAngle || changed || scalarPending || submission.applying;
  useLayoutEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useLayoutEffect(() => () => { callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument?.(null); callbacks.current.onInspectRelation?.(null); callbacks.current.onInspectSubject?.(null); }, []);
  useEffect(() => { if (source.document !== cadDocument && !pending) reset(); }, [source.document, cadDocument, pending, reset]);
  const prepared = useCadPreparedPreview(cadDocument, candidate.edits, onPrepareEdits, Boolean(onPrepareEdits && changed && !scalarPending && !submission.applying && !interactionLocked));
  const measurementDocument = prepared.kind === 'ready' ? prepared.document : !changed ? source.document : null;
  const measurementSketch = measurementDocument?.features.find(f => f.id === sketch.id);
  const measurementGraph = measurementSketch?.kind === 'sketch' ? measurementSketch.graph : null;
  const failedApply = typeof error === 'object' && error !== null;
  const failureMarks = source.document !== cadDocument ? null : failedApply ? appliedFailure?.feedback === error ? appliedFailure.marks : null : cadPreviewMarks(prepared);
  useLayoutEffect(() => {
    onPreviewDocument?.(prepared.kind === 'ready' ? prepared.document : null, failureMarks);
    return () => onPreviewDocument?.(null);
  }, [prepared, failureMarks, onPreviewDocument]);
  // The lines may already stay parallel through other relations, as two Vertical lines do; the distance then stands alone.
  useEffect(() => {
    if (!impliedParallelId || prepared.kind !== 'error' || !prepared.feedback || !redundantRelation(prepared.feedback, impliedParallelId)) return;
    setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.id !== impliedParallelId) })); setImpliedParallelId(null);
  }, [prepared, impliedParallelId]);
  const blockingIssue = candidate.issue ?? (prepared.kind === 'error' ? prepared.message : null);
  const feedback = source.document === cadDocument ? failedApply ? error : prepared.kind === 'error' ? prepared.feedback : undefined : undefined;
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
          <Button type="button" aria-label={`Inspect ${describeCadSketchConstraintSource(draft, { kind: 'relation', id: relation.id }).label}`} aria-pressed={activeRelationId === relation.id} onClick={() => { if(relation.kind === 'linear-pattern') { if (!pending) onEditPattern?.(relation.id); return; } setInspectedFailure(null); setActiveRelationId(current => current === relation.id ? null : relation.id); }}>
            {listedRelationLabel(relation) ?? labelRelation(relation)}{!listedRelationLabel(relation) && (relation.kind === 'distance' || relation.kind === 'point-line-distance' || relation.kind === 'axis-distance' || relation.kind === 'fixed-axis' || relation.kind === 'fillet-corner' || relation.kind === 'radial-size' || relation.kind === 'line-angle') && <span>{relationQuantity(relation.value, parameters, relation.kind === 'line-angle' ? 'deg' : 'mm')}</span>}
            {relation.kind === 'reference-dimension' && <span>({referenceValue(relation)})</span>}
            {relation.kind === 'chamfer-corner' && <span>{relation.values.map(value => relationQuantity(value, parameters)).join(' / ')}</span>}
          </Button><Button type="button" aria-label={relation.kind === 'linear-pattern' ? 'Detach pattern' : relation.kind === 'external-reference' ? 'Detach reference' : `Remove ${describeCadSketchConstraintSource(draft, { kind: 'relation', id: relation.id }).label}`} title={relation.kind === 'linear-pattern' ? 'Detach all occurrences and retain their current geometry' : relation.kind === 'external-reference' ? 'Detach this source link and retain the current geometry' : 'Remove this relation and retain the current geometry'} disabled={relation.kind === 'linear-pattern' && (pending || !onEditPattern)} onClick={() => { if (relation.kind === 'linear-pattern') onEditPattern?.(relation.id,true); else removeRelation(relation.id); }}><CloseIcon size={12} /></Button>
        </li>)}</ul>;
  return <form ref={form} className="cad-property-form cad-sketch-profile-panel" aria-label="Sketch relations" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && pending && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); reset(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (interactionLocked || submission.applying || scalarPending || !candidate.edits?.length || blockingIssue) return;
      setError(null);
      const created = candidate.created;
      const apply = (edits: readonly CadEdit[], implied: string | null) => submission.submit(signal => onEditMany(edits, signal), () => {
        reset(); if (created) onCornerAccepted?.(created.entityId, created.relationId);
      }, cause => {
        // Applied before its preview finished: a redundant implied Parallel is left out and the rest applies as one edit.
        // With nothing else to apply, the dimension already stands as it is and completes without a history entry.
        const retained = implied && cause instanceof CadSketchPreparationError && redundantRelation(cause.feedback, implied)
          ? edits.filter(edit => !(edit.kind === 'set-sketch-relation' && edit.relation.id === implied)) : null;
        if (retained) {
          setDraft(current => ({ ...current, relations: current.relations.filter(relation => relation.id !== implied) })); setImpliedParallelId(null);
          if (retained.length) apply(retained, null); else reset();
          return;
        }
        if (cause instanceof CadSketchPreparationError) setAppliedFailure({ feedback: cause.feedback, marks: cause.marks });
        setError(cause instanceof CadSketchPreparationError ? cause.feedback : userFacingMessage(cause, 'Unable to apply this sketch relation.'));
      });
      apply(candidate.edits, impliedParallelId);
    }}>
    <div className="cad-property-title">{dimensionOnly ? 'Dimension' : move ? 'Move selection' : corner ? corner.kind === 'fillet' ? 'Sketch fillet' : 'Sketch chamfer' : pointPair ? 'Point pair' : linePair ? 'Line pair' : curvePair ? 'Curve pair' : selection.length > 1 ? `${selection.length} selected` : selectedPoint ? 'Point' : selectedEntity?.kind === 'circle' ? 'Circle' : selectedEntity?.kind === 'line' ? 'Line' : 'Arc'}
      {move && <CadContextHelp label="Move selection">Translate the selected points and edges together without changing their sizes. Shared endpoints also change their incident edges. Outside points and existing dimensions stay in place; a blocked move rejects instead of stretching the selection or releasing constraints.</CadContextHelp>}
      {corner && <CadContextHelp label="Corner treatment">The original corner stays as a reference, preserving its dimensions. Fillet radius rounds this corner tangentially. Chamfer setbacks measure from the original corner along the two incident lines.</CadContextHelp>}
      {!move && pointPair && <CadContextHelp label="Point pair dimensions">Aligned measures straight-line distance. Horizontal measures ΔX; Vertical measures ΔY, from the first point to the second. Positive X is right and positive Y is up; negative values reverse the direction. These dimensions keep the separation, leaving the reference free until you fix it. Horizontal/Vertical checkboxes align points without setting a size.</CadContextHelp>}
      {!move && pointLine && <CadContextHelp label="Midpoint">Keeps this point halfway between the line’s endpoints as they change. Construction lines work too. The guide itself remains free until you constrain it. Remove Midpoint to keep the current point position without attachment.</CadContextHelp>}
      {!move && linePair && <CadContextHelp label="Line pair relations">Angle drives the displayed corner in degrees. Parallel keeps directions aligned; Perpendicular keeps a right angle. Equal length keeps finite lengths equal. Lines may share a joint or be separate; construction lines also work. Existing drivers stay in force.</CadContextHelp>}
      {!move && (pointLineDistance || lineDistance) && dimensionOnly && <CadContextHelp label="Point to line distance">Keeps the point, or the arc or circle center, at this distance from the line or its extension, on the side where it is now. {!lineDistance ? 'The line follows its own constraints.' : initialLineDistance?.parallelLines ? 'Parallel lines also stay parallel, unless other relations already keep them so.' : 'These lines are a hair off parallel, so the distance runs from the end of one and they keep their own directions.'} Use Point on line for a zero distance.</CadContextHelp>}
      {!move && curvePair && <CadContextHelp label="Equal radius">Keeps the actual radii of these circles or arcs equal. Arc sweep and position remain independent. Add a radius or diameter dimension to control their shared size; two free curves still have a size freedom. Existing drivers stay in force.</CadContextHelp>}</div>
    <fieldset key={resetVersion} className="cad-feature-fields" disabled={interactionLocked || submission.applying}>
      {selectedPattern && <div className="cad-sketch-profile-actions"><span>{selectedPattern.index === 0 ? 'Pattern seed' : `Pattern occurrence ${selectedPattern.index + 1}`}</span><Button type="button" disabled={pending || !onEditPattern} onClick={() => onEditPattern?.(selectedPattern.relation.id)}>Edit pattern</Button>{selectedPattern.index > 0 && <Button type="button" disabled={pending || !onSelectPatternSeed} onClick={() => onSelectPatternSeed?.(selectedPattern.relation.seed.entityId)}>Select seed</Button>}<CadContextHelp label="Pattern ownership">Copies follow the seed and pitch. Edit the pattern to omit or restore copies; detach before moving or resizing one independently.</CadContextHelp></div>}
      {!pending && !dimensionOnly && sketch.graph && <CadSketchSelectionMeasurements graph={sketch.graph} parameters={cadDocument.parameters} selection={selection} pointPair={pointRoles} />}
      {selectedReference && <div className="cad-sketch-profile-heading"><LinkIcon size={13} /><span className="min-w-0 truncate">{referenceSourceName}</span>
        <CadContextHelp label="Linked reference">This construction edge follows its source sketch. Its position and size are read-only; use it for snaps or to constrain other geometry. Detach retains the current shape and local relations.</CadContextHelp>
        {selectedEntity?.kind === 'circle' && <span>R {formatCadQuantity(evaluateCadScalar(selectedEntity.radius, parameters))} mm</span>}
      </div>}
      {move ? <>{onPlaceGeometry && <Button type="button" disabled={submission.applying || [move.x,move.y].some(value => !value.trim() || Number(value) !== 0)} onClick={() => { reset(); onPlaceGeometry(); }}>Place and rotate…</Button>}<div className="cad-placement-row"><label><span>ΔX</span><Input aria-label="Move X" autoFocus value={move.x} onChange={event => { setError(null); setGeometryDraft({ ...move, x: event.target.value }); }} /></label>
        <label><span>ΔY</span><Input aria-label="Move Y" value={move.y} onChange={event => { setError(null); setGeometryDraft({ ...move, y: event.target.value }); }} /></label><small>mm</small></div></> : <>
      {selection.length > 1 && <div className="text-xs text-muted-foreground">{pointRoles ? pointRoles.map((id, index) => `${index ? 'To' : 'From'} Point ${graph.points.findIndex(point => point.id === id) + 1}`).join(' → ') : entityPair ? entityPair.map(id => describeCadSketchConstraintSource(graph, { kind: 'entity', id }).label).join(' · ') : pointLineDistance ?? pointLine ? `Point ${graph.points.findIndex(point => point.id === (pointLineDistance ?? pointLine)?.pointId) + 1} · ${describeCadSketchConstraintSource(graph, { kind: 'entity', id: (pointLineDistance ?? pointLine)?.lineId ?? '' }).label}` : `${selection.filter(atom => atom.kind === 'point').length} points · ${selection.filter(atom => atom.kind === 'entity').length} edges`}</div>}
      {referenceOffered && <div className="cad-sketch-profile-actions"><Button type="button" onClick={addReference}><MeasureIcon size={13} /> Reference {passiveLabel}</Button>
        <CadContextHelp label="Reference dimension">Save a measurement on the sketch. It follows the geometry and does not constrain or move it. Use Make driving to set its size deliberately.</CadContextHelp></div>}
      {!dimensionOnly && selectedEntity?.kind === 'line' && dimensionPair && <div className="cad-sketch-profile-actions">
        {(['horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind === 'horizontal' ? 'Horizontal' : 'Vertical'}
          disabled={Boolean(selectedReference)} title={referenceLock ?? undefined} checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, dimensionPair))} onChange={event => toggleLineAxis(kind, event.target.checked)} />{kind === 'horizontal' ? 'Horizontal' : 'Vertical'}</label>)}
        <Button type="button" title={referenceLock ?? undefined} disabled={Boolean(selectedReference) || Boolean(distanceForPair(draft, dimensionPair))} onClick={() => addLength()}><MeasureIcon size={13} /> Add length</Button>
      </div>}
      {!dimensionOnly && tangent && <div className="cad-sketch-profile-actions cad-sketch-pair-actions"><label className="cad-check"><Input type="checkbox" aria-label="Tangent"
        disabled={!tangent.endpoints || Boolean(patternLock)} title={patternLock ?? tangent.reason ?? undefined}
        checked={draft.relations.some(relation=>sameTangent(relation,tangent.endpoints))} onChange={event=>toggleTangent(event.target.checked)} />Tangent</label>
        <CadContextHelp label="Tangent">Keeps a line and arc smoothly joined at their shared endpoints. Use Coincident to join separate endpoints first. Existing dimensions remain in force. A fillet already controls tangency at its own contacts.</CadContextHelp></div>}
      {!dimensionOnly && symmetry && <div className="cad-sketch-profile-actions cad-sketch-pair-actions"><label className="cad-check"><Input type="checkbox" aria-label={symmetry.label} disabled={Boolean(patternLock)} title={patternLock ?? undefined}
        checked={draft.relations.some(relation=>relation.kind==='symmetric'&&relation.lineId===symmetry.lineId&&samePair(relation,symmetry.pointIds))}
        onChange={event=>toggleSymmetry(event.target.checked)} />{symmetry.label}</label>
        <CadContextHelp label="Point symmetry">Keeps these two positions mirrored about the selected line. Circle selections use their centers; radii and other dimensions keep their own drivers. The axis follows its existing constraints. Construction and linked reference lines can be axes.</CadContextHelp></div>}
      {pointPair && !patternLock && <div className="cad-sketch-profile-actions cad-sketch-pair-actions">
        {!dimensionOnly && (['coincident', 'horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind[0].toUpperCase() + kind.slice(1)}
          title={kind === 'coincident' ? 'Keeps the selected points together as a shared sketch joint.' : undefined}
          checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, pointPair))} onChange={event => togglePairRelation(kind, event.target.checked)} />{kind[0].toUpperCase() + kind.slice(1)}</label>)}
        <Button type="button" autoFocus={initialCommand?.kind === 'point-dimensions'} onClick={() => addLength()}><MeasureIcon size={13} /> Aligned distance</Button>
        {(['x', 'y'] as const).map(axis => <Button type="button" key={axis} onClick={() => addLength(axis)}><MeasureIcon size={13} />{axis === 'x' ? 'Horizontal distance' : 'Vertical distance'}</Button>)}
      </div>}
      {!dimensionOnly && pointLine && !patternLock && <div className="cad-sketch-profile-actions cad-sketch-pair-actions">
        {(['point-on-line', 'midpoint'] as const).map(kind => {
          const owner = draft.relations.find(relation => (relation.kind === 'midpoint' || relation.kind === 'point-on-line') && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId);
          const checked = draft.relations.some(relation => relation.kind === kind && relation.pointId === pointLine.pointId && relation.lineId === pointLine.lineId);
          return <label key={kind} className="cad-check"><Input type="checkbox" aria-label={relationLabels[kind]} checked={checked} disabled={!checked && Boolean(owner)}
            title={!checked && owner ? `Remove ${relationLabel(owner)} before adding ${relationLabels[kind]}.` : undefined}
            onChange={event => togglePointLine(kind, event.target.checked)} />{relationLabels[kind]}</label>;
        })}
        <CadContextHelp label="Point on line">Keeps the point on the selected line or its extension. It can slide along the guide unless other dimensions constrain it. The guide follows its own constraints. This does not join material boundaries or add a circle-size constraint.</CadContextHelp>
      </div>}
      {linePair && !lineDistance && <div className="cad-sketch-profile-actions cad-sketch-pair-actions">
        {!dimensionOnly && (['parallel', 'perpendicular'] as const).map(kind => {
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
      {!dimensionOnly && centerPair && !patternLock && <div className="cad-sketch-profile-actions cad-sketch-pair-actions"><label className="cad-check"><Input type="checkbox" aria-label="Concentric"
        checked={sharedCenter || Boolean(centerRelation)} disabled={sharedCenter} title={sharedCenter ? 'These centers already share a point or connected coincidence relations.' : undefined}
        onChange={event => togglePairRelation('coincident', event.target.checked, centerPair)} />Concentric</label>
        <CadContextHelp label="Concentric">Aligns arc and circle centers independently of their sizes. Existing dimensions remain in force; free geometry follows the sketch constraints. Uses a coincidence between their exact center points. Centers that already share a point or connecting relations remain concentric; edit those relations to change the connection.</CadContextHelp></div>}
      {!dimensionOnly && entityPair && !patternLock && <div className="cad-sketch-profile-actions cad-sketch-pair-actions"><label className="cad-check"><Input type="checkbox" aria-label={linePair ? 'Equal length' : 'Equal radius'}
        checked={draft.relations.some(relation => relation.kind === (linePair ? 'equal-length' : 'equal-radius') && sameEntityPair(relation, entityPair))}
        onChange={event => toggleEntityPairRelation(linePair ? 'equal-length' : 'equal-radius', event.target.checked)} />{linePair ? 'Equal length' : 'Equal radius'}</label></div>}
      {selectedEntity && selectedEntity.kind !== 'line' && !radialOwner && !selectedReference && !patternLock && <div className="cad-sketch-profile-actions">
        <Button type="button" disabled={selectedEntity.kind === 'circle' && typeof selectedEntity.radius === 'string'}
          title={selectedEntity.kind === 'circle' && typeof selectedEntity.radius === 'string' ? 'Radius already follows an expression. Edit or release it with fx.' : 'Add a driving radial dimension'} onClick={addRadialSize}>
          <MeasureIcon size={13} /> {acceptedRadial ? 'Restore' : 'Add'} {acceptedRadial?.quantity ?? (selectedEntity.kind === 'circle' ? 'diameter' : 'radius')}
        </Button>
      </div>}
      {!corner && !dimensionOnly && selectedPoint && <div className="cad-sketch-profile-actions">{(['x', 'y'] as const).map(axis => {
        // A coincident alias shares the position, so whatever fixes its coordinate fixes this one.
        const aliases = pointAliases(draft, selectedPoint.id), ids = new Set(aliases.map(alias => alias.id));
        const fixed = draft.relations.some(relation => relation.kind === 'fixed-point' && ids.has(relation.pointId));
        const own = draft.relations.some(relation => relation.kind === 'fixed-axis' && relation.pointId === selectedPoint.id && relation.axis === axis);
        const shared = !own && draft.relations.some(relation => relation.kind === 'fixed-axis' && ids.has(relation.pointId) && relation.axis === axis);
        const driven = aliases.some(alias => typeof alias.position[axis === 'x' ? 0 : 1] === 'string');
        return <label key={axis} className="cad-check"><Input type="checkbox" aria-label={`Fix ${axis.toUpperCase()}`} checked={fixed || own || shared || driven || Boolean(selectedReference)} disabled={fixed || shared || driven || Boolean(selectedReference) || Boolean(patternLock)}
          title={patternLock ?? referenceLock ?? (fixed ? 'Remove the fixed-point relation to release either axis.' : shared ? 'A coincident point already fixes this coordinate. Release it there.' : driven ? 'This coordinate already follows an exact expression.' : undefined)} onChange={event => togglePointAxis(axis, event.target.checked)} />Fix {axis.toUpperCase()}</label>;
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
        {selectedEntity?.kind === 'circle' && !radialOwner && !selectedReference && !patternLock && <ScalarField fieldKey="radius" label="Radius" value={selectedEntity.radius} parameters={parameters} onChange={radius => {
          setError(null); setDraft(current => ({ ...current, entities: current.entities.map(entity => entity.id === selectedEntity.id && entity.kind === 'circle' ? { ...entity, radius } : entity) }));
        }} />}
        {!corner && !dimensionOnly && relations.length > 0 && (relations.length > 4
          ? <details className="cad-sketch-relations-disclosure" open={Boolean(activeRelation)}><summary>Relations <span>{relations.length}</span></summary>{relationList}</details>
          : relationList)}
        {activeRelation && (activeRelation.kind === 'distance' || activeRelation.kind === 'point-line-distance' || activeRelation.kind === 'axis-distance' || activeRelation.kind === 'fixed-axis' || activeRelation.kind === 'line-angle') && <ScalarField fieldKey={`${activeRelation.id}/value`} label={labelRelation(activeRelation)} unit={activeRelation.kind === 'line-angle' ? 'deg' : 'mm'} value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />}
        {datumDimensions.flatMap(dimension => draft.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'fixed-axis' }> => relation.id === dimension.id && relation.kind === 'fixed-axis' && relation.id !== activeRelation?.id) ?? [])
          .map(relation => <ScalarField key={relation.id} fieldKey={`${relation.id}/value`} label={labelRelation(relation)} unit="mm" value={relation.value} parameters={parameters} onChange={value => changeRelation({ ...relation, value })} />)}
        {activeRelation?.kind === 'reference-dimension' && <>
          {activeRelation.measurement.kind === 'radial-size' && <SelectField label="Dimension quantity" value={activeRelation.measurement.quantity}
            options={[{value:'radius',label:'Radius'},{value:'diameter',label:'Diameter'}]} onChange={quantity => {
              if (activeRelation.measurement.kind === 'radial-size') changeRelation({...activeRelation,measurement:{...activeRelation.measurement,quantity}});
            }} />}
          <dl className="cad-measurements cad-selection-measurements"><div><dt>Reference {activeRelation.measurement.kind === 'radial-size' ? activeRelation.measurement.quantity : 'distance'}</dt><dd aria-label="Reference dimension value">{referenceValue(activeRelation)}</dd></div></dl>
          <Button type="button" disabled={Boolean(drivingLock) || !measurementGraph} title={drivingLock ?? 'Convert this measurement into a dimension that drives geometry'} onClick={makeDriving}>Make driving</Button>
        </>}
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
