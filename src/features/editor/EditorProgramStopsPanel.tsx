import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { programStopValidationError } from '@/domain/path-intel/programStops';
import { resolveSourceAfterContourTravel } from '@/domain/path-intel/afterContourTravel';
import { buildUpidEditorTree } from '@/domain/upid/upidEditorTree';
import { deriveActiveMachiningOperations } from '@/domain/path-intel/machiningParticipation';

import type {
  OperationProgramStop,
  OperationProgramStopPlacement,
  PathPlanningDocument
} from '@/domain/path-intel/types';

const stopReasonLabels = {
  'part-retention': 'Part retention',
  'operator-check': 'Operator check',
  manual: 'Manual'
} satisfies Record<OperationProgramStop['reason'], string>;

interface EditorProgramStopsPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  onDraftChange?: () => void;
  onSelectStop?: (operationId: string, stopId: string | null) => void;
  targetChangeBlocked?: boolean;
  onSetStops: (operationId: string, stops: OperationProgramStop[], completeForm?: boolean) => void;
  selectedOperationId: string | null;
  selectedStopId?: string | null;
}

export function EditorProgramStopsPanel({
  disabled,
  document,
  onDraftChange,
  onSelectStop,
  targetChangeBlocked = false,
  onSetStops,
  selectedOperationId,
  selectedStopId = null
}: EditorProgramStopsPanelProps) {
  const operation = document.plan.operations.find(
    (candidate) => candidate.id === selectedOperationId
  ) ?? document.plan.operations[0] ?? null;
  const [placement, setPlacement] = useState<OperationProgramStopPlacement['kind']>('before-operation-end');
  const [remaining, setRemaining] = useState('1');
  const [reason, setReason] = useState<OperationProgramStop['reason']>('part-retention');
  const [note, setNote] = useState('');
  const [addCompleted, setAddCompleted] = useState(false);
  const [selectedPlacement, setSelectedPlacement] = useState<OperationProgramStopPlacement['kind']>('before-operation-end');
  const [selectedRemaining, setSelectedRemaining] = useState('1');
  const [selectedReason, setSelectedReason] = useState<OperationProgramStop['reason']>('part-retention');
  const [selectedNote, setSelectedNote] = useState('');
  const [selectedEnabled, setSelectedEnabled] = useState(true);
  const [commitError, setCommitError] = useState<string | null>(null);
  const selectedPlacementRef = useRef<HTMLSelectElement>(null);
  const addPlacementRef = useRef<HTMLSelectElement>(null);
  const hadSelectedStop = useRef(false);
  const stops = operation?.programStops ?? [];
  const selectedStop = stops.find((stop) => stop.id === selectedStopId) ?? null;
  const savedStopId = selectedStop?.id ?? null;
  const savedPlacement = selectedStop?.placement.kind ?? 'before-operation-end';
  const savedRemaining = selectedStop?.placement.kind === 'before-operation-end'
    ? String(selectedStop.placement.remainingCutLengthMm)
    : selectedStop?.placement.kind === 'after-contour-distance' ? String(selectedStop.placement.travelLengthMm) : '1';
  const savedReason = selectedStop?.reason ?? 'part-retention';
  const savedNote = selectedStop?.note ?? '';
  const savedEnabled = selectedStop?.enabled ?? true;
  const executionTree = useMemo(() => buildUpidEditorTree(document), [document]);
  const effectiveOperations = useMemo(() => deriveActiveMachiningOperations(document), [document]);
  const travel = useMemo(() => operation ? resolveSourceAfterContourTravel(document, operation.id) : null,
    [document, operation]);
  const manualThreading = operation && (executionTree.status === 'ready'
    ? executionTree.spatialActions.some((action) => action.operationId === operation.id &&
        action.pause === 'generated-manual-thread')
    : effectiveOperations.status === 'ready' && effectiveOperations.operations.some((candidate) =>
        (candidate.machiningIntent?.sourceOperationId ?? candidate.id) === operation.id &&
        candidate.orderIndex > 0 &&
        (candidate.threadingTransition ?? document.setup?.threadingDefault)?.mode === 'manual'));

  useEffect(() => setAddCompleted(false), [operation?.id]);

  useEffect(() => {
    if (!savedStopId) {
      if (hadSelectedStop.current) addPlacementRef.current?.focus();
      hadSelectedStop.current = false;
      return;
    }
    hadSelectedStop.current = true;
    setSelectedPlacement(savedPlacement);
    setSelectedRemaining(savedRemaining);
    setSelectedReason(savedReason);
    setSelectedNote(savedNote);
    setSelectedEnabled(savedEnabled);
    selectedPlacementRef.current?.focus();
    // Editing another row clones every stop; only changes to this stop replace its draft.
  }, [operation?.id, savedStopId, savedPlacement, savedRemaining, savedReason, savedNote, savedEnabled]);

  if (!operation) return <p className="text-[10px] text-muted-foreground">No operation selected.</p>;
  const remainingValue = Number(remaining);
  const selectedRemainingValue = Number(selectedRemaining);
  const usedStopIds = new Set(stops.map((stop) => stop.id));
  let nextNumber = 1;
  while (usedStopIds.has(`stop-${nextNumber}`)) nextNumber += 1;
  const addedStop: OperationProgramStop = {
    id: `stop-${nextNumber}`,
    enabled: true,
    placement: placement === 'before-operation-end'
      ? { kind: placement, remainingCutLengthMm: remainingValue }
      : placement === 'after-contour-distance' ? { kind: placement, travelLengthMm: remainingValue }
      : { kind: placement },
    reason,
    ...(note.trim() ? { note: note.trim() } : {})
  };
  const replacement: OperationProgramStop | null = selectedStop ? {
    id: selectedStop.id,
    enabled: selectedEnabled,
    placement: selectedPlacement === 'before-operation-end'
      ? { kind: selectedPlacement, remainingCutLengthMm: selectedRemainingValue }
      : selectedPlacement === 'after-contour-distance' ? { kind: selectedPlacement, travelLengthMm: selectedRemainingValue }
      : { kind: selectedPlacement },
    reason: selectedReason,
    ...(selectedNote.trim() ? { note: selectedNote.trim() } : {})
  } : null;
  const addError = programStopValidationError(document, operation, addedStop, stops);
  const selectedError = replacement
    ? programStopValidationError(document, operation, replacement, stops)
    : null;
  const canAdd = addError === null;
  const canApplySelected = selectedError === null;

  function commit(nextStops: OperationProgramStop[], completeForm = false) {
    if (disabled || !operation) return;
    for (const stop of nextStops) {
      if (stop === stops.find((previous) => previous.id === stop.id)) continue;
      const error = programStopValidationError(document, operation, stop, nextStops);
      if (error) {
        setCommitError(error);
        return;
      }
    }
    setCommitError(null);
    setAddCompleted(false);
    onSetStops(operation.id, nextStops, completeForm);
  }

  function addStop() {
    if (!canAdd || disabled) return;
    commit([...stops, addedStop], true);
    setAddCompleted(true);
  }

  function applySelectedStop() {
    if (!selectedStop || !replacement || !canApplySelected || disabled) return;
    commit(replaceStop(stops, selectedStop.id, replacement), true);
  }

  function removeSelectedStop() {
    if (!selectedStop || disabled) return;
    commit(stops.filter((stop) => stop.id !== selectedStop.id), true);
  }

  return (
    <section className="grid gap-2 text-[10px]" data-program-stops-panel>
      {commitError && <p role="alert" className="text-red-300">{commitError}</p>}
      <div>
        <div className="uppercase text-muted-foreground">{operation.displayName}</div>
        <p className="mt-1 text-muted-foreground">
          Stops belong to {operation.displayName}. Choose a machining phase or an exact distance along the planned path.
        </p>
        {manualThreading && <p className="mt-1 text-amber-300">
          Manual rethreading already adds a pause after positioning. Another stop at that point creates a second pause.
        </p>}
      </div>

      {selectedStop ? onSelectStop && <button
        className="h-7 border border-border bg-background disabled:opacity-40"
        disabled={disabled || targetChangeBlocked}
        onClick={() => onSelectStop(operation.id, null)}
        title={targetChangeBlocked ? 'Apply the pending form before creating another stop.' : undefined}
        type="button"
      >New stop</button> : <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}
        onChange={() => setAddCompleted(false)}>
        <legend className="px-1 uppercase text-muted-foreground">Add stop</legend>
        <ProgramStopFields labelPrefix="Program stop" placement={placement} remaining={remaining}
          reason={reason} note={note} onPlacementChange={setPlacement} onRemainingChange={setRemaining}
          onReasonChange={setReason} onNoteChange={setNote} onDraftChange={onDraftChange} placementRef={addPlacementRef}
          hasExit={Boolean(operation.transitions?.exit && operation.transitions.exit.strategy !== 'none')}
          travelLengthMm={travel?.status === 'ready' ? travel.path.totalLengthMm : null} />
        {addCompleted
          ? <p role="status" className="text-muted-foreground">Stop added. Change the placement to add another.</p>
          : addError && <p role="alert" className="text-red-300">{addError}</p>}
        <button
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={!canAdd}
          onClick={addStop}
          type="button"
        >
          Add program stop
        </button>
      </fieldset>}

      <div className="grid gap-1">
        {stops.length === 0 ? (
          <p className="text-muted-foreground">No user-authored stops.</p>
        ) : stops.map((stop) => {
          const isSelected = stop.id === selectedStop?.id;
          return (
            <div
              className="border border-border p-2"
              data-program-stop={stop.id}
              data-selected={isSelected ? 'true' : undefined}
              key={stop.id}
            >
              {isSelected ? (
                <fieldset className="grid gap-1" disabled={disabled}>
                  <legend className="px-1 uppercase text-muted-foreground">Edit {stop.id}</legend>
                  <ProgramStopFields labelPrefix="Selected stop" placement={selectedPlacement} remaining={selectedRemaining}
                    reason={selectedReason} note={selectedNote} onPlacementChange={setSelectedPlacement}
                    onRemainingChange={setSelectedRemaining} onReasonChange={setSelectedReason}
                    onNoteChange={setSelectedNote} onDraftChange={onDraftChange} placementRef={selectedPlacementRef}
                    hasExit={Boolean(operation.transitions?.exit && operation.transitions.exit.strategy !== 'none')}
                    travelLengthMm={travel?.status === 'ready' ? travel.path.totalLengthMm : null} />
                  <label className="flex items-center gap-2 text-muted-foreground">
                    <input
                      aria-label="Selected stop enabled"
                      checked={selectedEnabled}
                      onChange={(event) => {
                        setSelectedEnabled(event.currentTarget.checked);
                        onDraftChange?.();
                      }}
                      type="checkbox"
                    />
                    Enabled
                  </label>
                  {selectedError && <p role="alert" className="text-red-300">{selectedError}</p>}
                  <div className="grid grid-cols-2 gap-1">
                    <button
                      aria-label={`Apply ${stop.id}`}
                      className="h-7 border border-border bg-background disabled:opacity-40"
                      disabled={!canApplySelected}
                      onClick={applySelectedStop}
                      type="button"
                    >
                      Apply
                    </button>
                    <button
                      aria-label={`Remove ${stop.id}`}
                      className="h-7 border border-border px-2 text-red-300"
                      onClick={removeSelectedStop}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </fieldset>
              ) : (
                <div className="grid grid-cols-[auto_1fr] items-center gap-2">
                  <input
                    aria-label={`Enable ${stop.id}`}
                    checked={stop.enabled}
                    disabled={disabled}
                    onChange={(event) => commit(replaceStop(
                      stops,
                      stop.id,
                      { ...stop, enabled: event.currentTarget.checked }
                    ))}
                    type="checkbox"
                  />
                  <div>
                    <div className="text-foreground">{placementLabel(stop.placement,
                      Boolean(operation.transitions?.exit && operation.transitions.exit.strategy !== 'none'))}</div>
                    <div className="text-muted-foreground">{stopReasonLabels[stop.reason]}{stop.note ? ` · ${stop.note}` : ''}</div>
                  </div>
                  <div className="col-start-2 flex gap-1">
                  {onSelectStop && <button
                    aria-label={`Edit ${stop.id}`}
                    className="h-7 border border-border px-2 disabled:opacity-40"
                    disabled={disabled || targetChangeBlocked}
                    onClick={() => onSelectStop(operation.id, stop.id)}
                    title={targetChangeBlocked ? 'Apply the pending form before editing another stop.' : undefined}
                    type="button"
                  >Edit</button>}
                  <button
                    aria-label={`Remove ${stop.id}`}
                    className="h-7 border border-border px-2"
                    disabled={disabled}
                    onClick={() => commit(stops.filter((candidate) => candidate.id !== stop.id))}
                    type="button"
                  >
                    Remove
                  </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function replaceStop(
  stops: readonly OperationProgramStop[],
  stopId: string,
  replacement: OperationProgramStop
) {
  return stops.map((stop) => stop.id === stopId ? replacement : stop);
}

function placementLabel(placement: OperationProgramStopPlacement, hasExit: boolean) {
  if (placement.kind === 'before-entry') return 'Stop before positioning';
  if (placement.kind === 'after-positioning') return 'Stop after positioning';
  if (placement.kind === 'before-operation-end') {
    return `Stop with ${placement.remainingCutLengthMm.toFixed(3)} mm remaining`;
  }
  if (placement.kind === 'after-contour-distance') return `Stop ${placement.travelLengthMm.toFixed(3)} mm along travel after contour`;
  if (placement.kind === 'after-contour') return hasExit ? 'Stop at contour end · before exit lead' : 'Stop at contour end';
  if (placement.kind === 'after-exit') return hasExit ? 'Stop at exit-lead end · before next positioning' : 'Stop at contour end · no exit lead';
}

interface ProgramStopFieldsProps {
  labelPrefix: string;
  placement: OperationProgramStopPlacement['kind'];
  remaining: string;
  reason: OperationProgramStop['reason'];
  note: string;
  onPlacementChange: (value: OperationProgramStopPlacement['kind']) => void;
  onRemainingChange: (value: string) => void;
  onReasonChange: (value: OperationProgramStop['reason']) => void;
  onNoteChange: (value: string) => void;
  onDraftChange?: () => void;
  placementRef?: Ref<HTMLSelectElement>;
  hasExit: boolean;
  travelLengthMm: number | null;
}

function placementHelp(placement: OperationProgramStopPlacement['kind'], hasExit: boolean): string {
  switch (placement) {
    case 'before-entry': return 'Pause at the current wire position, before separation and positioning toward this contour’s entry start.';
    case 'after-positioning': return 'Pause at this contour’s entry start, after positioning and before threading, compensation and the entry cut. Manual rethreading can already add a pause here.';
    case 'before-operation-end': return 'Pause on the contour with the specified cut length still remaining. Distance follows the contour and excludes entry and exit leads.';
    case 'after-contour': return hasExit
      ? 'Pause at the contour endpoint before cutting the exit lead. Compensation has not ended.'
      : 'Pause at the contour endpoint. There is no exit lead, so After exit pauses at the same point.';
    case 'after-exit': return hasExit
      ? 'Pause after cutting the exit lead, before compensation ends and before positioning to the next contour. This is the exit endpoint, not a distance along rapid travel.'
      : 'There is no exit lead: this pauses at the contour endpoint, just like After contour. No rapid travel occurs between these two placements.';
    case 'after-contour-distance': return 'Measure from the contour endpoint along the exit lead, then along positioning toward the next contour’s entry start. Stops use the existing planned XY path; they do not add an exit or travel move.';
  }
}

function ProgramStopFields({ labelPrefix, placement, remaining, reason, note,
  onPlacementChange, onRemainingChange, onReasonChange, onNoteChange,
  onDraftChange, placementRef, hasExit, travelLengthMm }: ProgramStopFieldsProps) {
  const helpId = `${labelPrefix.replaceAll(' ', '-').toLowerCase()}-placement-help`;
  return <>
        <label className="grid gap-0.5 text-muted-foreground">
          Placement
          <select
            aria-label={`${labelPrefix} placement`}
            aria-describedby={helpId}
            title={placementHelp(placement, hasExit)}
            className="h-7 border border-border bg-background px-1 text-foreground"
            onChange={(event) => {
              onPlacementChange(event.currentTarget.value as OperationProgramStopPlacement['kind']);
              onDraftChange?.();
            }}
            ref={placementRef}
            value={placement}
          >
            <option value="before-entry" title={placementHelp('before-entry', hasExit)}>Before positioning</option>
            <option value="after-positioning" title={placementHelp('after-positioning', hasExit)}>After positioning · before threading or entry</option>
            <option value="before-operation-end" title={placementHelp('before-operation-end', hasExit)}>On contour · remaining cut distance</option>
            <option value="after-contour" title={placementHelp('after-contour', hasExit)}>After contour · before exit lead</option>
            <option value="after-exit" title={placementHelp('after-exit', hasExit)}>After exit lead · before next positioning</option>
            <option value="after-contour-distance" title={placementHelp('after-contour-distance', hasExit)}>After contour · travel distance</option>
          </select>
        </label>
        <p id={helpId} className="text-muted-foreground">{placementHelp(placement, hasExit)}</p>
        {(placement === 'before-operation-end' || placement === 'after-contour-distance') && (
          <label className="grid gap-0.5 text-muted-foreground">
            {placement === 'after-contour-distance' ? 'Travel from contour end (mm)' : 'Remaining contour cut (mm)'}
            <input
              aria-label={`${labelPrefix} ${placement === 'after-contour-distance' ? 'travel distance' : 'remaining cut'} millimeters`}
              className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
              inputMode="decimal"
              onChange={(event) => {
                onRemainingChange(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={remaining}
            />
          </label>
        )}
        {placement === 'after-contour-distance' && <>
          {travelLengthMm !== null && <p className="text-muted-foreground">Available path: {travelLengthMm.toFixed(3)} mm.</p>}
          <p className="text-amber-300">Uses UPID v3 and split moves. Older apps and posts may reject this placement. Review generated controller output; installed posts stay unchanged.</p>
        </>}
        <label className="grid gap-0.5 text-muted-foreground">
          Reason
          <select
            aria-label={`${labelPrefix} reason`}
            className="h-7 border border-border bg-background px-1 text-foreground"
            onChange={(event) => {
              onReasonChange(event.currentTarget.value as OperationProgramStop['reason']);
              onDraftChange?.();
            }}
            value={reason}
          >
            {Object.entries(stopReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-0.5 text-muted-foreground">
          Note
          <input
            aria-label={`${labelPrefix} note`}
            className="h-7 border border-border bg-background px-1.5 text-foreground"
            onChange={(event) => {
              onNoteChange(event.currentTarget.value);
              onDraftChange?.();
            }}
            value={note}
          />
        </label>

  </>;
}
