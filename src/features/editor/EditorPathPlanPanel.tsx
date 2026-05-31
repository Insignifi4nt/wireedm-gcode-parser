import type { MouseEvent } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Magnet,
  MousePointer2,
  Pin,
  Redo2,
  RefreshCw,
  Save,
  Undo2
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { GCodeContourGroup } from '@/domain/editor/gcodeStructure';
import type { MagnetizeMode } from '@/domain/path-editor/pathDocumentOperations';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

import type { EditorLineRow } from './editorLineState';

interface EditorPathPlanPanelProps {
  bodyGroups: GCodeContourGroup[];
  hasUnsavedChanges: boolean;
  isGroupExpanded: (groupId: string) => boolean;
  isSaving: boolean;
  lineRows: EditorLineRow[];
  outputPreviewOpen: boolean;
  pathClickMode: 'set-start' | MagnetizeMode | null;
  pathDocument: PathPlanningDocument;
  pinnedLines: number[];
  redoAvailable: boolean;
  selectedLines: number[];
  selectedPathOperationId: string | null;
  undoAvailable: boolean;
  onActivatePathClickMode: (mode: 'set-start' | MagnetizeMode | null) => void;
  onClearPins: () => void;
  onClearSelectedLines: () => void;
  onExportPostedISO: () => void;
  onHoverLineChange: (lineNumber: number | null) => void;
  onLineClick: (lineNumber: number, event: MouseEvent<HTMLButtonElement>) => void;
  onMovePathOperation: (direction: -1 | 1) => void;
  onRedoDraft: () => void;
  onReversePathOperation: () => void;
  onSaveClick: () => void | Promise<void>;
  onSelectPathOperation: (operationId: string) => void;
  onToggleGroup: (groupId: string) => void;
  onToggleOutputPreviewOpen: () => void;
  onTogglePin: (lineNumber: number) => void;
  onUndoDraft: () => void;
}

