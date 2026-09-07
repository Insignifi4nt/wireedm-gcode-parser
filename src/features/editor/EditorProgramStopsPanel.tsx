import { useEffect, useRef, useState } from 'react';
import { programStopValidationError } from '@/domain/path-intel/programStops';

import type {
  OperationProgramStop,
  OperationProgramStopPlacement,
  PathPlanningDocument
} from '@/domain/path-intel/types';

interface EditorProgramStopsPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  onDraftChange?: () => void;
  onSelectStop?: (operationId: string, stopId: string) => void;
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
  const stops = operation?.programStops ?? [];
  const selectedStop = stops.find((stop) => stop.id === selectedStopId) ?? null;

  useEffect(() => setAddCompleted(false), [operation?.id]);

  useEffect(() => {
    if (!selectedStop) return;
    setSelectedPlacement(selectedStop.placement.kind);
    setSelectedRemaining(
      selectedStop.placement.kind === 'before-operation-end'
        ? String(selectedStop.placement.remainingCutLengthMm)
        : '1'
    );
    setSelectedReason(selectedStop.reason);
    setSelectedNote(selectedStop.note ?? '');
    setSelectedEnabled(selectedStop.enabled);
    selectedPlacementRef.current?.focus();
  }, [selectedStop]);

  if (!operation) return <p className="text-[10px] text-muted-foreground">No operation selected.</p>;
  const remainingValue = Number(remaining);
  const selectedRemainingValue = Number(selectedRemaining);
  const nextNumber = stops.reduce((maximum, stop) => {
    const match = /^stop-(\d+)$/.exec(stop.id);
    return Math.max(maximum, match ? Number(match[1]) : 0);
  }, 0) + 1;
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
      <div className="border border-border bg-background/35 p-2">
        <div className="uppercase text-muted-foreground">{operation.displayName}</div>
        <p className="mt-1 text-muted-foreground">
          Pause cutting for part retention or an operator check. Remaining cut excludes entry and exit moves.
        </p>
      </div>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}
        onChange={() => setAddCompleted(false)}>
        <legend className="px-1 uppercase text-muted-foreground">Add stop</legend>
        <label className="grid gap-0.5 text-muted-foreground">
          Placement
          <select
            aria-label="Program stop placement"
            className="h-7 border border-border bg-background px-1 text-foreground"
            onChange={(event) => {
              setPlacement(event.currentTarget.value as OperationProgramStopPlacement['kind']);
              onDraftChange?.();
            }}
            value={placement}
          >
            <option value="before-entry">Before positioning</option>
            <option value="before-operation-end">Before contour end</option>
            <option value="after-contour">After contour</option>
            <option value="after-exit">After exit</option>
          </select>
        </label>
        {placement === 'before-operation-end' && (
          <label className="grid gap-0.5 text-muted-foreground">
            Remaining cut (mm)
            <input
              aria-label="Program stop remaining cut millimeters"
              className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
              inputMode="decimal"
              onChange={(event) => {
                setRemaining(event.currentTarget.value);
                onDraftChange?.();
              }}
              value={remaining}
            />
          </label>
        )}
        <label className="grid gap-0.5 text-muted-foreground">
          Reason
          <select
            aria-label="Program stop reason"
            className="h-7 border border-border bg-background px-1 text-foreground"
            onChange={(event) => {
              setReason(event.currentTarget.value as OperationProgramStop['reason']);
              onDraftChange?.();
            }}
            value={reason}
          >
            <option value="part-retention">Part retention</option>
            <option value="operator-check">Operator check</option>
            <option value="manual">Manual</option>
          </select>
        </label>
        <label className="grid gap-0.5 text-muted-foreground">
          Note
          <input
            aria-label="Program stop note"
            className="h-7 border border-border bg-background px-1.5 text-foreground"
            onChange={(event) => {
              setNote(event.currentTarget.value);
              onDraftChange?.();
            }}
            value={note}
          />
        </label>
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
      </fieldset>

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
                  <label className="grid gap-0.5 text-muted-foreground">
                    Placement
                    <select
                      aria-label="Selected stop placement"
                      className="h-7 border border-border bg-background px-1 text-foreground"
                      onChange={(event) => {
                        setSelectedPlacement(event.currentTarget.value as OperationProgramStopPlacement['kind']);
                        onDraftChange?.();
                      }}
                      ref={selectedPlacementRef}
                      value={selectedPlacement}
                    >
                      <option value="before-entry">Before positioning</option>
                      <option value="before-operation-end">Before contour end</option>
                      <option value="after-contour">After contour</option>
                      <option value="after-exit">After exit</option>
                    </select>
                  </label>
                  {selectedPlacement === 'before-operation-end' && (
                    <label className="grid gap-0.5 text-muted-foreground">
                      Remaining cut (mm)
                      <input
                        aria-label="Selected stop remaining cut millimeters"
                        className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
                        inputMode="decimal"
                        onChange={(event) => {
                          setSelectedRemaining(event.currentTarget.value);
                          onDraftChange?.();
                        }}
                        value={selectedRemaining}
                      />
                    </label>
                  )}
                  <label className="grid gap-0.5 text-muted-foreground">
                    Reason
                    <select
                      aria-label="Selected stop reason"
                      className="h-7 border border-border bg-background px-1 text-foreground"
                      onChange={(event) => {
                        setSelectedReason(event.currentTarget.value as OperationProgramStop['reason']);
                        onDraftChange?.();
                      }}
                      value={selectedReason}
                    >
                      <option value="part-retention">Part retention</option>
                      <option value="operator-check">Operator check</option>
                      <option value="manual">Manual</option>
                    </select>
                  </label>
                  <label className="grid gap-0.5 text-muted-foreground">
                    Note
                    <input
                      aria-label="Selected stop note"
                      className="h-7 border border-border bg-background px-1.5 text-foreground"
                      onChange={(event) => {
                        setSelectedNote(event.currentTarget.value);
                        onDraftChange?.();
                      }}
                      value={selectedNote}
                    />
                  </label>
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
                    <div className="text-muted-foreground">{stop.reason}{stop.note ? ` · ${stop.note}` : ''}</div>
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
  if (placement.kind === 'before-operation-end') {
    return `Stop with ${placement.remainingCutLengthMm.toFixed(3)} mm remaining`;
  }
  return `Stop ${placement.kind.replaceAll('-', ' ')}`;
}
