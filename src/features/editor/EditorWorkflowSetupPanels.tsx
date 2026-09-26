import { MousePointer2, RefreshCw } from 'lucide-react';

import { suggestCompensationIntent, type ManualCompensationSelection } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import type {
  ContourClassification,
  PathPlanningDocument
} from '@/domain/path-intel/types';

const buttonClass =
  'flex h-7 items-center justify-center gap-1 border border-border px-1.5 text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40';

const CONTOUR_ROLE_OPTIONS: ContourClassification[] = [
  'exterior',
  'hole',
  'island',
  'ambiguous'
];

export function EditorGeometrySetupPanel({
  disabled,
  document,
  onSetGeometryBasis
}: {
  disabled: boolean;
  document: PathPlanningDocument;
  onSetGeometryBasis: (basis: PathPlanningDocument['geometryBasis']) => void;
}) {
  return (
    <section className="grid gap-2 text-[10px]" data-upid-geometry-setup>
      <p className="text-muted-foreground">
        Wire centre follows the drawn path without controller compensation. Finished contour uses
        the kept material and travel direction to resolve the controller side.
      </p>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Geometry Basis
        <select
          aria-label="Geometry basis"
          className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
          disabled={disabled}
          onChange={(event) => {
            const basis = event.currentTarget.value;
            if (basis === 'wire-centre' || basis === 'finished-contour') onSetGeometryBasis(basis);
          }}
          value={document.geometryBasis}
        >
          <option value="finished-contour">Finished contour</option>
          <option value="wire-centre">Wire centre</option>
        </select>
      </label>
      <p className="text-muted-foreground">
        Changing the basis keeps the geometry and saved compensation choices. Controller choices
        apply only to finished contours; review them before output.
      </p>
    </section>
  );
}

