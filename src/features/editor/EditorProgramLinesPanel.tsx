import { Input } from '@/components/ui/input';
import type { MouseEvent } from 'react';
import {
  ArrowDown,
  ArrowRightFromLine,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Pin,
  RefreshCw,
  Trash2
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
  guideHighlightTarget: EditorGuideTarget | null;
  isGroupExpanded: (groupId: string) => boolean;
  isSaving: boolean;
  lineMode: 'select' | 'edit';
  lineRows: EditorLineRow[];
  pinnedLines: number[];
  program: LoadedEditorProgram | null;
  selectedLines: number[];
  structure: GCodeStructure | null;
  onClearPins: () => void;
  onClearSelectedLines: () => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteSelectedLines: () => void;
  onLineClick: (lineNumber: number, event: MouseEvent<HTMLButtonElement>) => void;
  onLineEditCommit: (lineNumber: number, nextText: string) => void;
  onMoveGroup: (groupId: string, direction: -1 | 1) => void;
  onMoveSelectedLines: (direction: -1 | 1) => void;
  onNormalizeDraft: () => void;
  onSetLineMode: (mode: 'select' | 'edit') => void;
  onSetStartHere: () => void;
  onToggleGroup: (groupId: string) => void;
  onTogglePin: (lineNumber: number) => void;
  onHoverLineChange: (lineNumber: number | null) => void;
}

