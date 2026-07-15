import { useState } from 'react';

import { validateProgramStops } from '@/domain/path-intel/programStops';
import type {
  OperationProgramStop,
  OperationProgramStopPlacement,
  PathPlanningDocument
} from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

interface EditorProgramStopsPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  machine: MachineProfile;
  onDraftChange?: () => void;
  onSetStops: (operationId: string, stops: OperationProgramStop[], completeForm?: boolean) => void;
  selectedOperationId: string | null;
}

export function EditorProgramStopsPanel({
  disabled,
  document,
  machine,
  onDraftChange,
  onSetStops,
  selectedOperationId
}: EditorProgramStopsPanelProps) {
  const operation = document.plan.operations.find(
    (candidate) => candidate.id === selectedOperationId
  ) ?? document.plan.operations[0] ?? null;
  const [placement, setPlacement] = useState<OperationProgramStopPlacement['kind']>('before-operation-end');
  const [remaining, setRemaining] = useState('1');
  const [reason, setReason] = useState<OperationProgramStop['reason']>('part-retention');
  const [note, setNote] = useState('');

  if (!operation) return <p className="text-[10px] text-muted-foreground">No operation selected.</p>;
  const stops = operation.programStops ?? [];
  const validation = validateProgramStops(operation, machine, document.segments);
  const remainingValue = Number(remaining);
  const canAdd = placement !== 'before-operation-end' ||
    (Number.isFinite(remainingValue) && remainingValue > 0);

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

  return (
    <section className="grid gap-2 text-[10px]" data-program-stops-panel>
      <div className="border border-border bg-background/35 p-2">
        <div className="uppercase text-muted-foreground">{operation.displayName}</div>
        <p className={validation.status === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>
          {validation.status === 'ready'
            ? `Machine policy ready · canonical ${validation.code}`
            : validation.message}
        </p>
        <p className="mt-1 text-muted-foreground">
          These are unconditional program stops. M0 and M00 intent is emitted as M00; M01 is not used.
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
        ) : stops.map((stop) => (
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 border border-border p-2" key={stop.id}>
            <input
              aria-label={`Enable ${stop.id}`}
              checked={stop.enabled}
              disabled={disabled}
              onChange={(event) => commit(stops.map((candidate) =>
                candidate.id === stop.id ? { ...candidate, enabled: event.currentTarget.checked } : candidate
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
        ))}
      </div>
    </section>
  );
}

function placementLabel(placement: OperationProgramStopPlacement) {
  if (placement.kind === 'before-operation-end') {
    return `M00 with ${placement.remainingCutLengthMm.toFixed(3)} mm remaining`;
  }
  return `M00 ${placement.kind.replaceAll('-', ' ')}`;
}
