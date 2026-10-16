import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, ConfirmIcon, MeasureIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { cadSketchRelationPointIds, mapCadSketchRelationScalars } from '@/domain/cad/cadSketchGraphReferences';
import { reduceCadEditIntents, validateCadEditBatch, type CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { CadScalarEditContext, ScalarField, type CadScalarValueDraft } from './CadFields';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { formatCadQuantity } from './cadDisplayQuantity';
import { CadContextHelp } from './CadContextHelp';
import { CadSketchPreparationError, describeCadSketchConstraintSource, type CadSketchConstraintFeedback, type CadSketchConstraintFeedbackSubject } from './cadSketchConstraintFeedback';

const entityPoints = (entity: CadSketchGraphEntity) => entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
  : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];
const relationLabel = (relation: CadSketchGraphRelation): string => relation.kind === 'fixed-axis' ? `Fix ${relation.axis.toUpperCase()}`
  : relation.kind === 'fixed-point' ? 'Fixed point' : relation.kind === 'distance' ? 'Length' : relation.kind === 'coincident' ? 'Coincident'
    : relation.kind === 'horizontal' ? 'Horizontal' : relation.kind === 'vertical' ? 'Vertical' : relation.kind === 'fillet-corner' ? 'Fillet' : 'Chamfer';
const samePair = (relation: CadSketchGraphRelation, pointIds: readonly [string, string]) => 'pointIds' in relation
  && relation.pointIds.includes(pointIds[0]) && relation.pointIds.includes(pointIds[1]);
const selectedPointPair = (selection: readonly CadSketchGraphSelection[]): readonly [string, string] | null => selection.length === 2
  && selection[0].kind === 'point' && selection[1].kind === 'point' && selection[0].id !== selection[1].id ? [selection[0].id, selection[1].id] : null;
