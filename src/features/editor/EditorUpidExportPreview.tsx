import { Download, X } from 'lucide-react';

import type { GCodeProgramLineMap } from '@/domain/post/gcodeTemplates';
import type { UpidGCodeProgramOperation } from '@/domain/upid/upidDocument';
import type { OperationOrderStrategy, PathDiagnostic } from '@/domain/path-intel/types';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

interface EditorUpidExportPreviewProps {
  diagnostics: PathDiagnostic[];
  fileName: string;
  machineName: string;
  operationCount: number;
  planning: {
    manualOrderCount: number;
    operationOrderStrategy: OperationOrderStrategy;
  };
  postMetrics: {
    cutMoveCount: number;
    rapidCount: number;
  };
  postedOperations: UpidGCodeProgramOperation[];
  programLines: GCodeProgramLineMap[];
  onClose: () => void;
  onDownload: () => void;
  onHoverPathElement?: (element: EditorPathElementRef | null) => void;
  onSelectPathElement?: (element: EditorPathElementRef) => void;
}

export function EditorUpidExportPreview({
  diagnostics,
  fileName,
  machineName,
  operationCount,
  planning,
  postMetrics,
  postedOperations,
  programLines,
  onClose,
  onDownload,
  onHoverPathElement,
  onSelectPathElement
}: EditorUpidExportPreviewProps) {
  return (
    <section
      aria-label="UPID Export Preview"
      className="absolute inset-3 z-20 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/98 font-mono text-[10px] shadow-2xl"
      data-upid-export-preview
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border bg-card px-2 py-2">
        <div className="min-w-0">
          <p className="text-[9px] uppercase text-muted-foreground">Export Preview</p>
          <h2 className="truncate text-[12px] font-semibold">UPID Export Preview</h2>
          <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
            {machineName} / {fileName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Download UPID export program"
            className="flex h-7 items-center gap-1 border border-border px-2 text-[10px] text-muted-foreground outline-none transition hover:bg-accent"
            onClick={onDownload}
            type="button"
          >
            <Download className="size-3" />
            Download
          </button>
          <button
            aria-label="Close UPID export preview"
            className="flex size-7 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent"
            onClick={onClose}
            title="Close export preview"
            type="button"
          >
            <X className="size-3" />
          </button>
        </div>
      </div>
      <section
        className="grid gap-2 border-b border-border bg-background/55 px-2 py-2"
        data-upid-export-summary
      >
        <dl className="grid grid-cols-2 gap-1 md:grid-cols-6">
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Operations</dt>
            <dd data-upid-export-stat="operations">{operationCount}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Rapid</dt>
            <dd data-upid-export-stat="rapid">{postMetrics.rapidCount}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Cut</dt>
            <dd data-upid-export-stat="cut">{postMetrics.cutMoveCount}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Diagnostics</dt>
            <dd data-upid-export-stat="diagnostics">{diagnostics.length}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[8px] uppercase text-muted-foreground">Planning</dt>
            <dd className="truncate" data-upid-export-stat="planning-mode">
              {formatOperationOrderStrategy(planning.operationOrderStrategy)}
            </dd>
          </div>
          <div
            className="min-w-0 border border-border bg-card/60 px-2 py-1"
            data-upid-export-manual-order-active={planning.manualOrderCount > 0 ? 'true' : undefined}
          >
            <dt className="text-[8px] uppercase text-muted-foreground">Manual Order</dt>
            <dd data-upid-export-stat="manual-order">{formatManualOrderCount(planning.manualOrderCount)}</dd>
          </div>
        </dl>
        {diagnostics.length > 0 && (
          <div className="max-h-20 overflow-auto border border-border bg-card/60" data-upid-export-diagnostics>
            {diagnostics.map((diagnostic) => (
              <div
                className="border-b border-border px-2 py-1 last:border-b-0"
                data-upid-export-diagnostic-code={diagnostic.code}
                data-upid-export-diagnostic-row
                data-upid-export-diagnostic-severity={diagnostic.severity}
                key={diagnostic.id}
              >
                <span className="mr-2 uppercase text-amber-200">{diagnostic.severity}</span>
                <span>{diagnostic.message}</span>
              </div>
            ))}
          </div>
        )}
        {postedOperations.length > 0 && (
          <section className="border border-border bg-card/60" data-upid-export-operations>
            <div className="border-b border-border px-2 py-1 text-[8px] uppercase text-muted-foreground">
              Posted Operations
            </div>
            <div className="max-h-28 overflow-auto">
              {postedOperations.map((operation) => (
                <div className="border-b border-border last:border-b-0" key={operation.operationId}>
                  <div
                    className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1"
                    data-upid-export-operation-body-lines={formatBodyLineRange(operation)}
                    data-upid-export-operation-id={operation.operationId}
                    data-upid-export-operation-lines={operation.programLineRange}
                    data-upid-export-operation-path-element={operation.pathElementId ?? undefined}
                    data-upid-export-operation-row
                    data-upid-export-operation-role={operation.classification}
                  >
                    <span className="text-muted-foreground">{operation.orderIndex + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-foreground">{operation.displayName}</span>
                      <span className="block truncate text-[8px] text-muted-foreground">
                        {operation.direction} / lines {operation.programLineRange}
                      </span>
                    </span>
                    <span className="text-right text-[8px] uppercase text-muted-foreground">
                      {operation.cutMoveCount} cut / {operation.rapidCount} rapid
                    </span>
                  </div>
                  <div className="border-t border-border/70 bg-background/35" data-upid-export-move-stack>
                    {operation.moves.map((move) => {
                      const traceRef = upidMoveTraceRef(move);

                      return (
                        <button
                          className="grid grid-cols-[2.5rem_2rem_minmax(0,1fr)_8rem] items-center gap-2 border-b border-border/70 px-2 py-1 last:border-b-0"
                          data-upid-export-move-command={move.command}
                          data-upid-export-move-body-line={move.bodyLineIndex + 1}
                          data-upid-export-move-kind={move.kind}
                          data-upid-export-move-line={move.programLineNumber}
                          data-upid-export-move-path-element={move.pathElementId ?? undefined}
                          data-upid-export-move-reason={move.reason}
                          data-upid-export-move-row
                          data-upid-export-move-segment={move.segmentId ?? undefined}
                          data-upid-export-move-segment-index={move.segmentIndex ?? undefined}
                          data-upid-export-move-segment-ordinal={move.segmentOrdinal ?? undefined}
                          disabled={!traceRef}
                          key={`${operation.operationId}-${move.bodyLineIndex}`}
                          onClick={() => {
                            if (traceRef) onSelectPathElement?.(traceRef);
                          }}
                          onMouseEnter={() => {
                            if (traceRef) onHoverPathElement?.(traceRef);
                          }}
                          onMouseLeave={() => {
                            if (traceRef) onHoverPathElement?.(null);
                          }}
                          type="button"
                        >
                          <span className="text-muted-foreground">{move.programLineNumber}</span>
                          <span
                            className={
                              move.kind === 'rapid' ? 'uppercase text-sky-200' : 'uppercase text-green-200'
                            }
                          >
                            {move.command}
                          </span>
                          <span className="min-w-0 truncate text-foreground">{move.text}</span>
                          <span className="truncate text-right text-[8px] uppercase text-muted-foreground">
                            {move.segmentOrdinal ? `S${move.segmentOrdinal} / ` : ''}
                            {move.reason}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
      <div
        className="min-h-0 overflow-auto bg-background/80 p-3 leading-5 text-foreground"
        data-upid-export-gcode
      >
        {programLines.map((line) => (
          <div
            className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b border-border/40 py-0.5 last:border-b-0"
            data-upid-export-program-line={line.lineNumber}
            data-upid-export-program-line-row
            data-upid-export-program-section={line.section}
            key={`${line.lineNumber}-${line.text}`}
          >
            <span className="select-none text-right text-muted-foreground">{line.lineNumber}</span>
            <code className="whitespace-pre-wrap break-words">{line.text}</code>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatOperationOrderStrategy(strategy: OperationOrderStrategy) {
  if (strategy === 'source-order') return 'Source order';
  if (strategy === 'nearest') return 'Nearest travel';
  return 'Inside/out nearest';
}

function formatManualOrderCount(count: number) {
  if (count <= 0) return 'Automatic';
  return `${count} ${count === 1 ? 'operation' : 'operations'}`;
}

function formatBodyLineRange(operation: Pick<UpidGCodeProgramOperation, 'bodyLineEnd' | 'bodyLineStart'>) {
  return `${operation.bodyLineStart + 1}-${operation.bodyLineEnd + 1}`;
}

function upidMoveTraceRef(
  move: UpidGCodeProgramOperation['moves'][number]
): EditorPathElementRef | null {
  if (!move.operationId || !move.pathElementId) return null;

  return {
    operationId: move.operationId,
    pathElementId: move.pathElementId,
    segmentId: move.segmentId,
    travelRole: move.kind === 'rapid' && move.reason === 'operation-start' ? 'rapid-in' : undefined
  };
}
