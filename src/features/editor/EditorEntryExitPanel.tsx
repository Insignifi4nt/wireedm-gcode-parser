import { useEffect, useState } from 'react';

import { canSetCircleOperationCenterPierceLeadIn } from '@/domain/path-editor/pathDocumentOperations';
import { readOperationTransitions } from '@/domain/path-intel/operationTransitions';
import { robofilV2PostEnvelopeIsReady } from '@/domain/post/verifiedRobofilPostEnvelope';
import type { PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

interface EditorEntryExitPanelProps {
  canvasPickMode: 'entry' | 'exit' | null;
  disabled: boolean;
  document: PathPlanningDocument;
  machine: MachineProfile;
  onCanvasPickModeChange: (
    mode: 'entry' | 'exit' | null,
    operationId: string
  ) => void;
  onDraftChange?: (source: 'entry' | 'exit') => void;
  onSelectOperation: (operationId: string) => void;
  onSetCircleCenterEntry: (operationId: string) => void;
  onSetManualEntry: (
    operationId: string,
    point: Point2
  ) => void;
  onSetManualExit: (operationId: string, point: Point2) => void;
  onSetNoEntry: (operationId: string) => void;
  onSetNoExit: (operationId: string) => void;
  selectedOperationId: string | null;
  targetChangeBlocked?: boolean;
}

export function EditorEntryExitPanel({
  canvasPickMode,
  disabled,
  document,
  machine,
  onCanvasPickModeChange,
  onDraftChange,
  onSelectOperation,
  onSetCircleCenterEntry,
  onSetManualEntry,
  onSetManualExit,
  onSetNoEntry,
  onSetNoExit,
  selectedOperationId,
  targetChangeBlocked = false
}: EditorEntryExitPanelProps) {
  const selected = document.plan.operations.find(
    (operation) => operation.id === selectedOperationId
  ) ?? document.plan.operations[0] ?? null;
  const transitions = selected ? readOperationTransitions(selected) : {};
  const [entryX, setEntryX] = useState('');
  const [entryY, setEntryY] = useState('');
  const [exitX, setExitX] = useState('');
  const [exitY, setExitY] = useState('');
  const entryFrom =
    transitions.entry && transitions.entry.strategy !== 'none'
      ? transitions.entry.from
      : null;
  const exitTo =
    transitions.exit && transitions.exit.strategy !== 'none'
      ? transitions.exit.to
      : null;

  useEffect(() => {
    setEntryX(entryFrom ? String(entryFrom.x) : '');
    setEntryY(entryFrom ? String(entryFrom.y) : '');
    setExitX(exitTo ? String(exitTo.x) : '');
    setExitY(exitTo ? String(exitTo.y) : '');
  }, [selected?.id, entryFrom?.x, entryFrom?.y, exitTo?.x, exitTo?.y]);

  const entryPoint = readFinitePoint(entryX, entryY);
  const exitPoint = readFinitePoint(exitX, exitY);
  const robofilV2OperationLifecycle = robofilV2PostEnvelopeIsReady(machine);
  const centerPierceBlockedByControllerCompensation = Boolean(
    document.geometryBasis === 'finished-contour' &&
    selected?.compensationIntent?.mode === 'controller' &&
    !robofilV2OperationLifecycle
  );
  const canSetCircleCenterEntry = Boolean(
    selected &&
    canSetCircleOperationCenterPierceLeadIn(document, selected.id) &&
    !centerPierceBlockedByControllerCompensation
  );

  if (!selected) {
    return <p className="text-[10px] text-muted-foreground">No operations are available.</p>;
  }

  return (
    <section className="grid gap-2 text-[10px]" data-entry-exit-panel>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Operation
        <select
          aria-label="Entry and exit operation"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={disabled || targetChangeBlocked || canvasPickMode !== null}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected.id}
          title={
            canvasPickMode
              ? 'Pick the canvas point or press Escape before changing the target contour.'
              : targetChangeBlocked
                ? 'Apply or discard pending coordinates before changing the target contour.'
                : undefined
          }
        >
          {document.plan.operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.orderIndex + 1}. {operation.displayName}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Canvas point picking</legend>
        <p className="text-muted-foreground">
          Choose Entry or Exit, then hover to preview a point on the endpoint normal and click to apply that exact perpendicular lead. The operation target stays locked until the point is picked or the mode is cancelled.
        </p>
        <div className="grid grid-cols-2 gap-1">
          <button
            aria-label="Pick entry point on canvas"
            aria-pressed={canvasPickMode === 'entry'}
            className={`h-7 border px-1.5 ${
              canvasPickMode === 'entry'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background'
            }`}
            onClick={() => onCanvasPickModeChange(
              canvasPickMode === 'entry' ? null : 'entry',
              selected.id
            )}
            type="button"
          >
            Pick Entry
          </button>
          <button
            aria-label="Pick exit point on canvas"
            aria-pressed={canvasPickMode === 'exit'}
            className={`h-7 border px-1.5 ${
              canvasPickMode === 'exit'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background'
            }`}
            onClick={() => onCanvasPickModeChange(
              canvasPickMode === 'exit' ? null : 'exit',
              selected.id
            )}
            type="button"
          >
            Pick Exit
          </button>
        </div>
      </fieldset>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Entry</legend>
        <div className="text-foreground" data-entry-strategy>
          {entryStrategyLabel(transitions.entry)}
        </div>
        <CoordinateInputs
          label="Entry"
          onXChange={(value) => { setEntryX(value); onDraftChange?.('entry'); }}
          onYChange={(value) => { setEntryY(value); onDraftChange?.('entry'); }}
          x={entryX}
          y={entryY}
        />
        <div className="grid grid-cols-2 gap-1">
          <button
            aria-label="Set straight entry"
            className="h-7 border border-border bg-background disabled:opacity-40"
            disabled={!entryPoint}
            onClick={() => entryPoint && onSetManualEntry(selected.id, entryPoint)}
            type="button"
          >
            Set straight entry
          </button>
          <button
            aria-label="Add center pierce lead-in"
            className="h-7 border border-border bg-background disabled:opacity-40"
            disabled={!canSetCircleCenterEntry}
            onClick={() => onSetCircleCenterEntry(selected.id)}
            title={
              centerPierceBlockedByControllerCompensation
                ? 'Center pierce is unavailable while controller compensation is active.'
                : 'Use circle center entry'
            }
            type="button"
          >
            Use circle center
          </button>
        </div>
        <button
          aria-label="Use reviewed no entry"
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={!robofilV2OperationLifecycle}
          onClick={() => onSetNoEntry(selected.id)}
          title={
            robofilV2OperationLifecycle
              ? 'Review and use direct contour entry with no lead-in move.'
              : 'Reviewed no-entry intent is available only for a verified Robofil v2 lifecycle.'
          }
          type="button"
        >
          Use no entry (reviewed)
        </button>
      </fieldset>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Exit</legend>
        <div className="text-foreground" data-exit-strategy>
          {transitions.exit?.strategy === 'none'
            ? `Reviewed no exit`
            : transitions.exit
            ? `Reviewed straight exit · ${formatPoint(transitions.exit.from)} → ${formatPoint(transitions.exit.to)}`
            : 'Exit decision not reviewed'}
        </div>
        <CoordinateInputs
          label="Exit"
          onXChange={(value) => { setExitX(value); onDraftChange?.('exit'); }}
          onYChange={(value) => { setExitY(value); onDraftChange?.('exit'); }}
          x={exitX}
          y={exitY}
        />
        <button
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={!exitPoint}
          onClick={() => exitPoint && onSetManualExit(selected.id, exitPoint)}
          type="button"
        >
          Set straight exit
        </button>
        <button
          aria-label="Use reviewed no exit"
          className="h-7 border border-border bg-background disabled:opacity-40"
          disabled={!robofilV2OperationLifecycle}
          onClick={() => onSetNoExit(selected.id)}
          title={
            robofilV2OperationLifecycle
              ? 'Review and end at the contour endpoint with no lead-out move.'
              : 'Reviewed no-exit intent is available only for a verified Robofil v2 lifecycle.'
          }
          type="button"
        >
          Use no exit (reviewed)
        </button>
      </fieldset>

    </section>
  );
}

