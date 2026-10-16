import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, ConfirmIcon, MeasureIcon } from '@wire-edm/icons-react';
import type { CadDocument, CadScalar, CadSketchFeature } from '@/domain/cad/cadDocument';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphRelation } from '@/domain/cad/cadSketchGraph';
import { reduceCadEditIntents, type CadEdit } from '@/domain/cad/cadOperations';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { CadScalarEditContext, ScalarField, type CadScalarValueDraft } from './CadFields';
import type { CadSketchGraphSelection } from './cadSketchGraphInteraction';
import { useCadEditSubmission, type CadEditCompletion } from './useCadEditSubmission';
import { useCadPreparedPreview, type CadPrepareEdits } from './useCadPreparedPreview';
import { formatCadQuantity } from './cadDisplayQuantity';

const relationPoints = (relation: CadSketchGraphRelation) => 'pointIds' in relation ? relation.pointIds : [relation.pointId];
const entityPoints = (entity: CadSketchGraphEntity) => entity.kind === 'line' ? [entity.startPointId, entity.endPointId]
  : entity.kind === 'arc' ? [entity.centerPointId, entity.startPointId, entity.endPointId] : [entity.centerPointId];
const relationLabel = (relation: CadSketchGraphRelation): string => relation.kind === 'fixed-axis' ? `Fix ${relation.axis.toUpperCase()}`
  : relation.kind === 'fixed-point' ? 'Fixed point' : relation.kind === 'distance' ? 'Length' : relation.kind === 'coincident' ? 'Coincident'
    : relation.kind === 'horizontal' ? 'Horizontal' : 'Vertical';
const samePair = (relation: CadSketchGraphRelation, line: Extract<CadSketchGraphEntity, { kind: 'line' }>) => 'pointIds' in relation
  && relation.pointIds.includes(line.startPointId) && relation.pointIds.includes(line.endPointId);
function relationQuantity(value: CadScalar, parameters: CadDocument['parameters']): string {
  try { return `${formatCadQuantity(evaluateCadScalar(value, parameters))} mm`; }
  catch { return '—'; }
}

export interface CadSketchRelationsPanelProps {
  document: CadDocument;
  sketch: CadSketchFeature;
  selection: CadSketchGraphSelection;
  initialRelationId?: string;
  onEditMany(edits: readonly CadEdit[], signal?: AbortSignal): CadEditCompletion;
  onPendingChange(pending: boolean): void;
  onPrepareEdits?: CadPrepareEdits;
  onPreviewDocument?(document: CadDocument | null): void;
  onInspectRelation?(relation: CadSketchGraphRelation | null): void;
  interactionLocked: boolean;
  cancelSignal: number;
}

/** A selection change disposes the old form, its preview and any pending application. */
export function CadSketchRelationsPanel(props: CadSketchRelationsPanelProps) {
  const graph = props.sketch.graph;
  if (!graph || !(props.selection.kind === 'point' ? graph.points : graph.entities).some(item => item.id === props.selection.id)) return null;
  return <RelationsForm key={`${props.document.id}/${props.sketch.id}/${props.selection.kind}/${props.selection.id}/${props.cancelSignal}`} {...props} graph={graph} />;
}