export function EditorContourSetupPanel({
  disabled,
  document,
  onReverse,
  onSelectOperation,
  onSetClassification,
  onSetCompensation,
  selectedOperationId
}: {
  disabled: boolean;
  document: PathPlanningDocument;
  onReverse: (operationId: string) => void;
  onSelectOperation: (operationId: string) => void;
  onSetClassification: (operationId: string, classification: ContourClassification) => void;
  onSetCompensation: (operationId: string, selection: ManualCompensationSelection) => void;
  selectedOperationId: string | null;
}) {
  const operations = orderedPathOperations(document.plan.operations);
  const selected = operations.find((operation) => operation.id === selectedOperationId)
    ?? operations[0]
    ?? null;
  const compensationResolution = selected
    ? resolveControllerCompensation({ document, operation: selected })
    : null;
  const automaticIntent = selected?.closed
    ? suggestCompensationIntent({ document, operation: selected })
    : undefined;
  const keptMaterial = selected?.compensationIntent?.mode === 'controller' &&
    'keptMaterial' in selected.compensationIntent
    ? selected.compensationIntent.keptMaterial
    : null;
  const uncompensated = document.geometryBasis === 'wire-centre' ||
    selected?.compensationIntent?.mode === 'centerline';
  const wirePosition = compensationResolution?.status === 'ready' && compensationResolution.keptMaterial
    ? compensationResolution.keptMaterial === 'inside' ? 'outside' : 'inside'
    : null;
  const compensationSelection = selected?.compensationIntent?.source === 'automatic'
    ? 'automatic'
    : selected?.compensationIntent?.mode === 'controller'
      ? 'wireSide' in selected.compensationIntent
        ? selected.compensationIntent.wireSide
        : selected.compensationIntent.keptMaterial
      : selected?.compensationIntent?.mode === 'centerline'
        ? 'centerline'
        : '';

  return (
    <section className="grid gap-1 text-[10px]" data-upid-contour-setup>
      <p className="text-muted-foreground">
        Set direction, contour role, and compensation.
      </p>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Target contour
        <select
          aria-label="Contour setup operation"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={!selected || disabled}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected?.id ?? ''}
        >
          {operations.map((operation, executionIndex) => (
            <option key={operation.id} value={operation.id}>
              {String(executionIndex + 1).padStart(2, '0')}. {operation.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        aria-label="Reverse path operation"
        className={buttonClass}
        disabled={!selected || disabled}
        onClick={() => selected && onReverse(selected.id)}
        type="button"
      >
        <RefreshCw className="size-3" />
        Reverse direction
      </button>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Contour Role
        <select
          aria-label="Contour role"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={!selected?.closed || disabled}
          onChange={(event) => {
            const classification = CONTOUR_ROLE_OPTIONS.find((option) => option === event.currentTarget.value);
            if (selected && classification) onSetClassification(selected.id, classification);
          }}
          value={selected?.classification ?? ''}
        >
          {selected && !selected.closed && <option value={selected.classification}>Open path</option>}
          {CONTOUR_ROLE_OPTIONS.map((classification) => (
            <option key={classification} value={classification}>
              {classification}
            </option>
          ))}
        </select>
      </label>
      <section className="grid gap-1" data-upid-compensation-review>
        <label className="grid gap-0.5 uppercase text-muted-foreground">
          Compensation
          <select
            aria-label="Compensation kept material"
            className="h-7 border border-border bg-background px-1.5 text-foreground"
            disabled={!selected || disabled || document.geometryBasis === 'wire-centre'}
            onChange={(event) => {
              if (!selected) return;
              const selection = event.currentTarget.value;
              if (selection === 'automatic' || selection === 'inside' || selection === 'outside' || selection === 'left' ||
                selection === 'right' || selection === 'centerline') onSetCompensation(selected.id, selection);
            }}
            value={compensationSelection}
          >
            {!compensationSelection && <option value="">Select compensation</option>}
            {selected?.closed && <option value="automatic" disabled={!automaticIntent}>
              {automaticIntent?.mode === 'controller' && 'keptMaterial' in automaticIntent
                ? `Automatic · keep ${automaticIntent.keptMaterial} (${selected.classification})`
                : 'Automatic · unavailable for this contour'}
            </option>}
            {selected?.closed ? (
              <>
                <option value="inside">Keep material inside contour</option>
                <option value="outside">Keep material outside contour</option>
              </>
            ) : selected?.machiningIntent?.kind === 'partial-contour' ? (
              <>
                <option value="left">Wire left of travel</option>
                <option value="right">Wire right of travel</option>
              </>
            ) : null}
            <option value="centerline">Centreline · no compensation</option>
          </select>
        </label>
        <details className="text-muted-foreground" data-upid-compensation-details>
          <summary className="cursor-pointer select-none">
            {uncompensated
              ? 'No compensation · wire follows drawn path'
              : compensationResolution?.status === 'ready'
                ? keptMaterial && wirePosition
                  ? `Keep ${keptMaterial} · Wire ${wirePosition}`
                  : `Wire ${compensationResolution.wireSide} of travel`
                : 'Compensation details'}
          </summary>
          <dl className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 border-l border-border pl-2">
            {selected?.closed && <>
              <dt>Material to keep</dt>
              <dd data-testid="compensation-kept-material">
                {keptMaterial ? `${keptMaterial === 'inside' ? 'Inside' : 'Outside'} contour` : '—'}
              </dd>
            </>}
            <dt>Wire offset</dt>
            <dd data-testid="compensation-wire-side">
              {uncompensated
                ? 'None · follows drawn path'
                : compensationResolution?.status === 'ready'
                  ? `${wirePosition ? `${wirePosition === 'inside' ? 'Inside' : 'Outside'} contour · ` : ''}${compensationResolution.wireSide} of travel`
                  : '—'}
            </dd>
            <dt>Travel direction</dt>
            <dd data-testid="compensation-winding">
              {compensationResolution?.status === 'ready' && compensationResolution.winding
                ? compensationResolution.winding === 'ccw' ? 'Counterclockwise (CCW)' : 'Clockwise (CW)'
                : '—'}
            </dd>
            <dt>Selection</dt>
            <dd>{selected?.compensationIntent
              ? selected.compensationIntent.source === 'automatic'
                ? `Automatic · ${selected.classification}`
                : 'Manual'
              : 'Not selected'}</dd>
          </dl>
        </details>
        {document.geometryBasis === 'wire-centre' ? (
          <p className="text-muted-foreground">Controller compensation is off for wire-centre geometry. Change Geometry basis to Finished contour to use the saved intent.</p>
        ) : selected?.compensationIntent?.mode === 'centerline' ? (
          <p className="text-muted-foreground">The wire follows the drawn contour without controller compensation.</p>
        ) : compensationResolution?.status === 'blocked' && (
          <p className="text-amber-300" data-testid="compensation-blocker">
            {compensationBlockerMessage(compensationResolution.reason)}
          </p>
        )}
        {selected?.closed && document.geometryBasis === 'finished-contour' && keptMaterial && (
          <p className="text-muted-foreground">Reversing travel changes left/right; the kept material and inside/outside wire position stay the same.</p>
        )}
        {document.machiningParticipation?.partialContourCompensation?.some(
          (setting) => setting.sourceOperationId === selected?.id
        ) && (
          <p className="text-muted-foreground">This contour also has a partial-cut side override. Reversing keeps that left or right choice, which moves the wire to the opposite side of the material. Review it in Machining participation.</p>
        )}
      </section>
    </section>
  );
}

export function EditorSetStartPanel({
  disabled,
  document,
  inferenceMode,
  onInferenceModeChange,
  onPickStart,
  onSelectOperation,
  selectedOperationId
}: {
  disabled: boolean;
  document: PathPlanningDocument;
  inferenceMode: 'endpoint' | 'nearest' | 'midpoint' | 'perpendicular';
  onInferenceModeChange: (
    mode: 'endpoint' | 'nearest' | 'midpoint' | 'perpendicular'
  ) => void;
  onPickStart: (operationId: string) => void;
  onSelectOperation: (operationId: string) => void;
  selectedOperationId: string | null;
}) {
  const operations = orderedPathOperations(document.plan.operations);
  const selected = operations.find(
    (operation) => operation.id === selectedOperationId && operation.closed
  )
    ?? operations.find((operation) => operation.closed)
    ?? null;

  return (
    <section className="grid gap-2 text-[10px]" data-upid-set-start-workflow>
      <p className="text-muted-foreground">
        Every operation has an automatic contour start. Pick a closed contour to set an exact override.
        Picking inside a segment splits it at that point; manual leads then need review.
      </p>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Target contour
        <select
          aria-label="Set start operation"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={!selected || disabled}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected?.id ?? ''}
        >
          {operations.map((operation, executionIndex) => operation.closed ? (
            <option key={operation.id} value={operation.id}>
              {String(executionIndex + 1).padStart(2, '0')}. {operation.displayName}
            </option>
          ) : null)}
        </select>
      </label>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Point inference
        <select
          aria-label="Set start point inference"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={!selected || disabled}
          onChange={(event) => onInferenceModeChange(
            event.currentTarget.value as 'endpoint' | 'nearest' | 'midpoint' | 'perpendicular'
          )}
          value={inferenceMode}
        >
          <option value="endpoint">Nearest endpoint</option>
          <option value="nearest">Nearest point to cursor</option>
          <option value="midpoint">Hovered side midpoint</option>
          <option value="perpendicular">Perpendicular from approach</option>
        </select>
      </label>
      <div className="flex items-start gap-2 border border-sky-500/40 bg-sky-500/5 p-2 text-sky-100">
        <MousePointer2 className="mt-0.5 size-3 shrink-0" />
        <span>
          {selected
            ? `${selected.displayName} currently starts at X${selected.startPoint.x.toFixed(3)} Y${selected.startPoint.y.toFixed(3)}. Start picking to preview the approach guide and apply the inferred point.`
            : 'No closed contour is available.'}
        </span>
      </div>
      <button
        aria-label="Pick explicit contour start"
        className={buttonClass}
        disabled={!selected || disabled}
        onClick={() => selected && onPickStart(selected.id)}
        type="button"
      >
        <MousePointer2 className="size-3" />
        Pick explicit start
      </button>
    </section>
  );
}

function compensationBlockerMessage(
  reason: Extract<ReturnType<typeof resolveControllerCompensation>, { status: 'blocked' }>['reason']
) {
  const messages = {
    'wire-centre': 'Controller compensation is off for wire-centre geometry.',
    'missing-intent': 'Choose the material to keep, or choose Centreline to cut without compensation.',
    'open-path': 'Inside and outside require a closed contour. Intentional partial cuts need an explicit wire side in Machining participation and continuous, nonzero geometry.',
    'missing-segment': 'The contour references missing geometry. Repair it before using controller compensation.',
    degenerate: 'The contour has no valid enclosed area. Repair it before using controller compensation.',
    'ineligible-topology': 'Resolve contour gaps, overlaps, or intersections before using controller compensation.'
  };
  return messages[reason];
}