function relationQuantity(value: CadScalar, parameters: CadDocument['parameters']): string {
  try { return `${formatCadQuantity(evaluateCadScalar(value, parameters))} mm`; }
  catch { return '—'; }
}
function distanceRelation(graph: CadSketchGraph, pointIds: readonly [string, string], parameters: CadDocument['parameters']) {
  const existing = graph.relations.find((relation): relation is Extract<CadSketchGraphRelation, { kind: 'distance' }> => relation.kind === 'distance' && samePair(relation, pointIds));
  if (existing) return existing;
  const positions = pointIds.map(id => {
    const point = graph.points.find(point => point.id === id);
    if (!point) throw new Error('The selected points are no longer available.');
    return point.position.map(value => evaluateCadScalar(value, parameters));
  });
  return { id: crypto.randomUUID(), kind: 'distance' as const, pointIds,
    value: Math.hypot(positions[0][0] - positions[1][0], positions[0][1] - positions[1][1]) };
}
export type CadSketchRelationCommand = { readonly kind: 'inspect'; readonly relationId: string } | { readonly kind: 'length' | 'distance' | 'fillet' | 'chamfer' };
type CornerDraft = { readonly kind: 'fillet'; readonly radius: CadScalar } | { readonly kind: 'chamfer'; readonly setbacks: readonly [CadScalar, CadScalar] };

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
  const latest = useRef({ document: cadDocument, sketch, graph }); latest.current = { document: cadDocument, sketch, graph };
  const [initialDimension] = useState(() => {
    const entity = singleton?.kind === 'entity' ? graph.entities.find(entity => entity.id === singleton.id) : null;
    const pair = initialCommand?.kind === 'distance' ? pointPair : initialCommand?.kind === 'length' && entity?.kind === 'line' ? [entity.startPointId, entity.endPointId] as const : null;
    return pair ? distanceRelation(graph, pair, cadDocument.parameters) : null;
  });
  const [source, setSource] = useState(latest.current), [draft, setDraft] = useState<CadSketchGraph>(() => initialDimension && !graph.relations.some(relation => relation.id === initialDimension.id)
    ? { ...graph, relations: [...graph.relations, initialDimension] } : graph);
  const [corner, setCorner] = useState<CornerDraft | null>(() => singleton?.kind === 'point' && initialCommand?.kind === 'fillet' ? { kind: 'fillet', radius: 1 }
    : singleton?.kind === 'point' && initialCommand?.kind === 'chamfer' ? { kind: 'chamfer', setbacks: [1, 1] } : null);
  const [cornerIds] = useState(() => initialCommand?.kind === 'fillet' || initialCommand?.kind === 'chamfer'
    ? { trimPointIds: [crypto.randomUUID(), crypto.randomUUID()] as const, centerPointId: crypto.randomUUID(), entityId: crypto.randomUUID(), relationId: crypto.randomUUID() } : null);
  const [parameterEdits, setParameterEdits] = useState<Readonly<Record<string, number>>>({});
  const [valueDrafts, setValueDrafts] = useState<Readonly<Record<string, CadScalarValueDraft>>>({});
  const [fieldIssues, setFieldIssues] = useState<Readonly<Record<string, string>>>({});
  const [relationPending, setRelationPending] = useState<Readonly<Record<string, boolean>>>({});
  const [relationEdits, setRelationEdits] = useState<Readonly<Record<string, boolean>>>({});
  const [error, setError] = useState<string | CadSketchConstraintFeedback | null>(null), [resetVersion, setResetVersion] = useState(0);
  const [inspectedFailure, setInspectedFailure] = useState<{ feedback: CadSketchConstraintFeedback; subject: CadSketchConstraintFeedbackSubject } | null>(null);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(initialCommand?.kind === 'inspect' ? initialCommand.relationId : initialDimension?.id ?? null);
  const callbacks = useRef({ onPendingChange, onPreviewDocument, onInspectRelation, onInspectSubject }); callbacks.current = { onPendingChange, onPreviewDocument, onInspectRelation, onInspectSubject };
  const reset = useCallback(() => {
    submission.cancel(); setSource(latest.current); setDraft(latest.current.graph); setCorner(null);
    setParameterEdits({}); setValueDrafts({}); setFieldIssues({}); setRelationPending({}); setRelationEdits({}); setError(null);
    setActiveRelationId(null);
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
  const addLength = () => {
    if (!dimensionPair) return;
    try {
      const relation = draft.relations.find(relation => relation.kind === 'distance' && samePair(relation, dimensionPair))
        ?? source.graph.relations.find(relation => relation.kind === 'distance' && samePair(relation, dimensionPair))
        ?? distanceRelation(draft, dimensionPair, parameters);
      changeRelation(relation); setActiveRelationId(relation.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read this distance.'); }
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
      if (corner) {
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
  }, [parameterEdits, parameters, corner, cornerIds, singleton?.kind, singleton?.id, originalEntity, selectedEntity, originalPoint, selectedPoint, source, draft, cadDocument, sketch.id, onPrepareEdits]);
  const scalarPending = Object.keys(fieldIssues).length > 0 || Object.values(relationPending).some(Boolean);
  const changed = Boolean(candidate.edits?.length) || candidate.issue !== null;
  const pending = changed || scalarPending || submission.applying;
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
    <div className="cad-property-title">{corner ? corner.kind === 'fillet' ? 'Sketch fillet' : 'Sketch chamfer' : pointPair ? 'Point pair' : selection.length > 1 ? `${selection.length} selected` : selectedPoint ? 'Point' : selectedEntity?.kind === 'circle' ? 'Circle' : selectedEntity?.kind === 'line' ? 'Line' : 'Arc'}
      {corner && <CadContextHelp label="Corner treatment">The original corner stays as a reference, preserving its dimensions. Fillet radius rounds this corner tangentially. Chamfer setbacks measure from the original corner along the two incident lines.</CadContextHelp>}</div>
    <fieldset key={resetVersion} className="cad-feature-fields" disabled={interactionLocked || submission.applying}>
      {selection.length > 1 && <div className="text-xs text-muted-foreground">{pointPair ? pointPair.map(id => `Point ${graph.points.findIndex(point => point.id === id) + 1}`).join(' · ') : `${selection.filter(atom => atom.kind === 'point').length} points · ${selection.filter(atom => atom.kind === 'entity').length} edges`}</div>}
      {selectedEntity?.kind === 'line' && dimensionPair && <div className="cad-sketch-profile-actions">
        {(['horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind === 'horizontal' ? 'Horizontal' : 'Vertical'}
          checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, dimensionPair))} onChange={event => toggleLineAxis(kind, event.target.checked)} />{kind === 'horizontal' ? 'Horizontal' : 'Vertical'}</label>)}
        <Button type="button" disabled={draft.relations.some(relation => relation.kind === 'distance' && samePair(relation, dimensionPair))} onClick={addLength}><MeasureIcon size={13} /> Add length</Button>
      </div>}
      {pointPair && <div className="cad-sketch-profile-actions cad-sketch-pair-actions">
        {(['coincident', 'horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind[0].toUpperCase() + kind.slice(1)}
          title={kind === 'coincident' ? 'Keeps the selected points together as a shared sketch joint.' : undefined}
          checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, pointPair))} onChange={event => togglePairRelation(kind, event.target.checked)} />{kind[0].toUpperCase() + kind.slice(1)}</label>)}
        <Button type="button" disabled={draft.relations.some(relation => relation.kind === 'distance' && samePair(relation, pointPair))} onClick={addLength}><MeasureIcon size={13} /> Add distance</Button>
      </div>}
      {!corner && selectedPoint && <div className="cad-sketch-profile-actions">{(['x', 'y'] as const).map(axis => {
        const fixed = draft.relations.some(relation => relation.kind === 'fixed-point' && relation.pointId === selectedPoint.id);
        const own = draft.relations.some(relation => relation.kind === 'fixed-axis' && relation.pointId === selectedPoint.id && relation.axis === axis);
        const driven = typeof selectedPoint.position[axis === 'x' ? 0 : 1] === 'string';
        return <label key={axis} className="cad-check"><Input type="checkbox" aria-label={`Fix ${axis.toUpperCase()}`} checked={fixed || own || driven} disabled={fixed || driven}
          title={fixed ? 'Remove the fixed-point relation to release either axis.' : driven ? 'This coordinate already follows an exact expression.' : undefined} onChange={event => togglePointAxis(axis, event.target.checked)} />Fix {axis.toUpperCase()}</label>;
      })}</div>}
      <CadScalarEditContext.Provider value={scalarContext}>
        {corner?.kind === 'fillet' && <ScalarField fieldKey="corner/value" label="Fillet radius" value={corner.radius} parameters={parameters} onChange={radius => setCorner({ kind: 'fillet', radius })} />}
        {corner?.kind === 'chamfer' && ([0, 1] as const).map(index => <ScalarField key={index} fieldKey={`corner/values.${index}`} label={`Setback ${index + 1}`} value={corner.setbacks[index]} parameters={parameters}
          onChange={value => setCorner({ ...corner, setbacks: index === 0 ? [value, corner.setbacks[1]] : [corner.setbacks[0], value] })} />)}
        {!corner && selectedPoint && (['x', 'y'] as const).map((axis, index) => typeof selectedPoint.position[index] === 'string' || typeof originalPoint?.position[index] === 'string'
          ? <ScalarField key={axis} fieldKey={`coordinate/${axis}`} label={axis.toUpperCase()} value={selectedPoint.position[index]} parameters={parameters} onChange={value => {
            setError(null); setDraft(current => ({ ...current, points: current.points.map(point => point.id === selectedPoint.id
              ? { ...point, position: axis === 'x' ? [value, point.position[1]] : [point.position[0], value] } : point) }));
          }} /> : null)}
        {selectedEntity?.kind === 'circle' && <ScalarField fieldKey="radius" label="Radius" value={selectedEntity.radius} parameters={parameters} onChange={radius => {
          setError(null); setDraft(current => ({ ...current, entities: current.entities.map(entity => entity.id === selectedEntity.id && entity.kind === 'circle' ? { ...entity, radius } : entity) }));
        }} />}
        {!corner && relations.length > 0 && <ul className="cad-sketch-constraint-list" aria-label="Sketch relations">{relations.map(relation => <li key={relation.id}>
          <Button type="button" aria-label={`Inspect ${describeCadSketchConstraintSource(draft, { kind: 'relation', id: relation.id }).label}`} aria-pressed={activeRelationId === relation.id} onClick={() => { setInspectedFailure(null); setActiveRelationId(current => current === relation.id ? null : relation.id); }}>
            {labelRelation(relation)}{(relation.kind === 'distance' || relation.kind === 'fixed-axis' || relation.kind === 'fillet-corner') && <span>{relationQuantity(relation.value, parameters)}</span>}
            {relation.kind === 'chamfer-corner' && <span>{relation.values.map(value => relationQuantity(value, parameters)).join(' / ')}</span>}
          </Button><Button type="button" aria-label={`Remove ${describeCadSketchConstraintSource(draft, { kind: 'relation', id: relation.id }).label}`} title="Remove this relation and retain the current geometry" onClick={() => removeRelation(relation.id)}><CloseIcon size={12} /></Button>
        </li>)}</ul>}
        {activeRelation && (activeRelation.kind === 'distance' || activeRelation.kind === 'fixed-axis') && <ScalarField fieldKey={`${activeRelation.id}/value`} label={labelRelation(activeRelation)} value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />}
        {activeRelation?.kind === 'fillet-corner' && <ScalarField fieldKey={`${activeRelation.id}/value`} label="Fillet radius" value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />}
        {activeRelation?.kind === 'chamfer-corner' && ([0, 1] as const).map(index => <ScalarField key={index} fieldKey={`${activeRelation.id}/values.${index}`} label={`Setback ${index + 1}`} value={activeRelation.values[index]} parameters={parameters}
          onChange={value => changeRelation({ ...activeRelation, values: index === 0 ? [value, activeRelation.values[1]] : [activeRelation.values[0], value] })} />)}
        {activeRelation?.kind === 'fixed-point' && <>{(['x', 'y'] as const).map((axis, index) => <ScalarField key={axis} fieldKey={`${activeRelation.id}/position.${index}`} label={`Fixed ${axis.toUpperCase()}`} value={activeRelation.position[index]} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, position: axis === 'x' ? [value, activeRelation.position[1]] : [activeRelation.position[0], value] })} />)}</>}
      </CadScalarEditContext.Provider>
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
