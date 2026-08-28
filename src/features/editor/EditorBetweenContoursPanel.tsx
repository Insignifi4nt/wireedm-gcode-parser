import { useMemo } from 'react';

import { derivePlannedRapidRoutes } from '@/domain/path-editor/pathDocumentOperations';
import { orderedPathOperations } from '@/domain/path-intel/operationExecutionOrder';
import type {
  OperationThreadingTransition,
  PathPlanningDocument,
  Point2
} from '@/domain/path-intel/types';

interface EditorBetweenContoursPanelProps {
  disabled: boolean;
  document: PathPlanningDocument;
  onSelectOperation: (operationId: string) => void;
  onSetOperationThreading: (
    operationId: string,
    transition: Omit<OperationThreadingTransition, 'source'> | null
  ) => void;
  onSetProjectThreading: (
    transition: Omit<OperationThreadingTransition, 'source'>
  ) => void;
  selectedOperationId: string | null;
  targetChangeBlocked?: boolean;
}

export function EditorBetweenContoursPanel({
  disabled,
  document,
  onSelectOperation,
  onSetOperationThreading,
  onSetProjectThreading,
  selectedOperationId,
  targetChangeBlocked = false
}: EditorBetweenContoursPanelProps) {
  const operations = useMemo(
    () => orderedPathOperations(document.plan.operations),
    [document.plan.operations]
  );
  const selected = operations.find(
    (operation) => operation.id === selectedOperationId
  ) ?? operations[0] ?? null;
  const selectedExecutionIndex = selected
    ? operations.findIndex((operation) => operation.id === selected.id)
    : -1;
  const route = selected
    ? derivePlannedRapidRoutes(document).find(
        (candidate) => candidate.operationId === selected.id
      ) ?? null
    : null;
  const threading = selected?.threadingTransition ?? document.setup?.threadingDefault ?? null;
  const projectThreading = document.setup?.threadingDefault ?? {
    mode: 'manual' as const,
    wireSeparation: 'already-separated' as const
  };

  if (!selected || !route) {
    return <p className="text-[10px] text-muted-foreground">No operations are available.</p>;
  }

  const previous = operations[selectedExecutionIndex - 1] ?? null;

  return (
    <section className="grid gap-2 text-[10px]" data-between-contours-panel>
      <div>
        <h3 className="text-[11px] font-semibold">Between Contours</h3>
        <p className="mt-1 text-muted-foreground">
          Positioning travel is derived from cut exits and entries. Edit those points in Entry / Exit;
          this panel owns only the between-contour threading lifecycle.
        </p>
      </div>

      <label className="grid gap-1 uppercase text-muted-foreground">
        Destination operation
        <select
          aria-label="Between contours destination operation"
          className="h-7 border border-border bg-background px-1.5 text-foreground"
          disabled={disabled || targetChangeBlocked}
          onChange={(event) => onSelectOperation(event.currentTarget.value)}
          value={selected.id}
        >
          {operations.map((operation, executionIndex) => (
            <option key={operation.id} value={operation.id}>
              {String(executionIndex + 1).padStart(2, '0')}. {operation.displayName}
            </option>
          ))}
        </select>
      </label>

      {selectedExecutionIndex === 0 ? (
        <div className="border border-sky-500/40 bg-sky-500/5 p-2 text-sky-100">
          The first connection belongs to Program Start / G92. Configure its origin there; the
          destination remains the first contour entry or contour start.
        </div>
      ) : (
        <>
          <fieldset className="grid gap-1 border border-border p-2">
            <legend className="px-1 uppercase text-muted-foreground">
              After {previous?.displayName}
            </legend>
            <ReadOnlyPoint label="From resolved exit" point={route.startPoint} />
            <ReadOnlyPoint
              label={route.destinationKind === 'lead-in-start' ? 'To cut entry' : 'To contour start'}
              point={route.endPoint}
            />
            <div className="flex justify-between text-muted-foreground">
              <span>Derived rapid distance</span>
              <span className="font-mono text-foreground">{route.length.toFixed(3)} mm</span>
            </div>
          </fieldset>

          <fieldset className="grid gap-1 border border-border p-2" disabled={disabled}>
            <legend className="px-1 uppercase text-muted-foreground">Rethreading</legend>
            <label className="grid grid-cols-[1fr_120px] items-center gap-2 text-muted-foreground">
              Project default
              <select
                aria-label="Project threading default"
                className="h-7 border border-border bg-background px-1 text-foreground"
                onChange={(event) =>
                  onSetProjectThreading(threadingForMode(event.currentTarget.value))
                }
                value={projectThreading.mode}
              >
                <option value="manual">Manual</option>
                <option value="automatic">Automatic</option>
              </select>
            </label>
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
                    wireSeparation: event.currentTarget.value as
                      | 'already-separated'
                      | 'manual-before-positioning'
                  })}
                  value={selected.threadingTransition.wireSeparation}
                >
                  <option value="already-separated">Wire already separated</option>
                  <option value="manual-before-positioning">Stop to separate wire</option>
                </select>
              </label>
            )}
            <p className={threading ? 'text-emerald-300' : 'text-amber-300'}>
              {threading
                ? `${threading.mode} threading · ${threading.wireSeparation}`
                : 'Choose an explicit project or operation threading transition.'}
            </p>
          </fieldset>
        </>
      )}
    </section>
  );
}

function ReadOnlyPoint({ label, point }: { label: string; point: Point2 }) {
  return (
    <div className="flex justify-between gap-2 text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono text-foreground">{formatPoint(point)}</span>
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

function formatPoint(point: Point2) {
  return `X${point.x.toFixed(3)} Y${point.y.toFixed(3)}`;
}