function RelationsForm({ document: cadDocument, sketch, graph, selection, initialRelationId, onEditMany, onPendingChange, onPrepareEdits, onPreviewDocument, onInspectRelation, interactionLocked }: CadSketchRelationsPanelProps & { graph: CadSketchGraph }) {
  const submission = useCadEditSubmission();
  const latest = useRef({ document: cadDocument, sketch, graph }); latest.current = { document: cadDocument, sketch, graph };
  const [source, setSource] = useState(latest.current), [draft, setDraft] = useState(graph);
  const [parameterEdits, setParameterEdits] = useState<Readonly<Record<string, number>>>({});
  const [valueDrafts, setValueDrafts] = useState<Readonly<Record<string, CadScalarValueDraft>>>({});
  const [fieldIssues, setFieldIssues] = useState<Readonly<Record<string, string>>>({});
  const [relationPending, setRelationPending] = useState<Readonly<Record<string, boolean>>>({});
  const [relationEdits, setRelationEdits] = useState<Readonly<Record<string, boolean>>>({});
  const [error, setError] = useState<string | null>(null), [resetVersion, setResetVersion] = useState(0);
  const [activeRelationId, setActiveRelationId] = useState<string | null>(initialRelationId ?? null);
  const callbacks = useRef({ onPendingChange, onPreviewDocument, onInspectRelation }); callbacks.current = { onPendingChange, onPreviewDocument, onInspectRelation };
  const reset = useCallback(() => {
    submission.cancel(); setSource(latest.current); setDraft(latest.current.graph);
    setParameterEdits({}); setValueDrafts({}); setFieldIssues({}); setRelationPending({}); setRelationEdits({}); setError(null);
    setActiveRelationId(null);
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
  const selectedEntity = selection.kind === 'entity' ? draft.entities.find(entity => entity.id === selection.id) : null;
  const selectedPoint = selection.kind === 'point' ? draft.points.find(point => point.id === selection.id) : null;
  const originalPoint = selection.kind === 'point' ? source.graph.points.find(point => point.id === selection.id) : null;
  const originalEntity = source.graph.entities.find(entity => entity.id === selection.id);
  const acceptedScalars = useMemo(() => {
    const values: Record<string, CadScalar> = {};
    if (originalEntity?.kind === 'circle') values.radius = originalEntity.radius;
    if (originalPoint) { values['coordinate/x'] = originalPoint.position[0]; values['coordinate/y'] = originalPoint.position[1]; }
    for (const relation of source.graph.relations) {
      if (relation.kind === 'distance' || relation.kind === 'fixed-axis') values[`${relation.id}/value`] = relation.value;
      else if (relation.kind === 'fixed-point') { values[`${relation.id}/x`] = relation.position[0]; values[`${relation.id}/y`] = relation.position[1]; }
    }
    return values;
  }, [originalEntity, originalPoint, source.graph]);
  const relevantPoints = new Set(selectedPoint ? [selectedPoint.id] : selectedEntity ? entityPoints(selectedEntity) : []);
  const relations = draft.relations.filter(relation => relationPoints(relation).some(id => relevantPoints.has(id)));
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
      const retained = current.relations.filter(relation => !samePair(relation, selectedEntity)
        || relation.kind !== (enabled ? kind === 'horizontal' ? 'vertical' : 'horizontal' : kind));
      if (enabled && !retained.some(relation => relation.kind === kind && samePair(relation, selectedEntity))) retained.push(
        source.graph.relations.find(relation => relation.kind === kind && samePair(relation, selectedEntity))
        ?? { id: crypto.randomUUID(), kind, pointIds: [selectedEntity.startPointId, selectedEntity.endPointId] }
      );
      return { ...current, relations: retained };
    });
  };
  const addLength = () => {
    if (selectedEntity?.kind !== 'line') return;
    const start = draft.points.find(point => point.id === selectedEntity.startPointId), end = draft.points.find(point => point.id === selectedEntity.endPointId);
    if (!start || !end) return;
    try {
      const relation = source.graph.relations.find(relation => relation.kind === 'distance' && samePair(relation, selectedEntity))
        ?? { id: crypto.randomUUID(), kind: 'distance' as const, pointIds: [selectedEntity.startPointId, selectedEntity.endPointId] as const,
          value: Math.hypot(evaluateCadScalar(start.position[0], parameters) - evaluateCadScalar(end.position[0], parameters), evaluateCadScalar(start.position[1], parameters) - evaluateCadScalar(end.position[1], parameters)) };
      changeRelation(relation); setActiveRelationId(relation.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read this line length.'); }
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
      const pointChanged = originalPoint && selectedPoint && originalPoint.position.some((value, index) => value !== selectedPoint.position[index]);
      if (pointChanged || originalEntity?.kind === 'circle' && selectedEntity?.kind === 'circle' && originalEntity.radius !== selectedEntity.radius) {
        edits.push({ kind: 'update-feature', feature: { ...source.sketch, graph: { ...source.graph, points: draft.points, entities: draft.entities } } });
      }
      const originals = new Map(source.graph.relations.map(relation => [relation.id, relation]));
      const current = new Map(draft.relations.map(relation => [relation.id, relation]));
      for (const relation of source.graph.relations) if (!current.has(relation.id)) edits.push({ kind: 'remove-sketch-relation', sketchId: sketch.id, relationId: relation.id });
      for (const relation of draft.relations) if (JSON.stringify(originals.get(relation.id)) !== JSON.stringify(relation)) edits.push({ kind: 'set-sketch-relation', sketchId: sketch.id, relation });
      if (edits.length) {
        if (source.document !== cadDocument) throw new Error('The part changed. Cancel this edit and use the current selection.');
        reduceCadEditIntents(cadDocument, edits);
      }
      return { edits, issue: null };
    } catch (cause) { return { edits: null, issue: cause instanceof Error ? cause.message : 'Invalid sketch relation.' }; }
  }, [parameterEdits, originalEntity, selectedEntity, originalPoint, selectedPoint, source, draft.points, draft.entities, draft.relations, cadDocument, sketch.id]);
  const scalarPending = Object.keys(fieldIssues).length > 0 || Object.values(relationPending).some(Boolean);
  const changed = Boolean(candidate.edits?.length) || candidate.issue !== null;
  const pending = changed || scalarPending || submission.applying;
  useLayoutEffect(() => { onPendingChange(pending); }, [pending, onPendingChange]);
  useEffect(() => () => { callbacks.current.onPendingChange(false); callbacks.current.onPreviewDocument?.(null); callbacks.current.onInspectRelation?.(null); }, []);
  useEffect(() => { if (source.document !== cadDocument && !pending) reset(); }, [source.document, cadDocument, pending, reset]);
  const prepared = useCadPreparedPreview(cadDocument, candidate.edits, onPrepareEdits, Boolean(onPrepareEdits && changed && !scalarPending && !submission.applying && !interactionLocked));
  useLayoutEffect(() => {
    onPreviewDocument?.(prepared.kind === 'ready' ? prepared.document : null);
    return () => onPreviewDocument?.(null);
  }, [prepared, onPreviewDocument]);
  const blockingIssue = candidate.issue ?? (prepared.kind === 'error' ? prepared.message : null);
  const issue = error ?? blockingIssue;
  const scalarContext = { parameters, acceptedScalars, relationEdits, valueDrafts, setValueDraft, setIssue,
    setRelationPending: setBindingPending, markRelationEdited, changeParameter };
  return <form className="cad-property-form cad-sketch-profile-panel" aria-label="Sketch relations" aria-busy={submission.applying || undefined}
    onKeyDown={event => { if (event.key === 'Escape' && pending && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); reset(); } }}
    onSubmit={event => {
      event.preventDefault();
      if (interactionLocked || submission.applying || scalarPending || !candidate.edits?.length || blockingIssue) return;
      setError(null);
      submission.submit(signal => onEditMany(candidate.edits ?? [], signal), reset, cause => setError(cause instanceof Error ? cause.message : 'Unable to apply this sketch relation.'));
    }}>
    <div className="cad-property-title">{selectedPoint ? 'Point' : selectedEntity?.kind === 'circle' ? 'Circle' : selectedEntity?.kind === 'line' ? 'Line' : 'Arc'}</div>
    <fieldset key={resetVersion} className="cad-feature-fields" disabled={interactionLocked || submission.applying}>
      {selectedEntity?.kind === 'line' && <div className="cad-sketch-profile-actions">
        {(['horizontal', 'vertical'] as const).map(kind => <label key={kind} className="cad-check"><Input type="checkbox" aria-label={kind === 'horizontal' ? 'Horizontal' : 'Vertical'}
          checked={draft.relations.some(relation => relation.kind === kind && samePair(relation, selectedEntity))} onChange={event => toggleLineAxis(kind, event.target.checked)} />{kind === 'horizontal' ? 'Horizontal' : 'Vertical'}</label>)}
        <Button type="button" disabled={draft.relations.some(relation => relation.kind === 'distance' && samePair(relation, selectedEntity))} onClick={addLength}><MeasureIcon size={13} /> Add length</Button>
      </div>}
      {selectedPoint && <div className="cad-sketch-profile-actions">{(['x', 'y'] as const).map(axis => {
        const fixed = draft.relations.some(relation => relation.kind === 'fixed-point' && relation.pointId === selectedPoint.id);
        const own = draft.relations.some(relation => relation.kind === 'fixed-axis' && relation.pointId === selectedPoint.id && relation.axis === axis);
        const driven = typeof selectedPoint.position[axis === 'x' ? 0 : 1] === 'string';
        return <label key={axis} className="cad-check"><Input type="checkbox" aria-label={`Fix ${axis.toUpperCase()}`} checked={fixed || own || driven} disabled={fixed || driven}
          title={fixed ? 'Remove the fixed-point relation to release either axis.' : driven ? 'This coordinate already follows an exact expression.' : undefined} onChange={event => togglePointAxis(axis, event.target.checked)} />Fix {axis.toUpperCase()}</label>;
      })}</div>}
      <CadScalarEditContext.Provider value={scalarContext}>
        {selectedPoint && (['x', 'y'] as const).map((axis, index) => typeof selectedPoint.position[index] === 'string' || typeof originalPoint?.position[index] === 'string'
          ? <ScalarField key={axis} fieldKey={`coordinate/${axis}`} label={axis.toUpperCase()} value={selectedPoint.position[index]} parameters={parameters} onChange={value => {
            setError(null); setDraft(current => ({ ...current, points: current.points.map(point => point.id === selectedPoint.id
              ? { ...point, position: axis === 'x' ? [value, point.position[1]] : [point.position[0], value] } : point) }));
          }} /> : null)}
        {selectedEntity?.kind === 'circle' && <ScalarField fieldKey="radius" label="Radius" value={selectedEntity.radius} parameters={parameters} onChange={radius => {
          setError(null); setDraft(current => ({ ...current, entities: current.entities.map(entity => entity.id === selectedEntity.id && entity.kind === 'circle' ? { ...entity, radius } : entity) }));
        }} />}
        {relations.length > 0 && <ul className="cad-sketch-constraint-list" aria-label="Sketch relations">{relations.map(relation => <li key={relation.id}>
          <Button type="button" aria-label={`Inspect ${relationLabel(relation)} relation ${relation.id}`} aria-pressed={activeRelationId === relation.id} onClick={() => setActiveRelationId(current => current === relation.id ? null : relation.id)}>
            {relationLabel(relation)}{(relation.kind === 'distance' || relation.kind === 'fixed-axis') && <span>{relationQuantity(relation.value, parameters)}</span>}
          </Button><Button type="button" aria-label={`Remove ${relationLabel(relation)} relation ${relation.id}`} title="Remove this relation and retain the current geometry" onClick={() => removeRelation(relation.id)}><CloseIcon size={12} /></Button>
        </li>)}</ul>}
        {activeRelation && (activeRelation.kind === 'distance' || activeRelation.kind === 'fixed-axis') && <ScalarField fieldKey={`${activeRelation.id}/value`} label={relationLabel(activeRelation)} value={activeRelation.value} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, value })} />}
        {activeRelation?.kind === 'fixed-point' && <>{(['x', 'y'] as const).map((axis, index) => <ScalarField key={axis} fieldKey={`${activeRelation.id}/${axis}`} label={`Fixed ${axis.toUpperCase()}`} value={activeRelation.position[index]} parameters={parameters} onChange={value => changeRelation({ ...activeRelation, position: axis === 'x' ? [value, activeRelation.position[1]] : [activeRelation.position[0], value] })} />)}</>}
      </CadScalarEditContext.Provider>
    </fieldset>
    {issue && <p className="cad-error" role="alert">{issue}</p>}
    {pending && <div className="cad-form-actions"><Button type="button" onClick={reset}><CloseIcon size={13} /> Cancel</Button><Button variant="primary" type="submit" disabled={interactionLocked || submission.applying || scalarPending || !candidate.edits?.length || Boolean(blockingIssue)}><ConfirmIcon size={13} /> Apply</Button></div>}
  </form>;
}
