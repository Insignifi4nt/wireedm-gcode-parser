import { useEffect, useRef, useState } from 'react';

import type {
  OperationProgramStop,
  OperationProgramStopPlacement,
  PathPlanningDocument
} from '@/domain/path-intel/types';

interface EditorProgramStopsPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  onDraftChange?: () => void;
  onSetStops: (operationId: string, stops: OperationProgramStop[], completeForm?: boolean) => void;
  selectedOperationId: string | null;
  selectedStopId?: string | null;
}

export function EditorProgramStopsPanel({
  disabled,
  document,
  onDraftChange,
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
  const [selectedPlacement, setSelectedPlacement] = useState<OperationProgramStopPlacement['kind']>('before-operation-end');
  const [selectedRemaining, setSelectedRemaining] = useState('1');
  const [selectedReason, setSelectedReason] = useState<OperationProgramStop['reason']>('part-retention');
  const [selectedNote, setSelectedNote] = useState('');
  const [selectedEnabled, setSelectedEnabled] = useState(true);
  const selectedPlacementRef = useRef<HTMLSelectElement>(null);
  const stops = operation?.programStops ?? [];
  const selectedStop = stops.find((stop) => stop.id === selectedStopId) ?? null;

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
  const canAdd = placement !== 'before-operation-end' ||
    (Number.isFinite(remainingValue) && remainingValue > 0);
  const selectedRemainingValue = Number(selectedRemaining);
  const canApplySelected = selectedPlacement !== 'before-operation-end' ||
    (Number.isFinite(selectedRemainingValue) && selectedRemainingValue > 0);

  function commit(nextStops: OperationProgramStop[], completeForm = false) {
    if (!disabled) onSetStops(operation!.id, nextStops, completeForm);
  }

  function addStop() {
    if (!canAdd || disabled) return;
    const nextNumber = stops.reduce((maximum, stop) => {
      const match = /^stop-(\d+)$/.exec(stop.id);
      return Math.max(maximum, match ? Number(match[1]) : 0);
    }, 0) + 1;
    commit([...stops, {
      id: `stop-${nextNumber}`,
      enabled: true,
      placement: placement === 'before-operation-end'
        ? { kind: placement, remainingCutLengthMm: remainingValue }
        : { kind: placement },
      reason,
      ...(note.trim() ? { note: note.trim() } : {})
    }], true);
  }

  function applySelectedStop() {
    if (!selectedStop || !canApplySelected || disabled) return;
    const replacement: OperationProgramStop = {
      id: selectedStop.id,
      enabled: selectedEnabled,
      placement: selectedPlacement === 'before-operation-end'
        ? { kind: selectedPlacement, remainingCutLengthMm: selectedRemainingValue }
        : { kind: selectedPlacement },
      reason: selectedReason,
      ...(selectedNote.trim() ? { note: selectedNote.trim() } : {})
    };
    commit(replaceStop(stops, selectedStop.id, replacement), true);
  }

  function removeSelectedStop() {
    if (!selectedStop || disabled) return;
    commit(stops.filter((stop) => stop.id !== selectedStop.id), true);
  }

  return (
    <section className="grid gap-2 text-[10px]" data-program-stops-panel>
      <div className="border border-border bg-background/35 p-2">
        <div className="uppercase text-muted-foreground">{operation.displayName}</div>
        <p className="mt-1 text-muted-foreground">
          These are unconditional, user-authored stop intents. Controller encoding is decided only
          when the saved revision is generated with an exact machine binding.
        </p>
      </div>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
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
            <option value="before-entry">Before entry</option>
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
        <button
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={!canAdd}
          onClick={addStop}
          type="button"
        >
          Add M00 stop
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
                      <option value="before-entry">Before entry</option>
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
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
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
  if (placement.kind === 'before-operation-end') {
    return `M00 with ${placement.remainingCutLengthMm.toFixed(3)} mm remaining`;
  }
  return `M00 ${placement.kind.replaceAll('-', ' ')}`;
}
