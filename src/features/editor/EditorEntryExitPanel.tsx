import { useEffect, useMemo, useState } from 'react';

import { normalizeLegacyOperationTransitions } from '@/domain/path-intel/operationTransitions';
import { resolveOperationThreadingTransition } from '@/domain/path-intel/threadingTransitions';
import type {
  OperationThreadingTransition,
  PathPlanningDocument,
  Point2
} from '@/domain/path-intel/types';
import type { MachineProfile } from '@/domain/workbench/types';

interface EditorEntryExitPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  machine: MachineProfile;
  onSelectOperation: (operationId: string) => void;
  onSetCircleCenterEntry: (operationId: string) => void;
  onSetManualEntry: (operationId: string, point: Point2) => void;
  onSetManualExit: (operationId: string, point: Point2) => void;
  onSetOperationThreading: (
    operationId: string,
    transition: Omit<OperationThreadingTransition, 'source'> | null
  ) => void;
  onSetProjectThreading: (
    transition: Omit<OperationThreadingTransition, 'source'>
  ) => void;
  selectedOperationId: string | null;
}

export function EditorEntryExitPanel({
  disabled,
  document,
  machine,
  onSelectOperation,
  onSetCircleCenterEntry,
  onSetManualEntry,
  onSetManualExit,
  onSetOperationThreading,
  onSetProjectThreading,
  selectedOperationId
}: EditorEntryExitPanelProps) {
  const selected = document.plan.operations.find(
    (operation) => operation.id === selectedOperationId
  ) ?? document.plan.operations[0] ?? null;
  const transitions = selected ? normalizeLegacyOperationTransitions(selected) : {};
  const [entryX, setEntryX] = useState('');
  const [entryY, setEntryY] = useState('');
  const [exitX, setExitX] = useState('');
  const [exitY, setExitY] = useState('');

  useEffect(() => {
    setEntryX(transitions.entry ? String(transitions.entry.from.x) : '');
    setEntryY(transitions.entry ? String(transitions.entry.from.y) : '');
    setExitX(transitions.exit ? String(transitions.exit.to.x) : '');
    setExitY(transitions.exit ? String(transitions.exit.to.y) : '');
  }, [selected?.id, transitions.entry?.from.x, transitions.entry?.from.y, transitions.exit?.to.x, transitions.exit?.to.y]);

  const threading = useMemo(
    () => selected && selected.orderIndex > 0
      ? resolveOperationThreadingTransition(document, selected.id, machine)
      : null,
    [document, machine, selected]
  );
  const entryPoint = readFinitePoint(entryX, entryY);
  const exitPoint = readFinitePoint(exitX, exitY);
  const projectThreading = document.setup?.threadingDefault ?? {
    mode: 'manual' as const,
    wireSeparation: 'already-separated' as const
  };

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
          disabled={disabled}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected.id}
        >
          {document.plan.operations.map((operation) => (
            <option key={operation.id} value={operation.id}>
              {operation.orderIndex + 1}. {operation.displayName}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Entry</legend>
        <div className="text-foreground" data-entry-strategy>
          {entryStrategyLabel(transitions.entry)}
        </div>
        <CoordinateInputs
          label="Entry"
          onXChange={setEntryX}
          onYChange={setEntryY}
          x={entryX}
          y={entryY}
        />
        <div className="grid grid-cols-2 gap-1">
          <button
            className="h-7 border border-border bg-background disabled:opacity-40"
            disabled={!entryPoint}
            onClick={() => entryPoint && onSetManualEntry(selected.id, entryPoint)}
            type="button"
          >
            Set straight entry
          </button>
          <button
            className="h-7 border border-border bg-background disabled:opacity-40"
            onClick={() => onSetCircleCenterEntry(selected.id)}
            type="button"
          >
            Use circle center
          </button>
        </div>
      </fieldset>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Exit</legend>
        <div className="text-foreground" data-exit-strategy>
          {transitions.exit
            ? `Reviewed straight exit · ${formatPoint(transitions.exit.from)} → ${formatPoint(transitions.exit.to)}`
            : 'No explicit exit · contour ends at its operation endpoint'}
        </div>
        <CoordinateInputs
          label="Exit"
          onXChange={setExitX}
          onYChange={setExitY}
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
      </fieldset>

      <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
        <legend className="px-1 uppercase text-muted-foreground">Rethreading</legend>
        <label className="grid grid-cols-[1fr_120px] items-center gap-2 text-muted-foreground">
          Project default
          <select
            aria-label="Project threading default"
            className="h-7 border border-border bg-background px-1 text-foreground"
            onChange={(event) => onSetProjectThreading(threadingForMode(event.currentTarget.value))}
            value={projectThreading.mode}
          >
            <option value="manual">Manual</option>
            <option value="automatic">Automatic</option>
          </select>
        </label>
        {selected.orderIndex === 0 ? (
          <p className="text-muted-foreground">Initial threading is owned by Initial Wire Position setup.</p>
        ) : (
          <>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 text-muted-foreground">
              This transition
              <select
                aria-label="Operation threading mode"
                className="h-7 border border-border bg-background px-1 text-foreground"
                onChange={(event) => {
                  const mode = event.currentTarget.value;
                  onSetOperationThreading(
                    selected.id,
                    mode === 'project-default' ? null : threadingForMode(mode)
                  );
                }}
                value={selected.threadingTransition?.mode ?? 'project-default'}
              >
                <option value="project-default">Project default</option>
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
                <option value="continuous">Continuous</option>
              </select>
            </label>
            {selected.threadingTransition?.mode === 'manual' && (
              <label className="grid grid-cols-[1fr_180px] items-center gap-2 text-muted-foreground">
                Before positioning
                <select
                  aria-label="Manual wire separation"
                  className="h-7 border border-border bg-background px-1 text-foreground"
                  onChange={(event) => onSetOperationThreading(selected.id, {
                    mode: 'manual',
                    wireSeparation: event.currentTarget.value as 'already-separated' | 'manual-before-positioning'
                  })}
                  value={selected.threadingTransition.wireSeparation}
                >
                  <option value="already-separated">Wire already separated</option>
                  <option value="manual-before-positioning">Stop to separate wire</option>
                </select>
              </label>
            )}
            <p className={threading?.status === 'blocked' ? 'text-amber-300' : 'text-emerald-300'}>
              {threading?.status === 'ready'
                ? threading.transition.mode === 'manual'
                  ? 'Manual: position at entry, M00, then activate compensation and cut.'
                  : `${threading.transition.mode} transition is authorized.`
                : threading?.message}
            </p>
          </>
        )}
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

function threadingForMode(mode: string): Omit<OperationThreadingTransition, 'source'> {
  if (mode === 'automatic') {
    return { mode: 'automatic', wireSeparation: 'automatic-before-positioning' };
  }
  if (mode === 'continuous') {
    return { mode: 'continuous', wireSeparation: 'already-separated' };
  }
  return { mode: 'manual', wireSeparation: 'already-separated' };
}

function entryStrategyLabel(
  entry: ReturnType<typeof normalizeLegacyOperationTransitions>['entry']
) {
  if (!entry) return 'No explicit entry';
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