export function EditorPathPlanPanel({
  bodyGroups,
  hasUnsavedChanges,
  isGroupExpanded,
  isSaving,
  lineRows,
  outputPreviewOpen,
  pathClickMode,
  pathDocument,
  pinnedLines,
  redoAvailable,
  selectedLines,
  selectedPathOperationId,
  undoAvailable,
  onActivatePathClickMode,
  onClearPins,
  onClearSelectedLines,
  onExportPostedISO,
  onHoverLineChange,
  onLineClick,
  onMovePathOperation,
  onRedoDraft,
  onReversePathOperation,
  onSaveClick,
  onSelectPathOperation,
  onToggleGroup,
  onToggleOutputPreviewOpen,
  onTogglePin,
  onUndoDraft
}: EditorPathPlanPanelProps) {
  const selectedLineSet = new Set(selectedLines);
  const pinnedLineSet = new Set(pinnedLines);
  const selectedOperationIndex = pathDocument.plan.operations.findIndex(
    (operation) => operation.id === selectedPathOperationId
  );
  const selectedOperation =
    selectedOperationIndex >= 0 ? pathDocument.plan.operations[selectedOperationIndex] : null;
  const bodyLineRows = lineRows.filter((row) => row.section === 'body');

  function renderOperationRow(operation: PathPlanningDocument['plan']['operations'][number]) {
    const selected = operation.id === selectedPathOperationId;

    return (
      <button
        aria-pressed={selected}
        className={`grid min-h-8 grid-cols-[32px_1fr_58px] items-center gap-2 border-b border-border px-2 text-left font-mono outline-none transition hover:bg-accent last:border-b-0 ${
          selected ? 'bg-sky-500/15 text-sky-100' : 'text-foreground'
        }`}
        data-editor-path-operation-row={operation.id}
        key={operation.id}
        onClick={() => onSelectPathOperation(operation.id)}
        type="button"
      >
        <span className="text-muted-foreground">{operation.orderIndex + 1}</span>
        <span className="min-w-0">
          <span className="block truncate text-[10px] uppercase">{operation.classification}</span>
          <span className="block truncate text-[9px] text-muted-foreground">
            {operation.closed ? 'closed contour' : 'open chain'} / {operation.direction}
          </span>
        </span>
        <span className="text-right text-[9px] text-muted-foreground">
          {operation.metrics.cutLength.toFixed(3)}
        </span>
      </button>
    );
  }

  function renderLineRow(row: EditorLineRow, bodyIndex?: number) {
    const isSelected = selectedLineSet.has(row.num);
    const isPinned = pinnedLineSet.has(row.num);
    const displayNumber = bodyIndex ?? row.num;

    return (
      <div
        className="group grid grid-cols-[minmax(0,1fr)_28px] items-stretch"
        data-editor-posted-body-row={row.num}
        key={row.num}
      >
        <button
          aria-pressed={isSelected}
          className={`grid min-h-7 grid-cols-[44px_minmax(0,1fr)] items-center gap-2 px-2 text-left outline-none transition hover:bg-accent ${
            isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-foreground'
          }`}
          data-editor-line={row.num}
          onClick={(event) => onLineClick(row.num, event)}
          onMouseEnter={() => onHoverLineChange(row.num)}
          onMouseLeave={() => onHoverLineChange(null)}
          type="button"
        >
          <span className="text-muted-foreground">{displayNumber}</span>
          <span className="truncate">{row.text || ' '}</span>
        </button>
        <button
          aria-label={`Pin posted body line ${row.num}`}
          aria-pressed={isPinned}
          className={`flex items-center justify-center border-l border-border text-muted-foreground opacity-0 outline-none transition hover:bg-accent hover:text-red-300 group-hover:opacity-100 ${
            isPinned ? 'text-red-400 opacity-100' : ''
          }`}
          data-editor-pin-line={row.num}
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin(row.num);
          }}
          title="Pin canvas highlight"
          type="button"
        >
          <Pin className="size-3" />
        </button>
      </div>
    );
  }

  function renderBodyGroup(group: GCodeContourGroup) {
    const title = group.type === 'loose' ? 'Loose Motions' : group.type.replace('toolpath-', '');
    const expanded = isGroupExpanded(group.id);
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div aria-expanded={expanded} data-editor-posted-body-group={group.id} key={group.id}>
        <div className="flex h-7 items-center justify-between border-y border-border/70 bg-card/70 px-2">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} posted body group ${group.id}`}
            className="flex min-w-0 items-center gap-2 font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground"
            onClick={() => onToggleGroup(group.id)}
            type="button"
          >
            <ToggleIcon className="size-3 shrink-0" />
            <span className="uppercase">{group.id}</span>
            <span className="truncate">{title}</span>
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">
            {group.lines.length} {group.lines.length === 1 ? 'move' : 'moves'}
          </span>
        </div>
        {expanded &&
          group.lines.map((line) =>
            renderLineRow(
              {
                ...line,
                section: 'body'
              },
              bodyDisplayIndex(line.num)
            )
          )}
      </div>
    );
  }

  function bodyDisplayIndex(lineNumber: number) {
    const index = bodyLineRows.findIndex((row) => row.num === lineNumber);
    return index >= 0 ? index + 1 : lineNumber;
  }

  return (
    <section
      className="grid min-h-[320px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/70"
      data-editor-path-plan-panel
    >
      <div className="grid min-w-0 gap-2 border-b border-border bg-card/80 px-2 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-mono text-[11px] font-semibold">Path Operations</h3>
            <p className="truncate font-mono text-[9px] text-muted-foreground">
              {pathDocument.plan.operations.length} operations / {pathDocument.contours.length} contours
            </p>
          </div>
          {hasUnsavedChanges && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">Unsaved</span>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
            Active Operation
            <select
              aria-label="Path operation"
              className="h-7 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
              onChange={(event) => onSelectPathOperation(event.currentTarget.value)}
              value={selectedPathOperationId ?? ''}
            >
              {pathDocument.plan.operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.orderIndex + 1} {operation.classification}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-1 self-end">
            <button
              aria-label="Move path operation up"
              className="flex size-7 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              disabled={selectedOperationIndex <= 0 || isSaving}
              onClick={() => onMovePathOperation(-1)}
              type="button"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              aria-label="Move path operation down"
              className="flex size-7 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              disabled={
                selectedOperationIndex < 0 ||
                selectedOperationIndex >= pathDocument.plan.operations.length - 1 ||
                isSaving
              }
              onClick={() => onMovePathOperation(1)}
              type="button"
            >
              <ArrowDown className="size-3" />
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <button
            aria-label="Reverse path operation"
            className="flex h-6 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!selectedOperation || isSaving}
            onClick={onReversePathOperation}
            type="button"
          >
            <RefreshCw className="size-3" />
            Reverse
          </button>
          <button
            aria-label="Set path start from canvas"
            aria-pressed={pathClickMode === 'set-start'}
            className={`flex h-6 items-center gap-1 border px-1.5 font-mono text-[10px] outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 ${
              pathClickMode === 'set-start'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground'
            }`}
            disabled={!selectedOperation?.closed || isSaving}
            onClick={() => onActivatePathClickMode(pathClickMode === 'set-start' ? null : 'set-start')}
            type="button"
          >
            <MousePointer2 className="size-3" />
            Set Start
          </button>
          <button
            aria-label="Magnetize latest point perpendicular"
            aria-pressed={pathClickMode === 'perpendicular'}
            className={`flex h-6 items-center gap-1 border px-1.5 font-mono text-[10px] outline-none transition hover:bg-accent ${
              pathClickMode === 'perpendicular'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground'
            }`}
            onClick={() =>
              onActivatePathClickMode(pathClickMode === 'perpendicular' ? null : 'perpendicular')
            }
            type="button"
          >
            <Magnet className="size-3" />
            Perp
          </button>
          <button
            aria-label="Magnetize latest point tangent"
            aria-pressed={pathClickMode === 'tangent'}
            className={`flex h-6 items-center gap-1 border px-1.5 font-mono text-[10px] outline-none transition hover:bg-accent ${
              pathClickMode === 'tangent'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground'
            }`}
            onClick={() => onActivatePathClickMode(pathClickMode === 'tangent' ? null : 'tangent')}
            type="button"
          >
            <Magnet className="size-3" />
            Tangent
          </button>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <button
            aria-label="Undo"
            className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!undoAvailable || isSaving}
            onClick={onUndoDraft}
            title="Undo"
            type="button"
          >
            <Undo2 className="size-3" />
          </button>
          <button
            aria-label="Redo"
            className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!redoAvailable || isSaving}
            onClick={onRedoDraft}
            title="Redo"
            type="button"
          >
            <Redo2 className="size-3" />
          </button>
          <button
            aria-label={`Clear ${selectedLines.length} selected posted body ${
              selectedLines.length === 1 ? 'line' : 'lines'
            }`}
            className="h-5 shrink-0 border border-border px-1.5 font-mono text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={selectedLines.length === 0}
            onClick={onClearSelectedLines}
            type="button"
          >
            {selectedLines.length} selected
          </button>
          <button
            aria-label="Clear pinned posted body highlights"
            className="flex size-5 shrink-0 items-center justify-center border border-border text-red-400 outline-none transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={pinnedLines.length === 0}
            onClick={onClearPins}
            title="Clear pins"
            type="button"
          >
            <Pin className="size-3" />
          </button>
          <Button
            className="h-5 px-1.5 text-[10px]"
            disabled={isSaving || bodyLineRows.length === 0}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onExportPostedISO();
            }}
            size="sm"
            variant="outline"
          >
            <Download />
            Export Posted ISO
          </Button>
          <Button
            className="h-5 px-1.5 text-[10px]"
            disabled={!hasUnsavedChanges || isSaving}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onSaveClick();
            }}
            size="sm"
            variant="outline"
          >
            <Save />
            {isSaving ? 'Saving...' : 'Save Path Plan'}
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className="min-h-0 overflow-auto border-b border-border bg-background/60 font-mono text-[11px]">
          {pathDocument.plan.operations.map(renderOperationRow)}
        </div>
        <section className="max-h-[44vh] min-h-[140px] overflow-hidden bg-background/60">
          <button
            aria-expanded={outputPreviewOpen}
            className="flex h-7 w-full items-center justify-between border-b border-border px-2 font-mono text-[10px] outline-none transition hover:bg-accent"
            onClick={onToggleOutputPreviewOpen}
            type="button"
          >
            <span>Posted Body</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {bodyLineRows.length} {bodyLineRows.length === 1 ? 'move' : 'moves'}
              {outputPreviewOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </span>
          </button>
          {outputPreviewOpen && (
            <div className="max-h-[calc(44vh-1.75rem)] overflow-auto" data-editor-posted-body-preview>
              {bodyGroups.length > 0 ? (
                bodyGroups.map((group) => renderBodyGroup(group))
              ) : bodyLineRows.length > 0 ? (
                bodyLineRows.map((row, index) => renderLineRow(row, index + 1))
              ) : (
                <div className="p-3 font-mono text-[10px] text-muted-foreground">
                  No posted body moves available.
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
