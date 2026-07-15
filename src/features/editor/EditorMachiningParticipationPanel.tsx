import { useEffect, useMemo, useState } from 'react';

import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

interface EditorMachiningParticipationPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  onDraftChange?: () => void;
  onSetSpan: (input: {
    sourceSegmentId: string;
    range: { start: number; end: number };
    participation: 'active-cut' | 'inactive-reference';
  }, completeForm?: boolean) => void;
  onSetEntryReview: (sourceOperationId: string, reviewed: boolean) => void;
  onSetWireSide: (sourceOperationId: string, wireSide: 'left' | 'right' | null) => void;
  selectedOperationId: string | null;
  selectedSegmentId?: string | null;
}

export function EditorMachiningParticipationPanel({
  disabled,
  document,
  onDraftChange,
  onSetSpan,
  onSetEntryReview,
  onSetWireSide,
  selectedOperationId,
  selectedSegmentId
}: EditorMachiningParticipationPanelProps) {
  const operation = document.plan.operations.find(
    (candidate) => candidate.id === selectedOperationId
  ) ?? document.plan.operations[0] ?? null;
  const segmentIds = operation?.segmentRefs.map((ref) => ref.segmentId) ?? [];
  const initialSegmentId = selectedSegmentId && segmentIds.includes(selectedSegmentId)
    ? selectedSegmentId
    : segmentIds[0] ?? '';
  const [sourceSegmentId, setSourceSegmentId] = useState(initialSegmentId);
  const [rangeStart, setRangeStart] = useState('0');
  const [rangeEnd, setRangeEnd] = useState('1');

  useEffect(() => {
    if (selectedSegmentId && segmentIds.includes(selectedSegmentId)) {
      setSourceSegmentId(selectedSegmentId);
    } else if (!segmentIds.includes(sourceSegmentId)) {
      setSourceSegmentId(segmentIds[0] ?? '');
    }
  }, [selectedSegmentId, segmentIds.join('|'), sourceSegmentId]);

  const spans = useMemo(
    () => (document.machiningParticipation?.spans ?? []).filter(
      (span) => segmentIds.includes(span.sourceSegmentId)
    ),
    [document.machiningParticipation?.spans, segmentIds.join('|')]
  );
  const derived = deriveActiveMachiningOperations(document);
  const wireSide = document.machiningParticipation?.partialContourCompensation?.find(
    (setting) => setting.sourceOperationId === operation?.id
  )?.wireSide ?? '';
  const entryReviewed = document.machiningParticipation?.partialContourEntryReviews?.some(
    (setting) => setting.sourceOperationId === operation?.id && setting.review === 'reviewed'
  ) ?? false;
  const start = Number(rangeStart);
  const end = Number(rangeEnd);
  const validRange = Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1 && start < end;

  if (!operation) return <p className="text-[10px] text-muted-foreground">No operation selected.</p>;

  return (
    <section className="grid gap-2 text-[10px]" data-machining-participation-panel>
      <div className="border border-border bg-background/35 p-2">
        <div className="uppercase text-muted-foreground">{operation.displayName}</div>
        <p className={derived.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>
          {derived.status === 'ready'
            ? `${derived.operations.length} active machining operation${derived.operations.length === 1 ? '' : 's'}`
            : `Blocked: ${derived.reason}`}
        </p>
        <p className="mt-1 text-muted-foreground">
          Source geometry remains intact. Inactive ranges are reference-only and are omitted from posted cutting moves.
        </p>
      </div>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Retained machining span</legend>
        <label className="grid gap-0.5 text-muted-foreground">
          Source segment
          <select
            aria-label="Machining source segment"
            className="h-7 border border-border bg-background px-1 font-mono text-foreground"
            onChange={(event) => {
              setSourceSegmentId(event.currentTarget.value);
              onDraftChange?.();
            }}
            value={sourceSegmentId}
          >
            {segmentIds.map((segmentId, index) => (
              <option key={segmentId} value={segmentId}>Segment {index + 1} · {segmentId}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-1">
          <label className="grid gap-0.5 text-muted-foreground">
            Start (0..1)
            <input
              aria-label="Machining span start"
              className="h-7 border border-border bg-background px-1 font-mono text-foreground"
              onChange={(event) => {
                setRangeStart(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={rangeStart}
            />
          </label>
          <label className="grid gap-0.5 text-muted-foreground">
            End (0..1)
            <input
              aria-label="Machining span end"
              className="h-7 border border-border bg-background px-1 font-mono text-foreground"
              onChange={(event) => {
                setRangeEnd(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={rangeEnd}
            />
          </label>
        </div>
        <button
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={!sourceSegmentId || !validRange}
          onClick={() => onSetSpan({
            sourceSegmentId,
            range: { start, end },
            participation: 'inactive-reference'
          }, true)}
          type="button"
        >
          Mark inactive reference
        </button>
      </fieldset>

      <label className="grid gap-1 border border-border p-2 uppercase text-muted-foreground">
        Partial-path controller side
        <select
          aria-label="Partial contour wire side"
          className="h-7 border border-border bg-background px-1 text-foreground"
          disabled={disabled}
          onChange={(event) => onSetWireSide(
            operation.id,
            event.currentTarget.value === ''
              ? null
              : event.currentTarget.value as 'left' | 'right'
          )}
          value={wireSide}
        >
          <option value="">Required for controller compensation</option>
          <option value="left">Wire left of travel (G41)</option>
          <option value="right">Wire right of travel (G42)</option>
        </select>
      </label>

      <div className="grid gap-1 border border-border p-2">
        <div className="uppercase text-muted-foreground">Derived partial entry</div>
        <p className="text-muted-foreground">
          Partial machining changes the contour endpoint. Review its retargeted manual entry before export.
        </p>
        <button
          aria-label="Review derived partial entry"
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={disabled}
          onClick={() => onSetEntryReview(operation.id, !entryReviewed)}
          type="button"
        >
          {entryReviewed ? 'Entry reviewed · revoke' : 'Review derived entry'}
        </button>
      </div>

      <div className="grid gap-1">
        {spans.length === 0 ? (
          <p className="text-muted-foreground">All source segments are active cuts.</p>
        ) : spans.map((span) => (
          <div className="grid grid-cols-[1fr_auto] items-center gap-2 border border-border p-2" key={span.id}>
            <div>
              <div className="font-mono text-foreground">{span.sourceSegmentId}</div>
              <div className="text-muted-foreground">
                {span.range.start}..{span.range.end} · {span.participation}
              </div>
            </div>
            <button
              aria-label={`Restore ${span.id} to active cut`}
              className="h-7 border border-border px-2"
              disabled={disabled}
              onClick={() => onSetSpan({
                sourceSegmentId: span.sourceSegmentId,
                range: span.range,
                participation: 'active-cut'
              }, false)}
              type="button"
            >
              Restore
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
