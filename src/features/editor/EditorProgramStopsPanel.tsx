import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { programStopValidationError } from '@/domain/path-intel/programStops';
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
    ? String(selectedStop.placement.remainingCutLengthMm) : '1';
  const savedReason = selectedStop?.reason ?? 'part-retention';
  const savedNote = selectedStop?.note ?? '';
  const savedEnabled = selectedStop?.enabled ?? true;
  const executionTree = useMemo(() => buildUpidEditorTree(document), [document]);
  const effectiveOperations = useMemo(() => deriveActiveMachiningOperations(document), [document]);
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
      : { kind: placement },
    reason,
    ...(note.trim() ? { note: note.trim() } : {})
  };
  const replacement: OperationProgramStop | null = selectedStop ? {
    id: selectedStop.id,
    enabled: selectedEnabled,
    placement: selectedPlacement === 'before-operation-end'
      ? { kind: selectedPlacement, remainingCutLengthMm: selectedRemainingValue }
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
          Pause cutting for part retention or an operator check. Remaining cut excludes entry and exit moves.
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
          onReasonChange={setReason} onNoteChange={setNote} onDraftChange={onDraftChange} placementRef={addPlacementRef} />
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
                    onNoteChange={setSelectedNote} onDraftChange={onDraftChange} placementRef={selectedPlacementRef} />
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
                    <div className="text-foreground">{placementLabel(stop.placement)}</div>
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

function placementLabel(placement: OperationProgramStopPlacement) {
  if (placement.kind === 'before-entry') return 'Stop before positioning';
  if (placement.kind === 'after-positioning') return 'Stop after positioning';
  if (placement.kind === 'before-operation-end') {
    return `Stop with ${placement.remainingCutLengthMm.toFixed(3)} mm remaining`;
  }
  return `Stop ${placement.kind.replaceAll('-', ' ')}`;
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
}

function ProgramStopFields({ labelPrefix, placement, remaining, reason, note,
  onPlacementChange, onRemainingChange, onReasonChange, onNoteChange,
  onDraftChange, placementRef }: ProgramStopFieldsProps) {
  return <>
        <label className="grid gap-0.5 text-muted-foreground">
          Placement
          <select
            aria-label={`${labelPrefix} placement`}
            className="h-7 border border-border bg-background px-1 text-foreground"
            onChange={(event) => {
              onPlacementChange(event.currentTarget.value as OperationProgramStopPlacement['kind']);
              onDraftChange?.();
            }}
            ref={placementRef}
            value={placement}
          >
            <option value="before-entry">Before positioning</option>
            <option value="after-positioning">After positioning, before threading or cutting</option>
            <option value="before-operation-end">Before contour end</option>
            <option value="after-contour">After contour</option>
            <option value="after-exit">After exit</option>
          </select>
        </label>
        {placement === 'before-operation-end' && (
          <label className="grid gap-0.5 text-muted-foreground">
            Remaining cut (mm)
            <input
              aria-label={`${labelPrefix} remaining cut millimeters`}
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
