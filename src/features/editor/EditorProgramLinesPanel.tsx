import type { MouseEvent } from 'react';
import {
  ArrowDown,
  ArrowRightFromLine,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Pin,
  Redo2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import type {
  GCodeContourGroup,
  GCodeStructuredLine,
  GCodeStructure
} from '@/domain/editor/gcodeStructure';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';

import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';
import type { EditorLineRow } from './editorLineState';

interface EditorProgramLinesPanelProps {
  bodyGroups: GCodeContourGroup[];
  draftText: string;
  guideHighlightTarget: EditorGuideTarget | null;
  hasUnsavedChanges: boolean;
  isGroupExpanded: (groupId: string) => boolean;
  isSaving: boolean;
  lineMode: 'select' | 'edit';
  lineRows: EditorLineRow[];
  pinnedLines: number[];
  program: LoadedEditorProgram | null;
  programLinesOpen: boolean;
  redoAvailable: boolean;
  selectedLines: number[];
  structure: GCodeStructure | null;
  undoAvailable: boolean;
  onClearPins: () => void;
  onClearSelectedLines: () => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteSelectedLines: () => void;
  onExportNormalizedISO: () => void;
  onLineClick: (lineNumber: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineEditCommit: (lineNumber: number, nextText: string) => void;
  onMoveGroup: (groupId: string, direction: -1 | 1) => void;
  onMoveSelectedLines: (direction: -1 | 1) => void;
  onNormalizeDraft: () => void;
  onRedoDraft: () => void;
  onSaveClick: () => void | Promise<void>;
  onSetLineMode: (mode: 'select' | 'edit') => void;
  onSetStartHere: () => void;
  onToggleGroup: (groupId: string) => void;
  onTogglePin: (lineNumber: number) => void;
  onToggleProgramLinesOpen: () => void;
  onHoverLineChange: (lineNumber: number | null) => void;
  onUndoDraft: () => void;
}

export function EditorProgramLinesPanel({
  bodyGroups,
  draftText,
  guideHighlightTarget,
  hasUnsavedChanges,
  isGroupExpanded,
  isSaving,
  lineMode,
  lineRows,
  pinnedLines,
  program,
  programLinesOpen,
  redoAvailable,
  selectedLines,
  structure,
  undoAvailable,
  onClearPins,
  onClearSelectedLines,
  onDeleteGroup,
  onDeleteSelectedLines,
  onExportNormalizedISO,
  onHoverLineChange,
  onLineClick,
  onLineEditCommit,
  onMoveGroup,
  onMoveSelectedLines,
  onNormalizeDraft,
  onRedoDraft,
  onSaveClick,
  onSetLineMode,
  onSetStartHere,
  onToggleGroup,
  onTogglePin,
  onToggleProgramLinesOpen,
  onUndoDraft
}: EditorProgramLinesPanelProps) {
  const selectedLineSet = new Set(selectedLines);
  const pinnedLineSet = new Set(pinnedLines);

  function renderLineRow(row: EditorLineRow) {
    const isSelected = selectedLineSet.has(row.num);
    const isPinned = pinnedLineSet.has(row.num);
    const lineContent =
      lineMode === 'edit' ? (
        <div
          className="grid min-h-7 grid-cols-[44px_62px_minmax(0,1fr)] items-center gap-2 px-2 text-left"
          data-editor-line={row.num}
          onMouseEnter={() => onHoverLineChange(row.num)}
          onMouseLeave={() => onHoverLineChange(null)}
        >
          <span className="text-muted-foreground">{row.num}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{row.section}</span>
          <input
            aria-label={`Edit line ${row.num}`}
            className="h-6 min-w-0 border border-border bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary"
            defaultValue={row.text}
            disabled={isSaving}
            key={`${row.num}-${row.text}`}
            onBlur={(event) => onLineEditCommit(row.num, event.currentTarget.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <button
          aria-pressed={isSelected}
          className={`grid min-h-7 grid-cols-[44px_62px_minmax(0,1fr)] items-center gap-2 px-2 text-left outline-none transition-colors hover:bg-accent ${
            isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-foreground'
          }`}
          data-editor-line={row.num}
          onClick={(event) => onLineClick(row.num, event)}
          onMouseEnter={() => onHoverLineChange(row.num)}
          onMouseLeave={() => onHoverLineChange(null)}
          type="button"
        >
          <span className="text-muted-foreground">{row.num}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{row.section}</span>
          <span className="truncate">{row.text || ' '}</span>
        </button>
      );

    return (
      <div
        className="group grid grid-cols-[minmax(0,1fr)_28px] items-stretch"
        data-editor-line-row={row.num}
        key={row.num}
      >
        {lineContent}
        <button
          aria-label={`Pin line ${row.num}`}
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

  function renderStaticGroup(
    groupId: string,
    title: string,
    section: EditorLineRow['section'],
    lines: GCodeStructuredLine[]
  ) {
    if (lines.length === 0) return null;
    const expanded = isGroupExpanded(groupId);
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div aria-expanded={expanded} data-editor-group={groupId} key={groupId}>
        <div className="flex h-7 items-center justify-between border-y border-border/70 bg-card/70 px-2">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} group ${groupId}`}
            className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase text-muted-foreground outline-none hover:text-foreground"
            data-editor-group-toggle={groupId}
            onClick={() => onToggleGroup(groupId)}
            type="button"
          >
            <ToggleIcon className="size-3 shrink-0" />
            <span>{title}</span>
          </button>
          <span className="font-mono text-[10px] text-muted-foreground">
            {lines.length} {lines.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
        {expanded && lines.map((line) => renderLineRow({ ...line, section }))}
      </div>
    );
  }

  function renderBodyGroup(group: GCodeContourGroup, index: number) {
    const title = group.type === 'loose' ? 'Loose Commands' : group.type.replace('toolpath-', '');
    const expanded = isGroupExpanded(group.id);
    const ToggleIcon = expanded ? ChevronDown : ChevronRight;

    return (
      <div aria-expanded={expanded} data-editor-group={group.id} key={group.id}>
        <div className="flex h-7 items-center justify-between border-y border-border/70 bg-card/70 px-2">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} group ${group.id}`}
            className="flex min-w-0 items-center gap-2 font-mono text-[10px] text-muted-foreground outline-none hover:text-foreground"
            data-editor-group-toggle={group.id}
            onClick={() => onToggleGroup(group.id)}
            type="button"
          >
            <ToggleIcon className="size-3 shrink-0" />
            <span className="uppercase">{group.id}</span>
            <span className="truncate">{title}</span>
          </button>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[10px] text-muted-foreground">
              {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'}
            </span>
            <button
              aria-label={`Move group ${group.id} up`}
              className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              disabled={index === 0 || isSaving}
              onClick={() => onMoveGroup(group.id, -1)}
              type="button"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              aria-label={`Move group ${group.id} down`}
              className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              disabled={index === bodyGroups.length - 1 || isSaving}
              onClick={() => onMoveGroup(group.id, 1)}
              type="button"
            >
              <ArrowDown className="size-3" />
            </button>
            <button
              aria-label={`Delete group ${group.id}`}
              className="flex size-5 items-center justify-center border border-border text-destructive outline-none hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isSaving}
              onClick={() => onDeleteGroup(group.id)}
              type="button"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        </div>
        {expanded && group.lines.map((line) => renderLineRow({ ...line, section: 'body' }))}
      </div>
    );
  }

  return (
    <section
      className={`grid min-h-[220px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/70 ${guideHighlightClass(
        'program-lines',
        guideHighlightTarget
      )}`}
      data-editor-code-section="lines"
      {...guideTargetProps('program-lines', guideHighlightTarget)}
    >
      <div className="grid min-w-0 gap-1 border-b border-border bg-card/80 px-2 py-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h3 className="shrink-0 font-mono text-[11px] font-semibold">Program Lines</h3>
          <button
            aria-label={programLinesOpen ? 'Close G-code drawer' : 'Open G-code drawer'}
            className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent"
            onClick={onToggleProgramLinesOpen}
            title={programLinesOpen ? 'Close drawer' : 'Open drawer'}
            type="button"
          >
            {programLinesOpen ? <X className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
        </div>
        <div
          className="flex min-w-0 items-center justify-start gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-editor-line-toolbar
        >
          {programLinesOpen && (
            <>
              <div
                className={`flex h-5 shrink-0 border border-border ${guideHighlightClass(
                  'line-modes',
                  guideHighlightTarget
                )}`}
                {...guideTargetProps('line-modes', guideHighlightTarget)}
              >
                <button
                  aria-label="Select line mode"
                  aria-pressed={lineMode === 'select'}
                  className={`px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${
                    lineMode === 'select' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => onSetLineMode('select')}
                  type="button"
                >
                  Select
                </button>
                <button
                  aria-label="Edit line mode"
                  aria-pressed={lineMode === 'edit'}
                  className={`border-l border-border px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${
                    lineMode === 'edit' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => onSetLineMode('edit')}
                  type="button"
                >
                  Edit
                </button>
              </div>
              {selectedLines.length > 0 ? (
                <button
                  aria-label={`Clear ${selectedLines.length} selected ${
                    selectedLines.length === 1 ? 'line' : 'lines'
                  }`}
                  className={`h-5 shrink-0 border border-transparent px-1.5 font-mono text-[10px] text-sky-200 outline-none transition hover:border-border hover:bg-accent ${guideHighlightClass(
                    'selection-counter',
                    guideHighlightTarget
                  )}`}
                  {...guideTargetProps('selection-counter', guideHighlightTarget)}
                  onClick={onClearSelectedLines}
                  title="Clear selected lines"
                  type="button"
                >
                  {selectedLines.length} selected
                </button>
              ) : (
                <span
                  className={`shrink-0 font-mono text-[10px] text-muted-foreground ${guideHighlightClass(
                    'selection-counter',
                    guideHighlightTarget
                  )}`}
                  {...guideTargetProps('selection-counter', guideHighlightTarget)}
                >
                  {pinnedLines.length} pinned
                </span>
              )}
              <button
                aria-label="Move selected lines up"
                className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                disabled={selectedLines.length === 0 || Math.min(...selectedLines) <= 1 || isSaving}
                onClick={() => onMoveSelectedLines(-1)}
                title="Move selected lines up"
                type="button"
              >
                <ArrowUp className="size-3" />
              </button>
              <button
                aria-label="Move selected lines down"
                className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                disabled={
                  selectedLines.length === 0 || Math.max(...selectedLines) >= lineRows.length || isSaving
                }
                onClick={() => onMoveSelectedLines(1)}
                title="Move selected lines down"
                type="button"
              >
                <ArrowDown className="size-3" />
              </button>
              <button
                aria-label="Undo"
                className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!undoAvailable || isSaving}
                onClick={onUndoDraft}
                title="Undo"
                type="button"
              >
                <Undo2 className="size-3" />
                <span className="sr-only">Undo</span>
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
                <span className="sr-only">Redo</span>
              </button>
              <button
                className="flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                disabled={selectedLines.length !== 1 || isSaving}
                onClick={onSetStartHere}
                type="button"
              >
                <ArrowRightFromLine className="size-3" />
                Start Here
              </button>
              <button
                aria-label="Clear pinned line highlights"
                className={`flex size-5 shrink-0 items-center justify-center border border-border text-red-400 outline-none transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 ${guideHighlightClass(
                  'clear-pins',
                  guideHighlightTarget
                )}`}
                {...guideTargetProps('clear-pins', guideHighlightTarget)}
                disabled={pinnedLines.length === 0}
                onClick={onClearPins}
                title="Clear pins"
                type="button"
              >
                <Pin className="size-3" />
              </button>
              <button
                className="flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-destructive outline-none transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={selectedLines.length === 0 || isSaving}
                onClick={onDeleteSelectedLines}
                type="button"
              >
                <Trash2 className="size-3" />
                Delete Selected
              </button>
            </>
          )}
        </div>
        <div
          className="flex min-w-0 items-center justify-start gap-1 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-editor-draft-actions
        >
          <Button
            {...guideTargetProps('normalize-draft', guideHighlightTarget)}
            className={`h-5 px-1.5 text-[10px] ${guideHighlightClass(
              'normalize-draft',
              guideHighlightTarget
            )}`}
            disabled={!program || isSaving}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onNormalizeDraft();
            }}
            size="sm"
            variant="outline"
          >
            <RefreshCw />
            Normalize Draft
          </Button>
          <Button
            {...guideTargetProps('export-iso', guideHighlightTarget)}
            className={`h-5 px-1.5 text-[10px] ${guideHighlightClass(
              'export-iso',
              guideHighlightTarget
            )}`}
            disabled={!program || isSaving || draftText.trim() === ''}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onExportNormalizedISO();
            }}
            size="sm"
            variant="outline"
          >
            <Download />
            Export ISO
          </Button>
          <Button
            {...guideTargetProps('save-program', guideHighlightTarget)}
            className={`h-5 px-1.5 text-[10px] ${guideHighlightClass(
              'save-program',
              guideHighlightTarget
            )}`}
            disabled={!program || !hasUnsavedChanges || isSaving}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void onSaveClick();
            }}
            size="sm"
            variant="outline"
          >
            <Save />
            {isSaving ? 'Saving...' : 'Save Program'}
          </Button>
        </div>
      </div>
      {programLinesOpen ? (
        <div className="min-h-0 overflow-auto bg-background/60 font-mono text-[11px]" data-editor-lines-panel>
          {structure && lineRows.length > 0 ? (
            <div>
              {renderStaticGroup('header', 'Header', 'header', structure.header.lines)}
              {bodyGroups.map((group, index) => renderBodyGroup(group, index))}
              {renderStaticGroup('footer', 'Footer', 'footer', structure.footer.lines)}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              No line rows loaded.
            </div>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 items-center justify-center bg-background/60 font-mono text-[10px] text-muted-foreground">
          G-code drawer closed
        </div>
      )}
    </section>
  );
}
