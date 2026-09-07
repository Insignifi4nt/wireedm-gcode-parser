import { useEffect, useMemo, useRef, useState } from 'react';

import { deriveSourceMachiningOperations } from '@/domain/path-intel/machiningParticipation';
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
  onSetExitReview: (sourceOperationId: string, reviewed: boolean) => void;
  onSetWireSide: (sourceOperationId: string, wireSide: 'left' | 'right' | null) => void;
  selectedOperationId: string | null;
  selectedSegmentId?: string | null;
  selectedSpanId?: string | null;
  targetChangeBlocked?: boolean;
}

export function EditorMachiningParticipationPanel({
  disabled,
  document,
  onDraftChange,
  onSetSpan,
  onSetEntryReview,
  onSetExitReview,
  onSetWireSide,
  selectedOperationId,
  selectedSegmentId,
  selectedSpanId = null,
  targetChangeBlocked = false
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
  const [rangeEnd, setRangeEnd] = useState('100');
  const spanListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (targetChangeBlocked) return;
    if (selectedSegmentId && segmentIds.includes(selectedSegmentId)) {
      setSourceSegmentId(selectedSegmentId);
    } else if (!segmentIds.includes(sourceSegmentId)) {
      setSourceSegmentId(segmentIds[0] ?? '');
    }
  }, [selectedSegmentId, segmentIds.join('|'), sourceSegmentId, targetChangeBlocked]);

  const spans = useMemo(
    () => (document.machiningParticipation?.spans ?? []).filter(
      (span) => segmentIds.includes(span.sourceSegmentId)
    ),
    [document.machiningParticipation?.spans, segmentIds.join('|')]
  );
  const derived = deriveSourceMachiningOperations(document, operation?.id ?? '');
  const partialOperation = derived?.status === 'ready'
    ? derived.operations.find((candidate) => candidate.machiningIntent?.sourceOperationId === operation?.id)
    : undefined;
  const derivedSpanIds = partialOperation?.machiningIntent?.spanIds ?? [];
  const segmentLengths = new Map(derived?.segments.map((segment) => [segment.id, segment.length]) ?? []);
  useEffect(() => {
    if (!selectedSpanId) return;
    const selectedRow = [...(
      spanListRef.current?.querySelectorAll<HTMLElement>('[data-machining-span-id]') ?? []
    )].find((row) => row.dataset.machiningSpanId === selectedSpanId);
    selectedRow?.scrollIntoView?.({ block: 'nearest' });
  }, [
    selectedSpanId,
    derivedSpanIds.join('|'),
    spans.map((span) => span.id).join('|')
  ]);
  const wireSide = document.machiningParticipation?.partialContourCompensation?.find(
    (setting) => setting.sourceOperationId === operation?.id
  )?.wireSide ?? '';
  const partialEntry = partialOperation?.transitions?.entry;
  const entryReviewed = partialEntry && 'review' in partialEntry && partialEntry.review === 'reviewed';
  const partialExit = partialOperation?.transitions?.exit;
  const sourceSegment = document.segments.find((segment) => segment.id === sourceSegmentId);
  const start = Number(rangeStart) / 100;
  const end = Number(rangeEnd) / 100;
  const validRange = rangeStart.trim() !== '' && rangeEnd.trim() !== '' && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= 1 && start < end;

  if (!operation || !derived) return <p className="text-[10px] text-muted-foreground">No operation selected.</p>;

  return (
    <section className="grid gap-2 text-[10px]" data-machining-participation-panel>
      <div className="border border-border bg-background/35 p-2">
        <div className="uppercase text-muted-foreground">{operation.displayName}</div>
        <p className={derived?.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>
          {derived?.status === 'ready'
            ? `${derived.operations.length} active machining operation${derived.operations.length === 1 ? '' : 's'}`
            : `Blocked: ${derived.reason}`}
        </p>
        <p className="mt-1 text-muted-foreground">
          Source geometry remains intact. Inactive ranges are reference-only and are omitted from posted cutting moves.
        </p>
      </div>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Exclude a range from cutting</legend>
        <label className="grid gap-0.5 text-muted-foreground">
          Source segment
          <select
            aria-label="Machining source segment"
            className="h-7 border border-border bg-background px-1 font-mono text-foreground"
            disabled={targetChangeBlocked}
            onChange={(event) => {
              if (targetChangeBlocked) return;
              setSourceSegmentId(event.currentTarget.value);
              onDraftChange?.();
            }}
            title={targetChangeBlocked
              ? 'Apply or discard the pending machining range before changing its source segment.'
              : undefined}
            value={sourceSegmentId}
          >
            {segmentIds.map((segmentId, index) => (
              <option key={segmentId} value={segmentId}>Segment {index + 1}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-1">
          <label className="grid gap-0.5 text-muted-foreground">
            Start (%)
            <input
              aria-label="Machining span start"
              inputMode="decimal"
              aria-describedby="machining-range-help"
              className="h-7 border border-border bg-background px-1 font-mono text-foreground"
              onChange={(event) => {
                setRangeStart(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={rangeStart}
            />
          </label>
          <label className="grid gap-0.5 text-muted-foreground">
            End (%)
            <input
              aria-label="Machining span end"
              inputMode="decimal"
              aria-describedby="machining-range-help"
              className="h-7 border border-border bg-background px-1 font-mono text-foreground"
              onChange={(event) => {
                setRangeEnd(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={rangeEnd}
            />
          </label>
        </div>
        <p id="machining-range-help" className="text-muted-foreground">
          {sourceSegment && <>From source start X{sourceSegment.start.x.toFixed(3)} Y{sourceSegment.start.y.toFixed(3)}; segment length {sourceSegment.length.toFixed(3)} mm. </>}
          {validRange && sourceSegment
            ? `${((end - start) * sourceSegment.length).toFixed(3)} mm will be excluded from cutting.`
            : 'Enter a start and end between 0% and 100%, with start before end.'}
        </p>
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

      {partialOperation && <label className="grid gap-1 border border-border p-2 uppercase text-muted-foreground">
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
          <option value="">{operation.compensationIntent?.mode === 'centerline' && operation.compensationIntent.source === 'manual'
            ? 'Wire centerline · source setting' : 'Choose a controller side'}</option>
          <option value="left">Wire left of travel</option>
          <option value="right">Wire right of travel</option>
        </select>
      </label>}

      {partialEntry && partialEntry.strategy !== 'circle-center' && <div className="grid gap-1 border border-border p-2">
        <div className="uppercase text-muted-foreground">Derived partial entry</div>
        <p className="text-muted-foreground">
          {partialEntry.strategy === 'none'
            ? 'Confirm starting directly at the active contour endpoint without an entry lead.'
            : 'Partial machining changes the contour endpoint. Review its retargeted manual entry before export.'}
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
      </div>}

      {partialExit?.strategy === 'manual-straight' && <div className="grid gap-1 border border-border p-2">
        <div className="uppercase text-muted-foreground">Partial exit</div>
        <p className="text-muted-foreground">
          Confirm the exit from ({partialExit.from.x.toFixed(3)}, {partialExit.from.y.toFixed(3)}) to ({partialExit.to.x.toFixed(3)}, {partialExit.to.y.toFixed(3)}) mm.
        </p>
        <button
          aria-label="Review derived partial exit"
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={disabled}
          onClick={() => onSetExitReview(operation.id, partialExit.review !== 'reviewed')}
          type="button"
        >
          {partialExit.review === 'reviewed' ? 'Exit reviewed · revoke' : 'Review partial exit'}
        </button>
      </div>}

      <div className="grid gap-1" data-machining-span-list ref={spanListRef}>
        {derivedSpanIds.length > 0 && <details
          open={selectedSpanId && derivedSpanIds.includes(selectedSpanId) ? true : undefined}
          className="border border-border"
        >
          <summary className="cursor-pointer px-2 py-1 text-muted-foreground">
            Active cut ranges · {derivedSpanIds.length}
          </summary>
        {derivedSpanIds.map((spanId, index) => (
          <div
            className={`border p-2 ${
              selectedSpanId === spanId
                ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                : 'border-border'
            }`}
            aria-current={selectedSpanId === spanId ? 'true' : undefined}
            data-machining-span-id={spanId}
            data-machining-span-participation="active-cut"
            data-upid-selected={selectedSpanId === spanId ? 'true' : undefined}
            key={spanId}
          >
            <div className="flex justify-between gap-2 text-foreground">
              <span>Active range {index + 1}</span>
              <span className="tabular-nums">{segmentLengths.get(partialOperation?.segmentRefs[index]?.segmentId ?? '')?.toFixed(3)} mm</span>
            </div>
          </div>
        ))}
        </details>}
        {spans.length === 0 && derivedSpanIds.length === 0 ? (
          <p className="text-muted-foreground">All source segments are active cuts.</p>
        ) : spans.map((span) => (
          <div
            className={`grid grid-cols-[1fr_auto] items-center gap-2 border p-2 ${
              selectedSpanId === span.id
                ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                : 'border-border'
            }`}
            aria-current={selectedSpanId === span.id ? 'true' : undefined}
            data-machining-span-id={span.id}
            data-machining-span-participation={span.participation}
            data-upid-selected={selectedSpanId === span.id ? 'true' : undefined}
            key={span.id}
          >
            <div>
              <div className="text-foreground">Segment {segmentIds.indexOf(span.sourceSegmentId) + 1}</div>
              <div className="text-muted-foreground">
                {Number((span.range.start * 100).toFixed(3))}%–{Number((span.range.end * 100).toFixed(3))}% · {span.participation === 'active-cut' ? 'Active cut' : 'Inactive reference'}
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
