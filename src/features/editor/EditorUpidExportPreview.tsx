import { Download, X } from 'lucide-react';

import type { GCodeProgramLineMap } from '@/domain/post/gcodeTemplates';
import {
  projectUpidPathDiagnostic,
  type UpidSelectedPathDiagnostic
} from '@/domain/upid/projectRail';
import type {
  UpidGCodeExportDocumentTrace,
  UpidGCodeProgramManualDecisionKind,
  UpidGCodeProgramOperation
} from '@/domain/upid/upidDocument';
import type { OperationOrderStrategy, PathDiagnostic, PathPlanningDocument } from '@/domain/path-intel/types';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

interface EditorUpidExportPreviewProps {
  blockingDiagnostics: PathDiagnostic[];
  canDownload: boolean;
  diagnostics: PathDiagnostic[];
  documentTrace: UpidGCodeExportDocumentTrace;
  fileName: string;
  machineName: string;
  operationCount: number;
  pathDocument: PathPlanningDocument;
  planning: {
    manualDecisionCount: number;
    manualDecisionCounts: Record<UpidGCodeProgramManualDecisionKind, number>;
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
  blockingDiagnostics,
  canDownload,
  diagnostics,
  documentTrace,
  fileName,
  machineName,
  operationCount,
  pathDocument,
  planning,
  postMetrics,
  postedOperations,
  programLines,
  onClose,
  onDownload,
  onHoverPathElement,
  onSelectPathElement
}: EditorUpidExportPreviewProps) {
  const exportReady = canDownload && blockingDiagnostics.length === 0;
  const visiblePostedOperations = exportReady ? postedOperations : [];
  const visibleProgramLines = exportReady
    ? programLines
    : programLines.filter((line) => line.section !== 'body');
  const tracedMovesByProgramLine = new Map(
    visiblePostedOperations.flatMap((operation) =>
      operation.moves.map((move) => [move.programLineNumber, move] as const)
    )
  );
  const visibleDiagnostics = stableDiagnosticUnion(diagnostics, blockingDiagnostics);
  const projectedDiagnostics = visibleDiagnostics.map((diagnostic) =>
    projectUpidPathDiagnostic(pathDocument, diagnostic)
  );
  const blockingDiagnosticIds = new Set(blockingDiagnostics.map((diagnostic) => diagnostic.id));

  return (
    <section
      aria-label="UPID Export Preview"
      className="absolute inset-3 z-20 grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/98 font-mono text-[10px] shadow-2xl"
      data-upid-export-preview
      data-upid-export-readiness={exportReady ? 'ready' : 'blocked'}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 border-b border-border bg-card px-2 py-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase text-muted-foreground">Export Preview</p>
          <h2 className="truncate text-[12px] font-semibold">UPID Export Preview</h2>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {machineName} / {fileName}
          </p>
          <p
            className="mt-0.5 truncate text-[10px] text-muted-foreground"
            data-upid-export-document-contours={documentTrace.contourCount}
            data-upid-export-document-format={documentTrace.format}
            data-upid-export-document-imported-at={documentTrace.importedAt ?? undefined}
            data-upid-export-document-operations={documentTrace.operationCount}
            data-upid-export-document-path-elements={documentTrace.pathElementCount}
            data-upid-export-document-project={documentTrace.projectId ?? undefined}
            data-upid-export-document-schema={documentTrace.schemaVersion}
            data-upid-export-document-segments={documentTrace.segmentCount}
            data-upid-export-document-source-entities={documentTrace.sourceEntityCount}
            data-upid-export-document-source-file={documentTrace.fileName ?? undefined}
            data-upid-export-document-source-kind={documentTrace.sourceKind}
            data-upid-export-document-trace
            data-upid-export-document-units={documentTrace.sourceUnits?.label ?? undefined}
            data-upid-export-document-units-code={documentTrace.sourceUnits?.code ?? undefined}
            data-upid-export-document-units-scale={
              documentTrace.sourceUnits?.scaleToMillimeters ?? undefined
            }
            data-upid-export-document-units-source={documentTrace.sourceUnits?.source ?? undefined}
          >
            UPID v{documentTrace.schemaVersion} / {documentTrace.sourceKind}
            {documentTrace.fileName ? ` / ${documentTrace.fileName}` : ''}
            {documentTrace.sourceUnits ? ` / ${documentTrace.sourceUnits.label}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-disabled={!exportReady}
            aria-label="Download UPID export program"
            className="flex h-7 items-center gap-1 border border-border px-2 text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!exportReady}
            onClick={() => {
              if (!exportReady) return;
              onDownload();
            }}
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
        {!exportReady && (
          <div
            aria-live="polite"
            className="border border-destructive/60 bg-destructive/10 px-2 py-1.5 text-destructive"
            data-upid-export-blocked
            data-upid-export-blocking-count={blockingDiagnostics.length}
            role="status"
          >
            <div className="flex items-center justify-between gap-2">
              <strong className="text-[11px] uppercase">Export blocked</strong>
              <span>
                {blockingDiagnostics.length} blocking {blockingDiagnostics.length === 1 ? 'issue' : 'issues'}
              </span>
            </div>
            <ul className="mt-1 grid gap-0.5 text-[10px] leading-4">
              {blockingDiagnostics.map((diagnostic) => (
                <li
                  data-upid-export-blocking-code={diagnostic.code}
                  data-upid-export-blocking-id={diagnostic.id}
                  data-upid-export-blocking-message
                  key={diagnostic.id}
                >
                  <span className="uppercase">{diagnostic.code}</span>: {diagnostic.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="grid grid-cols-2 gap-1 md:grid-cols-7">
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[10px] uppercase text-muted-foreground">Operations</dt>
            <dd data-upid-export-stat="operations">{exportReady ? operationCount : 0}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[10px] uppercase text-muted-foreground">Rapid</dt>
            <dd data-upid-export-stat="rapid">{exportReady ? postMetrics.rapidCount : 0}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[10px] uppercase text-muted-foreground">Cut</dt>
            <dd data-upid-export-stat="cut">{exportReady ? postMetrics.cutMoveCount : 0}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[10px] uppercase text-muted-foreground">Diagnostics</dt>
            <dd data-upid-export-stat="diagnostics">{visibleDiagnostics.length}</dd>
          </div>
          <div className="min-w-0 border border-border bg-card/60 px-2 py-1">
            <dt className="text-[10px] uppercase text-muted-foreground">Planning</dt>
            <dd className="truncate" data-upid-export-stat="planning-mode">
              {formatOperationOrderStrategy(planning.operationOrderStrategy)}
            </dd>
          </div>
          <div
            className="min-w-0 border border-border bg-card/60 px-2 py-1"
            data-upid-export-manual-order-active={planning.manualOrderCount > 0 ? 'true' : undefined}
          >
            <dt className="text-[10px] uppercase text-muted-foreground">Manual Order</dt>
            <dd data-upid-export-stat="manual-order">{formatManualOrderCount(planning.manualOrderCount)}</dd>
          </div>
          <div
            className="min-w-0 border border-border bg-card/60 px-2 py-1"
            data-upid-export-manual-decisions-active={planning.manualDecisionCount > 0 ? 'true' : undefined}
            data-upid-export-manual-decisions-direction={planning.manualDecisionCounts.direction}
            data-upid-export-manual-decisions-lead-in={planning.manualDecisionCounts['lead-in']}
            data-upid-export-manual-decisions-order={planning.manualDecisionCounts.order}
            data-upid-export-manual-decisions-role={planning.manualDecisionCounts.role}
            data-upid-export-manual-decisions-start={planning.manualDecisionCounts.start}
          >
            <dt className="text-[10px] uppercase text-muted-foreground">Manual Decisions</dt>
            <dd data-upid-export-stat="manual-decisions">
              {formatManualDecisionCount(planning.manualDecisionCount)}
              {planning.manualDecisionCount > 0 && (
                <span className="block truncate text-[10px] text-muted-foreground">
                  {formatManualDecisionBreakdown(planning.manualDecisionCounts)}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {projectedDiagnostics.length > 0 && (
          <div className="max-h-20 overflow-auto border border-border bg-card/60" data-upid-export-diagnostics>
            {projectedDiagnostics.map((diagnostic) =>
              renderExportDiagnosticRow({
                blocking: blockingDiagnosticIds.has(diagnostic.id),
                diagnostic,
                onHoverPathElement,
                onSelectPathElement
              })
            )}
          </div>
        )}
        {visiblePostedOperations.length > 0 && (
          <section className="border border-border bg-card/60" data-upid-export-operations>
            <div className="border-b border-border px-2 py-1 text-[10px] uppercase text-muted-foreground">
              Posted Operations
            </div>
            <div className="max-h-28 overflow-auto">
              {visiblePostedOperations.map((operation) => {
                const traceRef = upidOperationTraceRef(operation);

                return (
                  <div className="border-b border-border last:border-b-0" key={operation.operationId}>
                    <button
                      className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 px-2 py-1"
                      data-upid-export-operation-body-lines={formatBodyLineRange(operation)}
                      data-upid-export-operation-edited-segments={
                        operation.editedSegmentCount > 0 ? operation.editedSegmentCount : undefined
                      }
                      data-upid-export-operation-id={operation.operationId}
                      data-upid-export-operation-lines={operation.programLineRange}
                      data-upid-export-operation-manual={
                        operation.manualDecisionKinds.length > 0
                          ? operation.manualDecisionKinds.join(' ')
                          : undefined
                      }
                      data-upid-export-operation-manual-direction={
                        operation.manualDirection?.direction ?? undefined
                      }
                      data-upid-export-operation-manual-order={
                        operation.manualOrder ? operation.manualOrder.orderIndex : undefined
                      }
                      data-upid-export-operation-manual-role={
                        operation.manualClassification?.classification ?? undefined
                      }
                      data-upid-export-operation-path-element={operation.pathElementId ?? undefined}
                      data-upid-export-operation-row
                      data-upid-export-operation-role={operation.classification}
                      data-upid-export-operation-start-point-role={operation.manualStart?.pointRole ?? undefined}
                      data-upid-export-operation-start-relation={operation.manualStart?.relation ?? undefined}
                      data-upid-export-operation-start-segment={
                        operation.manualStart?.sourceSegmentId ?? undefined
                      }
                      disabled={!traceRef}
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
                      <span className="text-muted-foreground">{operation.orderIndex + 1}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-foreground">{operation.displayName}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {operation.direction} / lines {operation.programLineRange}
                        </span>
                        {operation.manualDecisionKinds.length > 0 && (
                          <span className="block truncate text-[10px] text-amber-200">
                            manual {operation.manualDecisionKinds.join(', ')}
                          </span>
                        )}
                        {operationHasManualOverrideDetails(operation) && (
                          <span className="block truncate text-[10px] text-cyan-200">
                            {formatManualOverrideDetails(operation)}
                          </span>
                        )}
                        {operation.manualStart && (
                          <span className="block truncate text-[10px] text-cyan-200">
                            start {formatManualStart(operation.manualStart)}
                          </span>
                        )}
                      </span>
                      <span className="text-right text-[10px] uppercase text-muted-foreground">
                        {operation.cutMoveCount} cut / {operation.rapidCount} rapid
                      </span>
                    </button>
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
                            <span className="truncate text-right text-[10px] uppercase text-muted-foreground">
                              {move.segmentOrdinal ? `S${move.segmentOrdinal} / ` : ''}
                              {move.reason}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </section>
      <div
        className="min-h-0 overflow-auto bg-background/80 p-3 leading-5 text-foreground"
        data-upid-export-gcode
      >
        {visibleProgramLines.map((line) => {
          const move = tracedMovesByProgramLine.get(line.lineNumber) ?? null;
          const traceRef = move ? upidMoveTraceRef(move) : null;

          return (
            <button
              className="grid w-full grid-cols-[3rem_minmax(0,1fr)] gap-3 border-b border-border/40 py-0.5 text-left last:border-b-0 disabled:cursor-text"
              data-upid-export-program-line={line.lineNumber}
              data-upid-export-program-line-path-element={move?.pathElementId ?? undefined}
              data-upid-export-program-line-row
              data-upid-export-program-line-segment={move?.segmentId ?? undefined}
              data-upid-export-program-line-segment-ordinal={move?.segmentOrdinal ?? undefined}
              data-upid-export-program-section={line.section}
              disabled={!traceRef}
              key={`${line.lineNumber}-${line.text}`}
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
              <span className="select-none text-right text-muted-foreground">{line.lineNumber}</span>
              <code className="whitespace-pre-wrap break-words">{line.text}</code>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function stableDiagnosticUnion(
  diagnostics: PathDiagnostic[],
  blockingDiagnostics: PathDiagnostic[]
) {
  const seen = new Set<string>();
  const union: PathDiagnostic[] = [];

  for (const diagnostic of [...diagnostics, ...blockingDiagnostics]) {
    if (seen.has(diagnostic.id)) continue;
    seen.add(diagnostic.id);
    union.push(diagnostic);
  }

  return union;
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

function formatManualDecisionCount(count: number) {
  if (count <= 0) return 'Automatic';
  return `${count} ${count === 1 ? 'decision' : 'decisions'}`;
}

function formatManualDecisionBreakdown(counts: Record<UpidGCodeProgramManualDecisionKind, number>) {
  return `order ${counts.order} / role ${counts.role} / direction ${counts.direction} / start ${counts.start} / lead-in ${counts['lead-in']}`;
}

function renderExportDiagnosticRow({
  blocking,
  diagnostic,
  onHoverPathElement,
  onSelectPathElement
}: {
  blocking: boolean;
  diagnostic: UpidSelectedPathDiagnostic;
  onHoverPathElement?: (element: EditorPathElementRef | null) => void;
  onSelectPathElement?: (element: EditorPathElementRef) => void;
}) {
  const traceRef = diagnostic.selectRef;
  const selectDiagnostic = () => {
    if (traceRef) onSelectPathElement?.(traceRef);
  };
  const content = (
    <>
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="uppercase text-amber-200">{diagnostic.severity}</span>
        <span className="truncate text-muted-foreground">{diagnostic.code}</span>
      </span>
      <span className="line-clamp-2 text-[10px] leading-4 text-muted-foreground">
        {diagnostic.message}
      </span>
      <span className="text-[10px] text-muted-foreground">
        segments {diagnostic.relatedSegmentCount} / clusters {diagnostic.relatedClusterCount}
      </span>
      {diagnostic.metrics.length > 0 && (
        <span className="flex min-w-0 flex-wrap gap-1 pt-0.5">
          {diagnostic.metrics.map((metric) => (
            <span
              className="border border-border bg-background/60 px-1 text-[10px] text-muted-foreground"
              data-upid-export-diagnostic-metric={metric.key}
              key={metric.key}
            >
              {metric.label} {formatNumber(metric.value)}
            </span>
          ))}
        </span>
      )}
    </>
  );

  return (
    <div
      className="border-b border-border last:border-b-0"
      data-upid-export-diagnostic-code={diagnostic.code}
      data-upid-export-diagnostic-blocking={blocking ? 'true' : undefined}
      data-upid-export-diagnostic-id={diagnostic.id}
      data-upid-export-diagnostic-operation={traceRef?.operationId ?? undefined}
      data-upid-export-diagnostic-path-element={traceRef?.pathElementId ?? undefined}
      data-upid-export-diagnostic-related-clusters={diagnostic.relatedClusterCount}
      data-upid-export-diagnostic-related-segments={diagnostic.relatedSegmentCount}
      data-upid-export-diagnostic-row
      data-upid-export-diagnostic-segment={traceRef?.segmentId ?? undefined}
      data-upid-export-diagnostic-severity={diagnostic.severity}
      key={diagnostic.id}
    >
      {traceRef ? (
        <button
          aria-label={`Select export diagnostic ${diagnostic.code}`}
          className="grid w-full gap-0.5 px-2 py-1 text-left outline-none hover:bg-accent"
          data-upid-export-diagnostic-main
          onBlur={() => onHoverPathElement?.(null)}
          onClick={selectDiagnostic}
          onFocus={() => onHoverPathElement?.(traceRef)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            selectDiagnostic();
          }}
          onMouseEnter={() => onHoverPathElement?.(traceRef)}
          onMouseLeave={() => onHoverPathElement?.(null)}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className="grid w-full gap-0.5 px-2 py-1 text-left" data-upid-export-diagnostic-main-disabled>
          {content}
        </div>
      )}
      {diagnostic.relatedRefs.length > 0 && (
        <div
          className="flex min-w-0 flex-wrap gap-1 border-t border-border/60 px-2 py-1"
          data-upid-export-diagnostic-refs
        >
          {diagnostic.relatedRefs.map((ref, index) => (
            <button
              aria-label={`Select export diagnostic affected geometry ${index + 1}`}
              className="border border-border bg-background/60 px-1 text-left text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground"
              data-upid-export-diagnostic-ref
              data-upid-export-diagnostic-ref-index={index}
              data-upid-export-diagnostic-ref-operation={ref.operationId ?? undefined}
              data-upid-export-diagnostic-ref-path-element={ref.pathElementId ?? undefined}
              data-upid-export-diagnostic-ref-point-role={ref.pointRole ?? undefined}
              data-upid-export-diagnostic-ref-segment={ref.segmentId ?? undefined}
              data-upid-export-diagnostic-ref-travel={ref.travelRole ?? undefined}
              key={`${ref.operationId ?? ''}-${ref.pathElementId ?? ''}-${ref.segmentId ?? ''}-${ref.pointRole ?? ''}-${index}`}
              onClick={() => onSelectPathElement?.(ref)}
              onBlur={() => onHoverPathElement?.(null)}
              onFocus={() => onHoverPathElement?.(ref)}
              onMouseEnter={() => onHoverPathElement?.(ref)}
              onMouseLeave={() => onHoverPathElement?.(null)}
              type="button"
            >
              {index + 1} {ref.segmentId ?? ref.pathElementId ?? ref.operationId ?? 'ref'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatBodyLineRange(operation: Pick<UpidGCodeProgramOperation, 'bodyLineEnd' | 'bodyLineStart'>) {
  return `${operation.bodyLineStart + 1}-${operation.bodyLineEnd + 1}`;
}

function formatNumber(value: number) {
  return value.toFixed(3);
}

function formatManualStart(start: NonNullable<UpidGCodeProgramOperation['manualStart']>) {
  const pointRole = start.pointRole ? ` ${start.pointRole}` : '';
  const split = start.createdSegmentIds.length > 0 ? ` / split ${start.createdSegmentIds.length}` : '';
  return `${start.relation}${pointRole}${split} / source ${start.sourceSegmentId}`;
}

function operationHasManualOverrideDetails(operation: UpidGCodeProgramOperation) {
  return Boolean(operation.manualOrder || operation.manualClassification || operation.manualDirection);
}

function formatManualOverrideDetails(operation: UpidGCodeProgramOperation) {
  return [
    operation.manualOrder ? `order ${operation.manualOrder.orderIndex + 1}` : null,
    operation.manualClassification ? `role ${operation.manualClassification.classification}` : null,
    operation.manualDirection ? `direction ${operation.manualDirection.direction}` : null
  ]
    .filter((part): part is string => Boolean(part))
    .join(' / ');
}

function upidOperationTraceRef(operation: UpidGCodeProgramOperation): EditorPathElementRef | null {
  if (!operation.operationId || !operation.pathElementId) return null;

  return {
    operationId: operation.operationId,
    pathElementId: operation.pathElementId,
    segmentId: null
  };
}

function upidMoveTraceRef(
  move: UpidGCodeProgramOperation['moves'][number]
): EditorPathElementRef | null {
  if (!move.operationId || !move.pathElementId) return null;

  return {
    operationId: move.operationId,
    pathElementId: move.pathElementId,
    segmentId: move.segmentId,
    travelRole:
      move.kind === 'rapid' && move.reason === 'operation-start'
        ? 'rapid-in'
        : move.reason === 'manual-lead-in'
          ? 'lead-in'
          : undefined
  };
}
