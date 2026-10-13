import { useEffect, useLayoutEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { CadDocument, CadFeature, CadPlane, CadScalar, CadSketchProfile } from '@/domain/cad/cadDocument';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { cadVisibleBodyIds } from '@/domain/cad/cadSchema';
import { CadTopologyQuerySummary } from './CadTopologyQuerySummary';

export const featureLabels: Record<CadFeature['kind'], string> = {
  sketch: 'Sketch', imported: 'Imported solid', extrude: 'Pad / Pocket', revolve: 'Revolve', fillet: 'Fillet', chamfer: 'Chamfer', shell: 'Shell', boolean: 'Boolean', transform: 'Move / Rotate', 'linear-pattern': 'Linear pattern', mirror: 'Mirror',
};

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { value: T; label: string; disabled?: boolean }[]; onChange(value: T): void }) {
  return <label className="cad-field"><span>{label}</span><select value={value} onChange={(event) => { const option = options.find((entry) => entry.value === event.target.value); if (option && !option.disabled) onChange(option.value); }}>{options.map((option) => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select></label>;
}

export function ScalarField({ label, value, parameters, onChange, unit = 'mm' }: { label: string; value: CadScalar; parameters: CadDocument['parameters']; onChange(value: CadScalar): void; unit?: string }) {
  let resolved: string;
  let invalid = false;
  try { resolved = `${Number(evaluateCadScalar(value, parameters).toFixed(6))} ${unit}`; }
  catch (error) { invalid = true; resolved = error instanceof Error ? error.message : 'Invalid expression'; }
  const showResult = invalid || typeof value === 'string' && !Number.isFinite(Number(value));
  return <label className={`cad-field ${invalid ? 'is-invalid' : ''}`}><span>{label}<small>{unit}</small></span><input value={value} spellCheck={false} title="Number or parameter expression, e.g. width / 2" aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} />{showResult && <small className="cad-field-hint">{resolved}</small>}</label>;
}

const planeOptions = (['XY', 'XZ', 'YZ'] satisfies CadPlane[]).map((value) => ({ value, label: `${value} plane` }));
const operationOptions = [{ value: 'new', label: 'New body' }, { value: 'join', label: 'Join to body' }, { value: 'cut', label: 'Cut from body' }] satisfies { value: 'new' | 'join' | 'cut'; label: string }[];

export function CadFeatureEditor({ feature, document, isNew, onApply, onCancel, onPendingChange, currentBodyIds }: {
  feature: CadFeature;
  document: CadDocument;
  isNew: boolean;
  onApply(feature: CadFeature): void;
  onCancel(): void;
  onPendingChange(pending: boolean): void;
  currentBodyIds?: readonly string[];
}) {
  const [draft, setDraft] = useState(feature);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capturedEdges = feature.kind === 'fillet' || feature.kind === 'chamfer' ? feature.selection : null;
  useEffect(() => { setDraft(feature); setChanged(false); setError(null); }, [feature]);
  useLayoutEffect(() => { onPendingChange(isNew || changed); }, [isNew, changed, onPendingChange]);
  const update = (next: CadFeature) => { setDraft(next); setChanged(true); setError(null); };
  const featureIndex = document.features.findIndex((entry) => entry.id === feature.id);
  const preceding = featureIndex < 0 ? document.features : document.features.slice(0, featureIndex);
  const visibleIds = cadVisibleBodyIds(preceding);
  const bodies = preceding.filter((entry) => visibleIds.includes(entry.id) && (!currentBodyIds || currentBodyIds.includes(entry.id))).map((entry) => ({ value: entry.id, label: entry.name }));
  const sketches = preceding.filter((entry) => entry.kind === 'sketch' && !entry.suppressed).map((entry) => ({ value: entry.id, label: entry.name }));
  const scalar = (label: string, value: CadScalar, onChange: (next: CadScalar) => void, unit?: string) => <ScalarField label={label} value={value} parameters={document.parameters} onChange={onChange} unit={unit} />;
  const body = (label: string, value: string, onChange: (next: string) => void) => <SelectField label={label} value={value} options={bodies} onChange={onChange} />;
  let fields: React.ReactNode;
  switch (draft.kind) {
    case 'imported': fields = <><dl className="cad-topology-details"><dt>Source file</dt><dd>{draft.source.fileName}</dd><dt>Format</dt><dd>{draft.source.format.toUpperCase()}</dd>{draft.source.format === 'stl' && <><dt>Source units</dt><dd>{draft.source.units === 'inch' ? 'inch' : 'mm'}</dd></>}</dl><p className="cad-inspector-note">Imported geometry is fixed. Add features to modify the solid.</p></>; break;
    case 'sketch': fields = <><SelectField label="Reference plane" value={draft.plane} options={planeOptions} onChange={(plane) => update({ ...draft, plane })} />{scalar('Plane offset', draft.offset, (offset) => update({ ...draft, offset }))}{draft.source && <dl className="cad-topology-details"><dt>Source file</dt><dd>{draft.source.fileName}</dd><dt>Source units</dt><dd>{draft.source.units ?? 'File declaration'}</dd></dl>}</>; break;
    case 'extrude':
    case 'revolve': {
      fields = <><SelectField label="Profile sketch" value={draft.sketchId} options={sketches} onChange={(sketchId) => update({ ...draft, sketchId })} />
        {draft.kind === 'extrude' ? <>{scalar('Length', draft.distance, (distance) => update({ ...draft, distance }))}<label className="cad-check"><input type="checkbox" checked={draft.symmetric} onChange={(event) => update({ ...draft, symmetric: event.target.checked })} /> Symmetric about sketch plane</label></> : <>{scalar('Angle', draft.angle, (angle) => update({ ...draft, angle }), 'deg')}<SelectField label="Sketch axis" value={draft.axis} options={[{ value: 'x', label: 'Horizontal X' }, { value: 'y', label: 'Vertical Y' }]} onChange={(axis) => update({ ...draft, axis })} /></>}
        <SelectField label="Operation" value={draft.operation} options={operationOptions} onChange={(operation) => update({ ...draft, operation, targetId: operation === 'new' ? null : draft.targetId ?? bodies.at(-1)?.value ?? null })} />
        {draft.operation !== 'new' && body('Target body', draft.targetId ?? '', (targetId) => update({ ...draft, targetId }))}
      </>; break;
    }
    case 'fillet':
    case 'chamfer': fields = <>{body('Body', draft.targetId, (targetId) => update({ ...draft, targetId }))}<SelectField label="Scope" value={draft.selection ? 'selected' : 'all'} options={[{ value: 'all', label: 'All edges of the body' }, { value: 'selected', label: capturedEdges ? `Selected edges (${capturedEdges.expectedCount})` : 'Selected edges, pick before starting', disabled: !capturedEdges }]} onChange={(scope) => update({ ...draft, selection: scope === 'selected' ? capturedEdges : null })} />{scalar(draft.kind === 'fillet' ? 'Radius' : 'Distance', draft.radius, (radius) => update({ ...draft, radius }))}{draft.selection ? <CadTopologyQuerySummary selection={draft.selection} /> : <p className="cad-inspector-note">Applies to every edge of the body. To use selected edges, cancel, pick edges and start this operation again.</p>}</>; break;
    case 'shell': fields = <>{body('Body', draft.targetId, (targetId) => update({ ...draft, targetId }))}{scalar('Wall thickness', draft.thickness, (thickness) => update({ ...draft, thickness }))}<p className="cad-inspector-note">Removes one planar opening face and offsets the remaining walls inward. Thickness must fit inside the body.</p><CadTopologyQuerySummary selection={draft.opening} /></>; break;
    case 'boolean': fields = <>{body('Target body', draft.targetId, (targetId) => update({ ...draft, targetId }))}{body('Tool body', draft.toolId, (toolId) => update({ ...draft, toolId }))}<SelectField label="Operation" value={draft.operation} options={[{ value: 'union', label: 'Union' }, { value: 'cut', label: 'Subtract tool' }, { value: 'intersect', label: 'Intersection' }]} onChange={(operation) => update({ ...draft, operation })} /></>; break;
    case 'transform': fields = <>{body('Body', draft.sourceId, (sourceId) => update({ ...draft, sourceId }))}<div className="cad-field-section">Translation</div>{scalar('X', draft.translation[0], (value) => update({ ...draft, translation: [value, draft.translation[1], draft.translation[2]] }))}{scalar('Y', draft.translation[1], (value) => update({ ...draft, translation: [draft.translation[0], value, draft.translation[2]] }))}{scalar('Z', draft.translation[2], (value) => update({ ...draft, translation: [draft.translation[0], draft.translation[1], value] }))}<div className="cad-field-section">Rotation about world origin</div>{scalar('Around X', draft.rotation[0], (value) => update({ ...draft, rotation: [value, draft.rotation[1], draft.rotation[2]] }), 'deg')}{scalar('Around Y', draft.rotation[1], (value) => update({ ...draft, rotation: [draft.rotation[0], value, draft.rotation[2]] }), 'deg')}{scalar('Around Z', draft.rotation[2], (value) => update({ ...draft, rotation: [draft.rotation[0], draft.rotation[1], value] }), 'deg')}</>; break;
    case 'linear-pattern': fields = <>{body('Body', draft.sourceId, (sourceId) => update({ ...draft, sourceId }))}<label className="cad-field"><span>Instances, including original</span><input type="number" min="2" max="100" value={draft.count} onChange={(event) => update({ ...draft, count: Number(event.target.value) })} /></label><div className="cad-field-section">Spacing between instances</div>{scalar('X', draft.spacing[0], (value) => update({ ...draft, spacing: [value, draft.spacing[1], draft.spacing[2]] }))}{scalar('Y', draft.spacing[1], (value) => update({ ...draft, spacing: [draft.spacing[0], value, draft.spacing[2]] }))}{scalar('Z', draft.spacing[2], (value) => update({ ...draft, spacing: [draft.spacing[0], draft.spacing[1], value] }))}</>; break;
    case 'mirror': fields = <>{body('Body', draft.sourceId, (sourceId) => update({ ...draft, sourceId }))}<SelectField label="Mirror plane through origin" value={draft.plane} options={planeOptions} onChange={(plane) => update({ ...draft, plane })} /></>; break;
  }
  return <form className="cad-property-form" onSubmit={(event) => { event.preventDefault(); try { onApply(draft); setChanged(false); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply this feature.'); } }}>
    <div className="cad-property-title">{isNew ? 'Create' : 'Edit'} {featureLabels[draft.kind]}</div>
    <label className="cad-field"><span>Name</span><input value={draft.name} onChange={(event) => update({ ...draft, name: event.target.value })} /></label>
    {fields}
    {error && <p className="cad-error" role="alert">{error}</p>}
    {(isNew || changed) && <div className="cad-form-actions"><button type="button" onClick={onCancel}><X size={13} /> Cancel</button><button type="submit" className="cad-primary" disabled={!isNew && !changed}><Check size={13} /> Apply</button></div>}
  </form>;
}

export function CadProfileEditor({ profile, document, onApply, onCancel, onPendingChange }: {
  profile: CadSketchProfile;
  document: CadDocument;
  onApply(profile: CadSketchProfile): void;
  onCancel(): void;
  onPendingChange(pending: boolean): void;
}) {
  const [draft, setDraft] = useState(profile);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(profile); setChanged(false); setError(null); }, [profile]);
  useLayoutEffect(() => { onPendingChange(changed); }, [changed, onPendingChange]);
  const update = (next: CadSketchProfile) => { setDraft(next); setChanged(true); };
  const scalar = (label: string, value: CadScalar, onChange: (next: CadScalar) => void, unit?: string) => <ScalarField label={label} value={value} parameters={document.parameters} onChange={onChange} unit={unit} />;
  const geometry = draft.geometry;
  let fields: React.ReactNode;
  switch (geometry.kind) {
    case 'rectangle': fields = <>{scalar('Origin X', geometry.x, (x) => update({ ...draft, geometry: { ...geometry, x } }))}{scalar('Origin Y', geometry.y, (y) => update({ ...draft, geometry: { ...geometry, y } }))}{scalar('Width', geometry.width, (width) => update({ ...draft, geometry: { ...geometry, width } }))}{scalar('Height', geometry.height, (height) => update({ ...draft, geometry: { ...geometry, height } }))}{scalar('Corner radius', geometry.cornerRadius, (cornerRadius) => update({ ...draft, geometry: { ...geometry, cornerRadius } }))}</>; break;
    case 'circle': fields = <>{scalar('Center X', geometry.x, (x) => update({ ...draft, geometry: { ...geometry, x } }))}{scalar('Center Y', geometry.y, (y) => update({ ...draft, geometry: { ...geometry, y } }))}{scalar('Radius', geometry.radius, (radius) => update({ ...draft, geometry: { ...geometry, radius } }))}</>; break;
    case 'slot': fields = <>{scalar('Center X', geometry.x, (x) => update({ ...draft, geometry: { ...geometry, x } }))}{scalar('Center Y', geometry.y, (y) => update({ ...draft, geometry: { ...geometry, y } }))}{scalar('Length', geometry.length, (length) => update({ ...draft, geometry: { ...geometry, length } }))}{scalar('Width', geometry.width, (width) => update({ ...draft, geometry: { ...geometry, width } }))}{scalar('Angle', geometry.angle, (angle) => update({ ...draft, geometry: { ...geometry, angle } }), 'deg')}</>; break;
    case 'polygon': fields = <>{geometry.points.map((point, index) => <div className="cad-vertex-fields" key={index}><span>Vertex {index + 1}</span>{scalar('X', point[0], (x) => update({ ...draft, geometry: { ...geometry, points: geometry.points.map((entry, i) => i === index ? [x, entry[1]] : entry) } }))}{scalar('Y', point[1], (y) => update({ ...draft, geometry: { ...geometry, points: geometry.points.map((entry, i) => i === index ? [entry[0], y] : entry) } }))}</div>)}</>; break;
    case 'path': fields = <><div className="cad-field-section">Analytic path</div><dl className="cad-topology-details"><dt>Segments</dt><dd>{geometry.segments.length}</dd><dt>Lines</dt><dd>{geometry.segments.filter((segment) => segment.kind === 'line').length}</dd><dt>Arcs</dt><dd>{geometry.segments.filter((segment) => segment.kind === 'arc').length}</dd></dl><p className="cad-inspector-note">Line and arc geometry is retained exactly. Segment dimensions are read-only in this editor.</p></>; break;
  }
  return <form className="cad-property-form" onSubmit={(event) => { event.preventDefault(); try { onApply({ id: draft.id, name: draft.name, construction: draft.construction, geometry: draft.geometry }); setChanged(false); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply this profile.'); } }}>
    <div className="cad-property-title">{geometry.kind} profile</div>
    <label className="cad-field"><span>Name</span><input value={draft.name} onChange={(event) => update({ ...draft, name: event.target.value })} /></label>
    <label className="cad-check"><input type="checkbox" checked={draft.construction} onChange={(event) => update({ ...draft, construction: event.target.checked })} /> Construction geometry</label>
    {fields}
    {error && <p role="alert" className="cad-error">{error}</p>}
    {changed && <div className="cad-form-actions"><button type="button" onClick={onCancel}><X size={13} /> Cancel</button><button type="submit" className="cad-primary" disabled={!changed}><Check size={13} /> Apply</button></div>}
  </form>;
}
