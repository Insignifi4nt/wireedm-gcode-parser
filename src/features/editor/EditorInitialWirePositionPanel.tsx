import { useEffect, useMemo, useState } from 'react';

import { resolveInitialWirePosition } from '@/domain/path-intel/initialWirePosition';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';

interface EditorInitialWirePositionPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  onDraftChange?: () => void;
  onSetGeometryLinked: (segmentId: string) => void;
  onSetManual: (point: Point2) => void;
}

export function EditorInitialWirePositionPanel({
  disabled,
  document,
  onDraftChange,
  onSetGeometryLinked,
  onSetManual
}: EditorInitialWirePositionPanelProps) {
  const resolution = useMemo(() => resolveInitialWirePosition(document), [document]);
  const currentPoint = resolution.status === 'ready' ? resolution.point : null;
  const initial = document.setup?.initialWirePosition;
  const editablePoint = currentPoint ?? initial?.point ?? null;
  const linkedSegmentId = initial?.kind === 'geometry-linked' ? initial.reference.segmentId : null;
  const [xDraft, setXDraft] = useState(editablePoint ? String(editablePoint.x) : '');
  const [yDraft, setYDraft] = useState(editablePoint ? String(editablePoint.y) : '');

  useEffect(() => {
    if (!editablePoint) return;
    setXDraft(String(editablePoint.x));
    setYDraft(String(editablePoint.y));
  }, [editablePoint?.x, editablePoint?.y, initial?.kind, linkedSegmentId]);

  const circles = document.segments.filter((segment) => segment.kind !== 'line');
  const manualPoint = readFinitePoint(xDraft, yDraft);
  const hasUnappliedCoordinates = currentPoint
    ? !manualPoint || manualPoint.x !== currentPoint.x || manualPoint.y !== currentPoint.y
    : xDraft.trim() !== '' || yDraft.trim() !== '';

  function setManual() {
    if (!manualPoint || disabled) return;
    onSetManual(manualPoint);
  }

  return (
    <section className="grid gap-2 text-[10px]" data-initial-wire-position>
      <p className="leading-4 text-muted-foreground">
        Set the wire's starting coordinates in the part coordinate system. This does not move the wire.
      </p>
      <div className="border border-border bg-background/35 p-2">
        <div className="mb-1 uppercase text-muted-foreground">Current setup</div>
        <div className={resolution.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>
          {resolution.status === 'ready'
            ? `${resolution.source === 'geometry-linked' ? 'Geometry-linked' : 'Manual'} · reviewed`
            : initialWireBlockedLabel(resolution.reason)}
        </div>
        <div className="mt-1 font-mono text-foreground" data-initial-wire-position-preview>
          {currentPoint ? formatPoint(currentPoint) : 'A reviewed point is required'}
        </div>
      </div>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Exact part coordinates</legend>
        <div className="grid grid-cols-2 gap-1">
          <label className="grid gap-0.5 text-muted-foreground">
            X
            <input
              aria-label="Initial wire X"
              className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
              inputMode="decimal"
              onChange={(event) => {
                setXDraft(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={xDraft}
            />
          </label>
          <label className="grid gap-0.5 text-muted-foreground">
            Y
            <input
              aria-label="Initial wire Y"
              className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
              inputMode="decimal"
              onChange={(event) => {
                setYDraft(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={yDraft}
            />
          </label>
        </div>
        {hasUnappliedCoordinates && (
          <p aria-live="polite" className="leading-4 text-amber-300" data-initial-wire-position-pending>
            {manualPoint
              ? 'Coordinates are pending. Review and set the point to update START and the first connecting travel in the preview.'
              : 'Enter valid X and Y coordinates, then review and set the point to update the preview.'}
          </p>
        )}
        <button
          aria-label="Review and set manual initial wire position"
          className="h-7 border border-border bg-background px-2 text-foreground disabled:opacity-40"
          disabled={!manualPoint}
          onClick={setManual}
          type="button"
        >
          Review and set manual point
        </button>
      </fieldset>

      {circles.length > 0 && <div className="grid gap-1 border border-border p-2">
        <div className="uppercase text-muted-foreground">Or link to a circular source center</div>
        <p className="text-muted-foreground">The starting point follows the selected circle or arc when geometry moves.</p>
        {circles.map((circle, index) => {
          const owner = document.plan.operations.find((operation) => operation.segmentRefs.some((ref) => ref.segmentId === circle.id));
          const segmentIndex = owner?.segmentRefs.findIndex((ref) => ref.segmentId === circle.id) ?? index;
          const label = `${owner?.displayName ?? `Source ${index + 1}`} · ${circle.kind === 'circle' ? 'Circle center' : `Arc ${segmentIndex + 1} center`} · R${circle.radius.toFixed(3)}`;
          return (
            <button
              aria-label={`Link initial wire to ${label}`}
              aria-pressed={linkedSegmentId === circle.id}
              className="flex h-7 items-center justify-between border border-border bg-background px-2 text-left disabled:opacity-40"
              data-initial-wire-circle-center={circle.id}
              disabled={disabled}
              key={circle.id}
              onClick={() => {
                setXDraft(String(circle.center.x));
                setYDraft(String(circle.center.y));
                onSetGeometryLinked(circle.id);
              }}
              type="button"
            >
              <span className="min-w-0 truncate" title={label}>{label}</span>
              <span className="shrink-0 font-mono text-muted-foreground">
                X{circle.center.x.toFixed(3)} Y{circle.center.y.toFixed(3)}
              </span>
            </button>
          );
        })}
      </div>}
    </section>
  );
}

function readFinitePoint(xDraft: string, yDraft: string): Point2 | null {
  if (xDraft.trim() === '' || yDraft.trim() === '') return null;
  const point = { x: Number(xDraft), y: Number(yDraft) };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function formatPoint(point: Point2) {
  return `X${point.x.toFixed(3)} Y${point.y.toFixed(3)}`;
}

function initialWireBlockedLabel(reason: string) {
  if (reason === 'review-required') return 'Manual point needs review after geometry placement';
  if (reason === 'missing-reference') return 'Linked geometry is unavailable';
  if (reason === 'invalid-point') return 'Coordinates are invalid';
  return 'Not configured';
}
