import { MousePointer2, RefreshCw } from 'lucide-react';

import type { ManualCompensationSelection } from '@/domain/compensation/intent';
import { resolveControllerCompensation } from '@/domain/compensation/resolveControllerCompensation';
import type {
  ContourClassification,
  PathPlanningDocument
} from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

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
      <div>
        <h3 className="text-[11px] font-semibold">Geometry Setup</h3>
        <p className="mt-1 text-muted-foreground">
          Choose whether imported geometry represents the wire centre path or the finished contour.
        </p>
      </div>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Geometry Basis
        <select
          aria-label="Geometry basis"
          className="h-7 border border-border bg-background px-1.5 font-mono text-foreground"
          disabled={disabled}
          onChange={(event) =>
            onSetGeometryBasis(event.currentTarget.value as PathPlanningDocument['geometryBasis'])
          }
          value={document.geometryBasis}
        >
          <option value="wire-centre">Wire centre</option>
          <option value="finished-contour">Finished contour</option>
        </select>
      </label>
    </section>
  );
}

export function EditorContourSetupPanel({
  disabled,
  document,
  machine,
  onReverse,
  onSelectOperation,
  onSetClassification,
  onSetCompensation,
  selectedOperationId
}: {
  disabled: boolean;
  document: PathPlanningDocument;
  machine: MachineProfile;
  onReverse: (operationId: string) => void;
  onSelectOperation: (operationId: string) => void;
  onSetClassification: (operationId: string, classification: ContourClassification) => void;
  onSetCompensation: (operationId: string, selection: ManualCompensationSelection) => void;
  selectedOperationId: string | null;
}) {
  const selected = document.plan.operations.find((operation) => operation.id === selectedOperationId)
    ?? document.plan.operations[0]
    ?? null;
  const compensationResolution = selected
    ? resolveControllerCompensation({ document, operation: selected })
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
    <section className="grid gap-2 text-[10px]" data-upid-contour-setup>
      <div>
        <h3 className="text-[11px] font-semibold">Contour Setup</h3>
        <p className="mt-1 text-muted-foreground">
          Set direction, machining role, and compensation intent for one contour.
        </p>
      </div>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Target contour
        <select
          aria-label="Contour setup operation"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={disabled}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected?.id ?? ''}
        >
          {document.plan.operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.orderIndex + 1}. {operation.displayName}
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
          onChange={(event) =>
            selected && onSetClassification(
              selected.id,
              event.currentTarget.value as ContourClassification
            )
          }
          value={selected?.classification ?? ''}
        >
          {CONTOUR_ROLE_OPTIONS.map((classification) => (
            <option key={classification} value={classification}>
              {classification}
            </option>
          ))}
        </select>
      </label>
      <section className="grid gap-1 border border-border bg-background/50 p-1.5" data-upid-compensation-review>
        <label className="grid gap-1 uppercase text-muted-foreground">
          Compensation
          <select
            aria-label="Compensation kept material"
            className="h-7 border border-border bg-background px-1.5 text-foreground"
            disabled={!selected || disabled}
            onChange={(event) => {
              if (event.currentTarget.value === '' || event.currentTarget.value === 'automatic') return;
              if (!selected) return;
              onSetCompensation(
                selected.id,
                event.currentTarget.value as ManualCompensationSelection
              );
            }}
            value={compensationSelection}
          >
            <option value="">Choose kept material</option>
            {compensationSelection === 'automatic' && <option value="automatic">Automatic</option>}
            {selected?.closed ? (
              <>
                <option value="inside">Keep inside</option>
                <option value="outside">Keep outside</option>
              </>
            ) : selected?.machiningIntent?.kind === 'partial-contour' ? (
              <>
                <option value="left">Wire left of travel</option>
                <option value="right">Wire right of travel</option>
              </>
            ) : null}
            <option value="centerline">Centreline</option>
          </select>
        </label>
        <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5">
          <dt className="text-muted-foreground">Intent</dt>
          <dd data-testid="compensation-kept-material">
            {formatCompensationIntent(selected?.compensationIntent)}
          </dd>
          <dt className="text-muted-foreground">Wire side</dt>
          <dd data-testid="compensation-wire-side">
            {compensationResolution?.status === 'ready' ? compensationResolution.wireSide : '—'}
          </dd>
          <dt className="text-muted-foreground">Final refs</dt>
          <dd data-testid="compensation-winding">
            {compensationResolution?.status === 'ready' && compensationResolution.winding
              ? compensationResolution.winding.toUpperCase()
              : '—'}
          </dd>
          <dt className="text-muted-foreground">Controller</dt>
          <dd data-testid="compensation-code">
            {compensationResolution?.status === 'ready'
              ? `${compensationResolution.code} D${machine.compensation.offsetSelection.index}`
              : '—'}
          </dd>
          <dt className="text-muted-foreground">Snapshot</dt>
          <dd data-testid="compensation-machine-status">
            {machine.controller.verification.status}
          </dd>
        </dl>
        {compensationResolution?.status === 'blocked' && (
          <p className="text-amber-300" data-testid="compensation-blocker">
            Blocked: {compensationResolution.reason}
          </p>
        )}
      </section>
    </section>
  );
}