export function EditorProgramLinesPanel({
  bodyGroups,
  guideHighlightTarget,
  isGroupExpanded,
  isSaving,
  lineMode,
  lineRows,
  pinnedLines,
  program,
  selectedLines,
  structure,
  onClearPins,
  onClearSelectedLines,
  onDeleteGroup,
  onDeleteSelectedLines,
  onHoverLineChange,
  onLineClick,
  onLineEditCommit,
  onMoveGroup,
  onMoveSelectedLines,
  onNormalizeDraft,
  onSetLineMode,
  onSetStartHere,
  onToggleGroup,
  onTogglePin
}: EditorProgramLinesPanelProps) {
  const selectedLineSet = new Set(selectedLines);
  const pinnedLineSet = new Set(pinnedLines);

  function renderLineRow(row: EditorLineRow) {
    const isSelected = selectedLineSet.has(row.num);
    const isPinned = pinnedLineSet.has(row.num);
    const lineContent =
      lineMode === 'edit' ? (
        <div
          className="grid min-h-7 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 px-2 text-left"
          data-editor-line={row.num}
          onMouseEnter={() => onHoverLineChange(row.num)}
          onMouseLeave={() => onHoverLineChange(null)}
        >
          <span className="text-muted-foreground">{row.num}</span>
          <span className="sr-only">{row.section}</span>
          <Input density="compact"
            aria-label={`Edit line ${row.num}`}
            className="min-w-0 px-1.5 font-mono text-[11px]"
            defaultValue={row.text}
            disabled={isSaving}
            key={`${row.num}-${row.text}`}
            onBlur={(event) => onLineEditCommit(row.num, event.currentTarget.value)}
            spellCheck={false}
          />
        </div>
      ) : (
        <Button
          aria-pressed={isSelected}
          className={`grid h-auto min-h-7 grid-cols-[32px_minmax(0,1fr)] items-center gap-2 whitespace-normal px-2 text-left font-mono ${
            isSelected ? 'bg-sky-500/15 text-sky-100' : 'text-foreground'
          }`}
          data-editor-line={row.num}
          onClick={(event) => onLineClick(row.num, event)}
          onMouseEnter={() => onHoverLineChange(row.num)}
          onMouseLeave={() => onHoverLineChange(null)}
          type="button"
        >
          <span className="text-muted-foreground">{row.num}</span>
          <span className="sr-only">{row.section}</span>
          <span className="whitespace-pre-wrap break-all">{row.text || ' '}</span>
        </Button>
      );

    return (
      <div
        className="group grid grid-cols-[minmax(0,1fr)_28px] items-stretch"
        data-editor-line-row={row.num}
        key={row.num}
      >
        {lineContent}
        <Button
          aria-label={`Pin line ${row.num}`}
          aria-pressed={isPinned}
          className={`flex items-center justify-center border-l border-border opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 ${
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
        </Button>
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
          <Button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} group ${groupId}`}
            className="flex min-w-0 items-center gap-1.5 font-mono uppercase"
            data-editor-group-toggle={groupId}
            onClick={() => onToggleGroup(groupId)}
            type="button"
          >
            <ToggleIcon className="size-3 shrink-0" />
            <span>{title}</span>
          </Button>
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
          <Button
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} group ${group.id}`}
            className="flex min-w-0 items-center gap-2 font-mono"
            data-editor-group-toggle={group.id}
            onClick={() => onToggleGroup(group.id)}
            type="button"
          >
            <ToggleIcon className="size-3 shrink-0" />
            <span className="uppercase">{group.id}</span>
            <span className="truncate">{title}</span>
          </Button>
          <div className="flex items-center gap-1">
            <span className="mr-1 font-mono text-[10px] text-muted-foreground">
              {group.lines.length} {group.lines.length === 1 ? 'line' : 'lines'}
            </span>
            <Button variant="outline"
              aria-label={`Move group ${group.id} up`}
              className="flex size-5 items-center justify-center"
              disabled={index === 0 || isSaving}
              onClick={() => onMoveGroup(group.id, -1)}
              type="button"
            >
              <ArrowUp className="size-3" />
            </Button>
            <Button variant="outline"
              aria-label={`Move group ${group.id} down`}
              className="flex size-5 items-center justify-center"
              disabled={index === bodyGroups.length - 1 || isSaving}
              onClick={() => onMoveGroup(group.id, 1)}
              type="button"
            >
              <ArrowDown className="size-3" />
            </Button>
            <Button variant="danger"
              aria-label={`Delete group ${group.id}`}
              className="flex size-5 items-center justify-center"
              disabled={isSaving}
              onClick={() => onDeleteGroup(group.id)}
              type="button"
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        </div>
        {expanded && group.lines.map((line) => renderLineRow({ ...line, section: 'body' }))}
      </div>
    );
  }

  return (
    <section
      className={`grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-card/70 ${guideHighlightClass(
        'program-lines',
        guideHighlightTarget
      )}`}
      data-editor-code-section="lines"
      {...guideTargetProps('program-lines', guideHighlightTarget)}
    >
      <div className="grid min-w-0 gap-1 border-b border-border bg-card/80 px-2 py-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h3 className="shrink-0 font-mono text-[11px] font-semibold">Program Lines</h3>

        </div>
        <div
          className="flex min-w-0 flex-wrap items-center justify-start gap-1 whitespace-normal"
          data-editor-line-toolbar
        >
          <>
              <div
                className={`flex h-5 shrink-0 border border-border ${guideHighlightClass(
                  'line-modes',
                  guideHighlightTarget
                )}`}
                {...guideTargetProps('line-modes', guideHighlightTarget)}
              >
                <Button
                  aria-label="Select line mode"
                  aria-pressed={lineMode === 'select'}
                  className={`px-2 font-mono ${
                    lineMode === 'select' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => onSetLineMode('select')}
                  type="button"
                >
                  Select
                </Button>
                <Button
                  aria-label="Edit line mode"
                  aria-pressed={lineMode === 'edit'}
                  className={`border-l border-border px-2 font-mono ${
                    lineMode === 'edit' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => onSetLineMode('edit')}
                  type="button"
                >
                  Edit
                </Button>
              </div>
              {selectedLines.length > 0 ? (
                <Button
                  aria-label={`Clear ${selectedLines.length} selected ${
                    selectedLines.length === 1 ? 'line' : 'lines'
                  }`}
                  className={`h-5 shrink-0 border border-transparent px-1.5 font-mono text-sky-200 ${guideHighlightClass(
                    'selection-counter',
                    guideHighlightTarget
                  )}`}
                  {...guideTargetProps('selection-counter', guideHighlightTarget)}
                  onClick={onClearSelectedLines}
                  title="Clear selected lines"
                  type="button"
                >
                  {selectedLines.length} selected
                </Button>
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
              <Button variant="outline"
                aria-label="Move selected lines up"
                className="flex size-5 shrink-0 items-center justify-center"
                disabled={selectedLines.length === 0 || Math.min(...selectedLines) <= 1 || isSaving}
                onClick={() => onMoveSelectedLines(-1)}
                title="Move selected lines up"
                type="button"
              >
                <ArrowUp className="size-3" />
              </Button>
              <Button variant="outline"
                aria-label="Move selected lines down"
                className="flex size-5 shrink-0 items-center justify-center"
                disabled={
                  selectedLines.length === 0 || Math.max(...selectedLines) >= lineRows.length || isSaving
                }
                onClick={() => onMoveSelectedLines(1)}
                title="Move selected lines down"
                type="button"
              >
                <ArrowDown className="size-3" />
              </Button>
              <Button variant="outline"
                className="flex h-5 shrink-0 items-center gap-1 px-1.5 font-mono"
                disabled={selectedLines.length !== 1 || isSaving}
                onClick={onSetStartHere}
                type="button"
              >
                <ArrowRightFromLine className="size-3" />
                Start Here
              </Button>
              <Button
                aria-label="Clear pinned line highlights"
                className={`flex size-5 shrink-0 items-center justify-center border border-border text-red-400 ${guideHighlightClass(
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
              </Button>
              <Button variant="danger"
                className="flex h-5 shrink-0 items-center gap-1 px-1.5 font-mono"
                disabled={selectedLines.length === 0 || isSaving}
                onClick={onDeleteSelectedLines}
                type="button"
              >
                <Trash2 className="size-3" />
                Delete Selected
              </Button>
          </>
        </div>
        <div
          className="flex min-w-0 items-center justify-start gap-1 flex-wrap"
          data-editor-draft-actions
        >
          <Button
            {...guideTargetProps('normalize-draft', guideHighlightTarget)}
            className={`h-5 px-1.5 ${guideHighlightClass(
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
        </div>
      </div>
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
    </section>
  );
}
