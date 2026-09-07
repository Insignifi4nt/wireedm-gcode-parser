import { useMemo, useState } from 'react';
import { measurePointPair, measureSegment, measureProfile, type MeasurementPick } from '@/domain/editor/geometryMeasurement';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { EditorMeasurementState } from './useEditorMeasurement';

export function EditorMeasurePanel({ measurement, document }: {
  measurement: EditorMeasurementState;
  document: PathPlanningDocument;
}) {
  const { picks, hover, precision } = measurement;
  const [inspectedPoint, setInspectedPoint] = useState<'A' | 'B'>('B');
  const first = picks[0];
  const second = picks[1] ?? hover;
  const pair = first && second ? measurePointPair(first.point, second.point) : null;
  const inspected = inspectedPoint === 'A' ? first : picks[1] ?? first;
  const target = inspected?.kind === 'geometry' ? inspected : picks.find((pick) => pick.kind === 'geometry') ?? inspected ?? hover;
  const canSwitchGeometry = first?.kind === 'geometry' && picks[1]?.kind === 'geometry' && first.segmentId !== picks[1].segmentId;
  const segment = target?.kind === 'geometry' ? document.segments.find(({ id }) => id === target.segmentId) : null;
  const dimensions = segment ? measureSegment(segment) : null;
  const boundary = useMemo(() => {
    if (!segment) return null;
    const operation = document.plan.operations.find(({ segmentRefs }) => segmentRefs.some(({ segmentId }) => segmentId === segment.id));
    if (!operation) return null;
    const profile = measureProfile(operation.segmentRefs, document.segments);
    if (!profile) return null;
    const contour = document.contours.find(({ id }) => id === operation.contourId);
    const areaAllowed = operation.closed && contour && contour.classification !== 'ambiguous' &&
      !document.diagnostics.some((diagnostic) =>
        (diagnostic.code === 'self-intersection' || diagnostic.code === 'intersecting-topology') &&
        ((!diagnostic.relatedSegmentIds?.length && !diagnostic.relatedContourIds?.length) ||
          diagnostic.relatedContourIds?.some((id) => id === operation.contourId) ||
          diagnostic.relatedSegmentIds?.some((id) => operation.segmentRefs.some((ref) => ref.segmentId === id)))
      );
    return { ...profile, label: operation.displayName, area: areaAllowed && profile.signedArea !== null ? Math.abs(profile.signedArea) : null };
  }, [document, segment]);
  const format = (value: number) => value.toFixed(precision);
  return (
    <div className="space-y-2 text-xs" data-editor-measure-panel>
      <p className="text-muted-foreground" role="status">
        {!first ? 'Pick the first point on the canvas.' : picks.length < 2 ? 'Pick the second point.' : 'Pick again to continue measuring.'}
      </p>
      {document.machiningParticipation?.spans.some((span) => span.participation === 'inactive-reference') && (
        <p className="text-muted-foreground">Geometry dimensions and snap points refer to the complete source geometry, including inactive ranges.</p>
      )}
      <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2">
        <input checked={measurement.snapEnabled} onChange={(event) => measurement.setSnapEnabled(event.target.checked)} type="checkbox" />
        Snap to geometry
      </label>
      <button className="h-7 border border-border px-2 hover:bg-accent disabled:opacity-40" disabled={!first} onClick={measurement.clear} type="button">Clear measurement</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">Repeat
          <select aria-label="Measurement repeat mode" className="h-7 w-full border border-border bg-background px-1" value={measurement.repeatMode} onChange={(event) => {
            const value = event.target.value;
            if (value === 'pair' || value === 'chain' || value === 'fixed') measurement.setRepeatMode(value);
          }}>
            <option value="pair">New pair</option><option value="chain">Chain</option><option value="fixed">Keep first point</option>
          </select>
        </label>
        <label className="space-y-1">Decimals
          <select aria-label="Measurement precision" className="h-7 w-full border border-border bg-background px-1" value={precision} onChange={(event) => measurement.setPrecision(Number(event.target.value))}>
            {[2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <dl className="technical-value space-y-1">
        {first && <PickRow label="A" pick={first} format={format} document={document} />}
        {second && <PickRow label={picks[1] ? 'B' : 'Preview'} pick={second} format={format} document={document} />}
      </dl>
      {pair && <dl className="technical-value space-y-1 border-t border-border pt-2" aria-label="Point measurements">
        <Result label="Point distance" value={`${format(pair.distance)} mm`} />
        <Result label="ΔX" value={`${format(pair.dx)} mm`} />
        <Result label="ΔY" value={`${format(pair.dy)} mm`} />
        {pair.angleDegrees !== null && <Result label="Angle from X" value={`${format(pair.angleDegrees)}°`} />}
      </dl>}
      {measurement.featurePair && <dl className="technical-value space-y-1 border-t border-border pt-2" aria-label="Feature measurements">
        <Result label="Minimum feature gap" value={`${format(measurement.featurePair.distance)} mm`} />
        {measurement.featurePair.centerDistance !== null && <Result label="Center distance" value={`${format(measurement.featurePair.centerDistance)} mm`} />}
        <div><dd className="text-muted-foreground">Between complete source edges. Cyan marks the closest pair.</dd></div>
      </dl>}
      {canSwitchGeometry && <div className="flex gap-1" aria-label="Inspect measured geometry">
        {(['A', 'B'] as const).map((label, index) => <button key={label} type="button"
          className="h-7 flex-1 border border-border px-2 aria-pressed:bg-accent disabled:opacity-40"
          aria-pressed={inspectedPoint === label} disabled={picks[index]?.kind !== 'geometry'}
          onClick={() => setInspectedPoint(label)}>Inspect {label}</button>)}
      </div>}
      {dimensions && <dl className="technical-value space-y-1 border-t border-border pt-2" aria-label="Selected geometry measurements">
        <div><dt className="sr-only">Geometry</dt><dd className="text-muted-foreground" data-measurement-reference>{target && measurementReference(document, target)}</dd></div>
        <Result label={dimensions.kind === 'circle' ? 'Circumference' : 'Length'} value={`${format(dimensions.length)} mm`} />
        {dimensions.kind !== 'line' && <>
          <Result label="Radius" value={`${format(dimensions.radius)} mm`} />
          <Result label="Diameter" value={`${format(dimensions.diameter)} mm`} />
        </>}
        {dimensions.kind === 'arc' && <Result label="Sweep" value={`${format(dimensions.sweepDegrees)}°`} />}
        {dimensions.kind === 'circle' && <Result label="Area" value={`${format(dimensions.area)} mm²`} />}
      </dl>}
      {boundary && <details className="border-t border-border pt-2">
        <summary className="cursor-pointer text-muted-foreground">Contour dimensions</summary>
        <p className="my-1 truncate text-muted-foreground" title={boundary.label}>{boundary.label}</p>
        <dl className="technical-value space-y-1" aria-label="Contour measurements">
          <Result label="Boundary length" value={`${format(boundary.length)} mm`} />
          <Result label="Width" value={`${format(boundary.width)} mm`} />
          <Result label="Height" value={`${format(boundary.height)} mm`} />
          {boundary.area !== null && <Result label="Enclosed area" value={`${format(boundary.area)} mm²`} />}
        </dl>
      </details>}
    </div>
  );
}

function PickRow({ label, pick, format, document }: { label: string; pick: MeasurementPick; format: (value: number) => string; document: PathPlanningDocument }) {
  return <div>
    <dt className="text-muted-foreground">{label} · {pick.kind === 'free' ? 'Free point' : pick.snap}</dt>
    <dd>{format(pick.point.x)}, {format(pick.point.y)} mm</dd>
    {pick.kind === 'geometry' && <dd className="text-muted-foreground">{measurementReference(document, pick)}</dd>}
  </div>;
}

function measurementReference(document: PathPlanningDocument, pick: MeasurementPick) {
  if (pick.kind === 'free') return 'Free point';
  const operation = document.plan.operations.find((candidate) => candidate.segmentRefs.some((ref) => ref.segmentId === pick.segmentId));
  if (!operation) return 'Source geometry';
  const index = operation.segmentRefs.findIndex((ref) => ref.segmentId === pick.segmentId);
  return `${operation.displayName} · Segment ${index + 1}`;
}

function Result({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd>{value}</dd></div>;
}
