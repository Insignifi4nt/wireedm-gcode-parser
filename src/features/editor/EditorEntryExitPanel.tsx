import { useEffect, useMemo, useState } from 'react';

import { canSetCircleOperationCenterPierceLeadIn } from '@/domain/path-editor/pathDocumentOperations';
import { readOperationTransitions } from '@/domain/path-intel/operationTransitions';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import { resolveOperationTransitionOwnership } from '@/domain/path-intel/operationTransitionOwnership';
import {
  prepareUpidMachinePost,
  type UpidMachinePostPreparationIssue
} from '@/domain/post/upidMachinePost';
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
  onOpenContourStart?: (operationId: string) => void;
  onOpenProjectMachine?: () => void;
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
  onOpenContourStart,
  onOpenProjectMachine,
  onSelectOperation,
  onSetCircleCenterEntry,
  onSetManualEntry,
  onSetManualExit,
  onSetNoEntry,
  onSetNoExit,
  selectedOperationId,
  targetChangeBlocked = false
}: EditorEntryExitPanelProps) {
  const operations = useMemo(
    () => orderedPathOperations(document.plan.operations),
    [document.plan.operations]
  );
  const selected = operations.find(
    (operation) => operation.id === selectedOperationId
  ) ?? operations[0] ?? null;
  const transitions = selected ? readOperationTransitions(selected) : {};
  const generatedPresentation = selected &&
    resolveOperationTransitionOwnership(selected, machine) === 'generated-explicit-linear'
      ? readGeneratedTransitionPresentation(document, selected.id, machine)
      : null;
  const generatedContourStartOperationId =
    generatedPresentation?.status === 'ready'
      ? selected?.id
      : generatedPresentation?.issue?.scope === 'contour-start'
        ? generatedPresentation.issue.sourceOperationId
        : undefined;
  const generatedProjectMachineOwned = Boolean(
    generatedPresentation?.status === 'ready' ||
    (
      generatedPresentation?.status === 'blocked' &&
      (
        !generatedPresentation.issue?.sourceOperationId ||
        generatedPresentation.issue.scope === 'machine-setup'
      )
    )
  );
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
          {operations.map((operation, executionIndex) => (
            <option key={operation.id} value={operation.id}>
              {String(executionIndex + 1).padStart(2, '0')}. {operation.displayName}
            </option>
          ))}
        </select>
      </label>

      {generatedPresentation ? (
        <section
          className="grid gap-2 border border-cyan-500/45 bg-cyan-500/5 p-2"
          data-entry-exit-generated
        >
          <div>
            <div className="font-semibold uppercase text-cyan-200">
              Generated explicit-linear transition
            </div>
            <p className="mt-1 leading-4 text-muted-foreground">
              Generated from Contour Start and Project Machine when the program is posted. Stored
              Entry / Exit overrides are ignored for this compensated operation.
            </p>
          </div>
          {generatedPresentation.status === 'ready' ? (
            <div className="grid gap-2">
              {generatedPresentation.transitions.map((transition, index) => (
                <dl
                  className="grid grid-cols-[58px_minmax(0,1fr)] gap-x-2 gap-y-1 border border-border bg-background/40 p-2"
                  data-entry-exit-generated-group={index + 1}
                  key={`${transition.operationId}-${index}`}
                >
                  <dt className="text-muted-foreground">Lead-in</dt>
                  <dd data-entry-exit-generated-lead-in>
                    {formatPoint(transition.leadIn.start)} → {formatPoint(transition.leadIn.end)}
                  </dd>
                  <dt className="text-muted-foreground">Lead-out</dt>
                  <dd data-entry-exit-generated-lead-out>
                    {formatPoint(transition.leadOut.start)} → {formatPoint(transition.leadOut.end)}
                  </dd>
                </dl>
              ))}
            </div>
          ) : (
            <p
              className="border border-amber-500/50 bg-amber-500/10 p-2 leading-4 text-amber-200"
              data-entry-exit-generated-blocker
            >
              {generatedPresentation.message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-1">
            {onOpenContourStart && generatedContourStartOperationId && (
              <button
                aria-label="Open Contour Start for generated transition"
                className="h-7 border border-border bg-background px-1.5"
                disabled={disabled}
                onClick={() => onOpenContourStart(generatedContourStartOperationId)}
                type="button"
              >
                Contour Start
              </button>
            )}
            {onOpenProjectMachine && generatedProjectMachineOwned && (
              <button
                aria-label="Open Project Machine for generated transition"
                className="h-7 border border-border bg-background px-1.5"
                disabled={disabled}
                onClick={onOpenProjectMachine}
                type="button"
              >
                Project Machine
              </button>
            )}
          </div>
        </section>
      ) : (
      <>
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

      </>
      )}
    </section>
  );
}

type GeneratedTransitionPresentation =
  | {
      status: 'ready';
      transitions: Array<{
        operationId: string;
        leadIn: { start: Point2; end: Point2 };
        leadOut: { start: Point2; end: Point2 };
      }>;
    }
  | {
      status: 'blocked';
      issue: UpidMachinePostPreparationIssue | null;
      message: string;
    };

function readGeneratedTransitionPresentation(
  document: PathPlanningDocument,
  sourceOperationId: string,
  machine: MachineProfile
): GeneratedTransitionPresentation {
  const preparation = prepareUpidMachinePost(document, machine);
  if (preparation.status === 'blocked') {
    const issue = preparation.issues.find((candidate) =>
      candidate.sourceOperationId === sourceOperationId ||
      candidate.effectiveOperationId === sourceOperationId
    ) ?? preparation.issues[0] ?? null;
    const diagnostic = preparation.result.diagnostics.find(
      (candidate) => !issue || candidate.details?.reason === issue.reason
    ) ?? preparation.result.diagnostics[0];
    const owningOperation = issue?.sourceOperationId
      ? document.plan.operations.find(
          (operation) => operation.id === issue.sourceOperationId
        )
      : null;
    const ownerLabel = owningOperation?.displayName ?? issue?.sourceOperationId;
    const diagnosticMessage =
      diagnostic?.message ??
      `The generated transition is unavailable: ${issue?.reason ?? preparation.reason ?? 'post preparation blocked'}.`;
    return {
      status: 'blocked',
      issue,
      message: ownerLabel
        ? `Blocked by ${ownerLabel}: ${diagnosticMessage}`
        : diagnosticMessage
    };
  }

  if (preparation.route !== 'explicit-linear') {
    return {
      status: 'blocked',
      issue: null,
      message: 'The selected post does not provide an explicit-linear generated transition.'
    };
  }

  const transitions = preparation.document.plan.operations.flatMap((operation) => {
    const operationSourceId = operation.machiningIntent?.sourceOperationId ?? operation.id;
    if (operationSourceId !== sourceOperationId) return [];
    const transition = preparation.readinessByOperationId.get(operation.id)?.transition;
    return transition
      ? [{
          operationId: operation.id,
          leadIn: transition.leadIn,
          leadOut: transition.leadOut
        }]
      : [];
  });

  return transitions.length > 0
    ? { status: 'ready', transitions }
    : {
        status: 'blocked',
        issue: null,
        message: 'The generated transition is unavailable for this operation.'
      };
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