function CoordinateInputs({
  label,
  onXChange,
  onYChange,
  x,
  y
}: {
  label: string;
  onXChange: (value: string) => void;
  onYChange: (value: string) => void;
  x: string;
  y: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      <label className="grid gap-0.5 text-muted-foreground">
        X
        <input
          aria-label={`${label} X`}
          className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
          inputMode="decimal"
          onChange={(event) => onXChange(event.currentTarget.value)}
          value={x}
        />
      </label>
      <label className="grid gap-0.5 text-muted-foreground">
        Y
        <input
          aria-label={`${label} Y`}
          className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
          inputMode="decimal"
          onChange={(event) => onYChange(event.currentTarget.value)}
          value={y}
        />
      </label>
    </div>
  );
}

function entryStrategyLabel(
  entry: ReturnType<typeof readOperationTransitions>['entry']
) {
  if (!entry) return 'Entry decision not reviewed';
  if (entry.strategy === 'none') return 'Reviewed no entry';
  const strategy = entry.strategy === 'circle-center' ? 'Circle-center entry' : 'Reviewed straight entry';
  return `${strategy} · ${formatPoint(entry.from)} → ${formatPoint(entry.to)}`;
}

function readFinitePoint(x: string, y: string): Point2 | null {
  if (x.trim() === '' || y.trim() === '') return null;
  const point = { x: Number(x), y: Number(y) };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

function formatPoint(point: Point2) {
  return `X${point.x.toFixed(3)} Y${point.y.toFixed(3)}`;
}