export function EditorSetStartPanel({
  disabled,
  document,
  magneticSnapEnabled,
  onPickStart,
  onSelectOperation,
  onToggleMagneticSnap,
  selectedOperationId
}: {
  disabled: boolean;
  document: PathPlanningDocument;
  magneticSnapEnabled: boolean;
  onPickStart: (operationId: string) => void;
  onSelectOperation: (operationId: string) => void;
  onToggleMagneticSnap: () => void;
  selectedOperationId: string | null;
}) {
  const selected = document.plan.operations.find(
    (operation) => operation.id === selectedOperationId && operation.closed
  )
    ?? document.plan.operations.find((operation) => operation.closed)
    ?? null;

  return (
    <section className="grid gap-2 text-[10px]" data-upid-set-start-workflow>
      <div>
        <h3 className="text-[11px] font-semibold">Set Start</h3>
        <p className="mt-1 text-muted-foreground">
          Choose a closed contour, then pick its new start on the canvas. The preview follows the pointer.
        </p>
      </div>
      <label className="grid gap-1 uppercase text-muted-foreground">
        Target contour
        <select
          aria-label="Set start operation"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={disabled}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected?.id ?? ''}
        >
          {document.plan.operations.filter((operation) => operation.closed).map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.orderIndex + 1}. {operation.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 border border-border p-2">
        <span>Allow magnetic segment splitting</span>
        <input
          aria-label="Toggle set start magnetic snap"
          checked={magneticSnapEnabled}
          disabled={disabled}
          onChange={onToggleMagneticSnap}
          type="checkbox"
        />
      </label>
      <div className="flex items-start gap-2 border border-sky-500/40 bg-sky-500/5 p-2 text-sky-100">
        <MousePointer2 className="mt-0.5 size-3 shrink-0" />
        <span>
          {selected
            ? `Picking start for ${selected.displayName}. Click ${magneticSnapEnabled ? 'any point on the contour' : 'an existing endpoint'}.`
            : 'No closed contour is available.'}
        </span>
      </div>
      <button
        aria-label="Pick another start"
        className={buttonClass}
        disabled={!selected || disabled}
        onClick={() => selected && onPickStart(selected.id)}
        type="button"
      >
        <MousePointer2 className="size-3" />
        Pick another start
      </button>
    </section>
  );
}

function formatCompensationIntent(
  intent: PathPlanningDocument['plan']['operations'][number]['compensationIntent']
) {
  if (!intent) return 'not selected';
  if (intent.mode === 'centerline') return `centreline · ${intent.source}`;
  return `${'wireSide' in intent ? `wire ${intent.wireSide}` : intent.keptMaterial} · ${intent.source}`;
}
