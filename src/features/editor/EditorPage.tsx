import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRightFromLine,
  Download,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileUp,
  Magnet,
  Pin,
  Redo2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  X
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { parseGCodeProgram } from '@/domain/editor/gcodeParser';
import {
  deleteBodyGroup,
  moveBodyGroup,
  moveSelectedLines,
  setStartAtLine
} from '@/domain/editor/gcodeLineOperations';
import {
  organizeGCodeStructure,
  type GCodeContourGroup,
  type GCodeStructuredLine,
  type GCodeStructure
} from '@/domain/editor/gcodeStructure';
import { normalizeToISO } from '@/domain/editor/isoNormalizer';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import {
  exportMeasurementPointsAsCsv,
  exportMeasurementPointsAsGCode,
  exportMeasurementPointsAsISO,
  insertMeasurementPointsIntoText,
  type MeasurementPoint
} from '@/domain/editor/measurementPoints';

import { EditorGuideDialog } from './EditorGuideDialog';
import { EditorPreview } from './EditorPreview';
import type { EditorGuideLanguage, EditorGuideTarget } from './editorGuideContent';

const GUIDE_LANGUAGE_STORAGE_KEY = 'wireedm.guideLanguage';
const LINE_MODE_STORAGE_KEY = 'gcodeDrawerMode';

interface EditorPageProps {
  program: LoadedEditorProgram | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  saveStatus: 'idle' | 'saving' | 'error';
  saveErrorMessage: string | null;
  onBackToDashboard: () => void;
  onDownloadEditorFile: (fileName: string, text: string) => void;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onSaveProgramText: (text: string) => void | Promise<void>;
  onStatusMessage?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

function handleEditorDragOver(event: DragEvent<HTMLDivElement>) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
}

export function EditorPage({
  program,
  importStatus,
  importErrorMessage,
  saveStatus,
  saveErrorMessage,
  onBackToDashboard,
  onDownloadEditorFile,
  onImportProgramFile,
  onSaveProgramText,
  onStatusMessage
}: EditorPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draftText, setDraftText] = useState(program?.text ?? '');
  const [hoveredLine, setHoveredLine] = useState<number | null>(null);
  const lastClickedLineRef = useRef<number | null>(null);
  const [pinnedLines, setPinnedLines] = useState<number[]>([]);
  const [measurementPoints, setMeasurementPoints] = useState<MeasurementPoint[]>([]);
  const [previewCursorPoint, setPreviewCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false);
  const [guideHighlightTarget, setGuideHighlightTarget] = useState<EditorGuideTarget | null>(null);
  const [guideLanguage, setGuideLanguage] = useState<EditorGuideLanguage>(readStoredGuideLanguage);
  const [guideOpen, setGuideOpen] = useState(false);
  const [programLinesOpen, setProgramLinesOpen] = useState(true);
  const [pointXDraft, setPointXDraft] = useState('');
  const [pointYDraft, setPointYDraft] = useState('');
  const [lineMode, setLineMode] = useState<'select' | 'edit'>(readStoredLineMode);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const isImporting = importStatus === 'importing';
  const isSaving = saveStatus === 'saving';
  const draftProgram = useMemo<LoadedEditorProgram | null>(
    () =>
      program
        ? {
            filePath: program.filePath,
            text: draftText,
            parseResult: parseGCodeProgram(draftText)
          }
        : null,
    [draftText, program]
  );
  const pathCount = draftProgram?.parseResult.path.length ?? 0;
  const rapidMoveCount = draftProgram?.parseResult.path.filter((point) => point.type === 'rapid').length ?? 0;
  const cuttingMoveCount = draftProgram?.parseResult.path.filter((point) => point.type === 'cut').length ?? 0;
  const arcMoveCount = draftProgram?.parseResult.path.filter((point) => point.type === 'arc').length ?? 0;
  const boundsText = draftProgram && pathCount > 0 ? formatBounds(draftProgram.parseResult.bounds) : '-';
  const editorFileName = program?.filePath.split('/').pop() ?? '-';
  const hasUnsavedChanges = Boolean(program && draftText !== program.text);
  const structure = useMemo(
    () => (draftProgram ? organizeGCodeStructure(draftProgram.text.split(/\r?\n/)) : null),
    [draftProgram]
  );
  const lineRows = useMemo(() => (structure ? flattenStructureLines(structure) : []), [structure]);
  const bodyGroups = structure?.body.contours ?? [];
  const selectedLineSet = useMemo(() => new Set(selectedLines), [selectedLines]);
  const pinnedLineSet = useMemo(() => new Set(pinnedLines), [pinnedLines]);

  function setLastClickedLine(lineNumber: number | null) {
    lastClickedLineRef.current = lineNumber;
  }

  useEffect(() => {
    if (!guideHighlightTarget) return;

    const frame = globalThis.requestAnimationFrame?.(() => {
      const target = document.querySelector(`[data-guide-target="${guideHighlightTarget}"]`);
      if (target instanceof HTMLElement) {
        target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'smooth' });
      }
    });
    const timeout = window.setTimeout(() => setGuideHighlightTarget(null), 3000);

    return () => {
      if (typeof frame === 'number') globalThis.cancelAnimationFrame?.(frame);
      window.clearTimeout(timeout);
    };
  }, [guideHighlightTarget]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setHoveredLine(null);
        setLastClickedLine(null);
        setSelectedLines([]);
        return;
      }

      const target = event.target;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) return;

      const isUndo = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
      const isRedo =
        (event.ctrlKey || event.metaKey) &&
        (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey));
      const isClearPoints =
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'c' &&
        !event.shiftKey &&
        !event.altKey;

      if (isUndo) {
        event.preventDefault();
        handleUndoDraft();
      } else if (isRedo) {
        event.preventDefault();
        handleRedoDraft();
      } else if (isClearPoints && measurementPoints.length > 0) {
        event.preventDefault();
        setMeasurementPoints([]);
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedLines.length > 0) {
        event.preventDefault();
        handleDeleteSelectedLines();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draftText, isSaving, measurementPoints.length, program, redoStack, selectedLines, undoStack]);

  async function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    await onImportProgramFile(file);
    input.value = '';
  }

  async function handleEditorDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || isImporting) return;

    await onImportProgramFile(file);
  }

  async function handleSaveClick() {
    if (!program || !hasUnsavedChanges || isSaving) return;
    await onSaveProgramText(draftText);
  }

  function handleNormalizeDraft() {
    if (!program || isSaving) return;
    replaceDraftText(normalizeToISO(draftText, { crlf: false }));
  }

  function handleExportNormalizedISO() {
    if (!program || isSaving || draftText.trim() === '') return;

    const dateStamp = new Date().toISOString().slice(0, 10);
    onDownloadEditorFile(`normalized-${dateStamp}.iso`, normalizeToISO(draftText));
  }

  function handleLineClick(lineNumber: number, event: MouseEvent<HTMLButtonElement>) {
    if (event.shiftKey && lastClickedLineRef.current !== null) {
      setSelectedLines(selectLineRange(lineRows, lastClickedLineRef.current, lineNumber));
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedLines((current) => toggleLine(current, lineNumber));
    } else {
      setSelectedLines([lineNumber]);
    }

    setLastClickedLine(lineNumber);
  }

  function handleTogglePin(lineNumber: number) {
    setPinnedLines((current) => toggleLine(current, lineNumber));
  }

  function isGroupExpanded(groupId: string) {
    return expandedGroups[groupId] ?? readStoredGroupExpanded(groupId);
  }

  function handleToggleGroup(groupId: string) {
    const nextExpanded = !isGroupExpanded(groupId);
    setExpandedGroups((current) => ({ ...current, [groupId]: nextExpanded }));
    writeStoredGroupExpanded(groupId, nextExpanded);
  }

  function handleDeleteSelectedLines() {
    if (!program || selectedLines.length === 0 || isSaving) return;
    if (selectedLines.length > 3 && !confirmBulkLineDelete(selectedLines.length)) return;

    const linesToDelete = new Set(selectedLines);
    const nextText = draftText
      .split(/\r?\n/)
      .filter((_, index) => !linesToDelete.has(index + 1))
      .join('\n');

    replaceDraftText(nextText);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines((current) => current.filter((line) => !linesToDelete.has(line)));
    setSelectedLines([]);
  }

  function handleMoveSelectedLines(direction: -1 | 1) {
    if (!program || selectedLines.length === 0 || isSaving) return;

    const result = moveSelectedLines(draftText, selectedLines, direction);
    if (!result) return;

    replaceDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.movedLineNumbers);
  }

  function handleSetLineMode(mode: 'select' | 'edit') {
    setLineMode(mode);
    writeStoredLineMode(mode);
    setHoveredLine(null);
    if (mode === 'edit') {
      setLastClickedLine(null);
      setSelectedLines([]);
    }
  }

  function handleLineEditCommit(lineNumber: number, nextText: string) {
    if (!program || isSaving) return;

    const sanitizedText = sanitizeLineText(nextText);
    const lines = draftText.split(/\r?\n/);
    if (lineNumber < 1 || lineNumber > lines.length || lines[lineNumber - 1] === sanitizedText) return;

    lines[lineNumber - 1] = sanitizedText;
    replaceDraftText(lines.join('\n'));
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines([]);
  }

  function handleMoveGroup(groupId: string, direction: -1 | 1) {
    if (!structure || !program || isSaving) return;

    const result = moveBodyGroup(draftText, structure, groupId, direction);
    if (!result) return;

    replaceDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.movedLineNumbers);
  }

  function handleDeleteGroup(groupId: string) {
    if (!structure || !program || isSaving) return;

    const group = structure.body.contours?.find((candidate) => candidate.id === groupId);
    if (group && group.lines.length > 3 && !confirmGroupDelete(group.id, group.lines.length)) return;

    const result = deleteBodyGroup(draftText, structure, groupId);
    if (!result) return;

    const deletedLines = new Set(result.deletedLineNumbers);
    replaceDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines((current) => current.filter((line) => !deletedLines.has(line)));
    setSelectedLines([]);
  }

  function handleSetStartHere() {
    if (!program || isSaving) return;
    if (selectedLines.length !== 1) {
      onStatusMessage?.('Select exactly one motion line in the body to set as start.', 'warning');
      return;
    }

    const result = setStartAtLine(draftText, selectedLines[0]);
    if (!result) {
      onStatusMessage?.(
        'Invalid selection: choose a motion line (G0/G1/G2/G3) within the body.',
        'warning'
      );
      return;
    }

    replaceDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(result.newStartLine);
    setPinnedLines([]);
    setSelectedLines([result.newStartLine]);
  }

  function handleGuideLanguageChange(language: EditorGuideLanguage) {
    setGuideLanguage(language);
    try {
      globalThis.localStorage.setItem(GUIDE_LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Local storage can be unavailable in stricter browser contexts.
    }
  }

  function handleGuideHighlight(target: EditorGuideTarget) {
    setGuideOpen(false);
    setGuideHighlightTarget(target);
  }

  function handleAddMeasurementPoint() {
    if (pointXDraft.trim() === '' || pointYDraft.trim() === '') return;

    const x = Number(pointXDraft);
    const y = Number(pointYDraft);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    addMeasurementPoint(x, y);
    setPointXDraft('');
    setPointYDraft('');
  }

  function addMeasurementPoint(x: number, y: number) {
    setMeasurementPoints((current) => [
      ...current,
      {
        id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${current.length}`,
        x,
        y
      }
    ]);
  }

  function guideTargetProps(target: EditorGuideTarget) {
    return {
      'data-guide-highlighted': guideHighlightTarget === target ? 'true' : undefined,
      'data-guide-target': target
    };
  }

  function guideHighlightClass(target: EditorGuideTarget) {
    return guideHighlightTarget === target
      ? 'relative z-40 ring-2 ring-red-400 ring-offset-2 ring-offset-background'
      : '';
  }

  function handleInsertMeasurementPoints() {
    if (!program || measurementPoints.length === 0 || isSaving) return;

    const result = insertMeasurementPointsIntoText(draftText, measurementPoints, {
      insertAfterLine: selectedLines.length > 0 ? Math.min(...selectedLines) : undefined
    });
    replaceDraftText(result.text);
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines(result.insertedLineNumbers);
  }

  function handleExportMeasurementPoints(format: 'csv' | 'gcode' | 'iso') {
    if (measurementPoints.length === 0) return;

    const dateStamp = new Date().toISOString().slice(0, 10);
    if (format === 'csv') {
      onDownloadEditorFile(
        `measurement-points-${dateStamp}.csv`,
        exportMeasurementPointsAsCsv(measurementPoints)
      );
      return;
    }

    if (format === 'iso') {
      onDownloadEditorFile(
        `measurement-points-${dateStamp}.iso`,
        exportMeasurementPointsAsISO(measurementPoints)
      );
      return;
    }

    onDownloadEditorFile(
      `measurement-points-${dateStamp}.gcode`,
      exportMeasurementPointsAsGCode(measurementPoints)
    );
  }

  function replaceDraftText(nextText: string) {
    if (nextText === draftText) return;
    setUndoStack((current) => [...current, draftText]);
    setRedoStack([]);
    setDraftText(nextText);
  }

  function handleUndoDraft() {
    const previousText = undoStack.at(-1);
    if (previousText === undefined) return;

    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [draftText, ...current]);
    setDraftText(previousText);
    clearTransientLineState();
  }

  function handleRedoDraft() {
    const nextText = redoStack[0];
    if (nextText === undefined) return;

    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [...current, draftText]);
    setDraftText(nextText);
    clearTransientLineState();
  }

  function clearTransientLineState() {
    setHoveredLine(null);
    setLastClickedLine(null);
    setPinnedLines([]);
    setSelectedLines([]);
  }

  function clearSelectedLines() {
    setHoveredLine(null);
    setLastClickedLine(null);
    setSelectedLines([]);
  }

  function renderLineRow(row: EditorLineRow) {
    const isSelected = selectedLineSet.has(row.num);
    const isPinned = pinnedLineSet.has(row.num);
    const lineContent =
      lineMode === 'edit' ? (
        <div
          className="grid min-h-7 grid-cols-[44px_62px_minmax(0,1fr)] items-center gap-2 px-2 text-left"
          data-editor-line={row.num}
          onMouseEnter={() => setHoveredLine(row.num)}
          onMouseLeave={() => setHoveredLine(null)}
        >
          <span className="text-muted-foreground">{row.num}</span>
          <span className="text-[10px] uppercase text-muted-foreground">{row.section}</span>
          <input
            aria-label={`Edit line ${row.num}`}
            className="h-6 min-w-0 border border-border bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-primary"
            defaultValue={row.text}
            disabled={isSaving}
            key={`${row.num}-${row.text}`}
            onBlur={(event) => handleLineEditCommit(row.num, event.currentTarget.value)}
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
          onClick={(event) => handleLineClick(row.num, event)}
          onMouseEnter={() => setHoveredLine(row.num)}
          onMouseLeave={() => setHoveredLine(null)}
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
            handleTogglePin(row.num);
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
            onClick={() => handleToggleGroup(groupId)}
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
            onClick={() => handleToggleGroup(group.id)}
            type="button"
          >
            <ToggleIcon className="size-3 shrink-0" />
            <span className="uppercase">
              {group.id}
            </span>
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
              onClick={() => handleMoveGroup(group.id, -1)}
              type="button"
            >
              <ArrowUp className="size-3" />
            </button>
            <button
              aria-label={`Move group ${group.id} down`}
              className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
              disabled={index === bodyGroups.length - 1 || isSaving}
              onClick={() => handleMoveGroup(group.id, 1)}
              type="button"
            >
              <ArrowDown className="size-3" />
            </button>
            <button
              aria-label={`Delete group ${group.id}`}
              className="flex size-5 items-center justify-center border border-border text-destructive outline-none hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={isSaving}
              onClick={() => handleDeleteGroup(group.id)}
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

  function renderDraftActionButtons() {
    return (
      <>
        <Button
          {...guideTargetProps('normalize-draft')}
          className={`h-5 px-1.5 text-[10px] ${guideHighlightClass('normalize-draft')}`}
          disabled={!program || isSaving}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleNormalizeDraft();
          }}
          size="sm"
          variant="outline"
        >
          <RefreshCw />
          Normalize Draft
        </Button>
        <Button
          {...guideTargetProps('export-iso')}
          className={`h-5 px-1.5 text-[10px] ${guideHighlightClass('export-iso')}`}
          disabled={!program || isSaving || draftText.trim() === ''}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleExportNormalizedISO();
          }}
          size="sm"
          variant="outline"
        >
          <Download />
          Export ISO
        </Button>
        <Button
          {...guideTargetProps('save-program')}
          className={`h-5 px-1.5 text-[10px] ${guideHighlightClass('save-program')}`}
          disabled={!program || !hasUnsavedChanges || isSaving}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void handleSaveClick();
          }}
          size="sm"
          variant="outline"
        >
          <Save />
          {isSaving ? 'Saving...' : 'Save Program'}
        </Button>
      </>
    );
  }

  function renderProgramLinesPanel() {
    return (
      <section
        className={`grid min-h-[220px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-border bg-card/70 ${guideHighlightClass('program-lines')}`}
        data-editor-code-section="lines"
        {...guideTargetProps('program-lines')}
      >
        <div className="grid min-w-0 gap-1 border-b border-border bg-card/80 px-2 py-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 className="shrink-0 font-mono text-[11px] font-semibold">Program Lines</h3>
            <button
              aria-label={programLinesOpen ? 'Close G-code drawer' : 'Open G-code drawer'}
              className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent"
              onClick={() => setProgramLinesOpen((current) => !current)}
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
                  className={`flex h-5 shrink-0 border border-border ${guideHighlightClass('line-modes')}`}
                  {...guideTargetProps('line-modes')}
                >
                  <button
                    aria-label="Select line mode"
                    aria-pressed={lineMode === 'select'}
                    className={`px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${
                      lineMode === 'select' ? 'bg-accent text-foreground' : 'text-muted-foreground'
                    }`}
                    onClick={() => handleSetLineMode('select')}
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
                    onClick={() => handleSetLineMode('edit')}
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
                    className={`h-5 shrink-0 border border-transparent px-1.5 font-mono text-[10px] text-sky-200 outline-none transition hover:border-border hover:bg-accent ${guideHighlightClass('selection-counter')}`}
                    {...guideTargetProps('selection-counter')}
                    onClick={clearSelectedLines}
                    title="Clear selected lines"
                    type="button"
                  >
                    {selectedLines.length} selected
                  </button>
                ) : (
                  <span
                    className={`shrink-0 font-mono text-[10px] text-muted-foreground ${guideHighlightClass('selection-counter')}`}
                    {...guideTargetProps('selection-counter')}
                  >
                    {pinnedLines.length} pinned
                  </span>
                )}
                <button
                  aria-label="Move selected lines up"
                  className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={selectedLines.length === 0 || Math.min(...selectedLines) <= 1 || isSaving}
                  onClick={() => handleMoveSelectedLines(-1)}
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
                  onClick={() => handleMoveSelectedLines(1)}
                  title="Move selected lines down"
                  type="button"
                >
                  <ArrowDown className="size-3" />
                </button>
                <button
                  aria-label="Undo"
                  className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={undoStack.length === 0 || isSaving}
                  onClick={handleUndoDraft}
                  title="Undo"
                  type="button"
                >
                  <Undo2 className="size-3" />
                  <span className="sr-only">Undo</span>
                </button>
                <button
                  aria-label="Redo"
                  className="flex size-5 shrink-0 items-center justify-center border border-border text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={redoStack.length === 0 || isSaving}
                  onClick={handleRedoDraft}
                  title="Redo"
                  type="button"
                >
                  <Redo2 className="size-3" />
                  <span className="sr-only">Redo</span>
                </button>
                <button
                  className="flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-muted-foreground outline-none transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={selectedLines.length !== 1 || isSaving}
                  onClick={handleSetStartHere}
                  type="button"
                >
                  <ArrowRightFromLine className="size-3" />
                  Start Here
                </button>
                <button
                  aria-label="Clear pinned line highlights"
                  className={`flex size-5 shrink-0 items-center justify-center border border-border text-red-400 outline-none transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40 ${guideHighlightClass('clear-pins')}`}
                  {...guideTargetProps('clear-pins')}
                  disabled={pinnedLines.length === 0}
                  onClick={() => setPinnedLines([])}
                  title="Clear pins"
                  type="button"
                >
                  <Pin className="size-3" />
                </button>
                <button
                  className="flex h-5 shrink-0 items-center gap-1 border border-border px-1.5 font-mono text-[10px] text-destructive outline-none transition hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={selectedLines.length === 0 || isSaving}
                  onClick={handleDeleteSelectedLines}
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
            {renderDraftActionButtons()}
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

  function renderProgramTextPanel() {
    return (
      <details
        className="overflow-hidden border border-border bg-card/70"
        data-editor-code-section="text"
      >
        <summary className="flex h-7 cursor-pointer select-none items-center justify-between gap-2 border-b border-border bg-card/80 px-2 font-mono outline-none hover:bg-accent/40 [&::-webkit-details-marker]:hidden">
          <h3 className="shrink-0 text-[11px] font-semibold">Program Text</h3>
          {hasUnsavedChanges && (
            <span className="shrink-0 text-[10px] text-muted-foreground">Unsaved</span>
          )}
        </summary>
        <div className="grid h-[240px] min-h-0 border-t border-border">
          <textarea
            aria-label="Program editor"
            className="min-h-0 resize-none overflow-auto border-0 bg-background/70 p-2 font-mono text-[10px] leading-4 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-70"
            disabled={!program || isSaving}
            onChange={(event) => setDraftText(event.currentTarget.value)}
            placeholder="No program loaded."
            spellCheck={false}
            value={draftText}
          />
        </div>
      </details>
    );
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-editor-drop-zone="true"
      data-editor-layout="canvas-first"
      onDragOver={handleEditorDragOver}
      onDrop={handleEditorDrop}
    >
      <EditorGuideDialog
        language={guideLanguage}
        onClose={() => setGuideOpen(false)}
        onHighlight={handleGuideHighlight}
        onLanguageChange={handleGuideLanguageChange}
        open={guideOpen}
      />
      <section className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border bg-background/90 px-2 py-1">
        <div className="min-w-[220px] flex-1">
          <p className="font-mono text-[9px] uppercase text-muted-foreground">Editor</p>
          <h2 className="truncate font-mono text-[12px] font-semibold" title={program?.filePath}>
            {program?.filePath ?? 'Import or open a G-code program'}
          </h2>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
          <input
            ref={fileInputRef}
            accept=".gcode,.nc,.iso,.txt,text/plain"
            aria-label="G-code program file"
            className="hidden"
            disabled={isImporting}
            onChange={handleFileInputChange}
            type="file"
          />
          <Button
            {...guideTargetProps('import-program')}
            className={`h-7 px-2 text-[10px] ${guideHighlightClass('import-program')}`}
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            size="sm"
            variant="default"
          >
            <FileUp />
            {isImporting ? 'Importing...' : 'Import Program'}
          </Button>
          <Button
            aria-label="Open usage guide"
            className="h-7 px-2 text-[10px]"
            onClick={() => setGuideOpen(true)}
            size="sm"
            variant="outline"
          >
            <CircleHelp />
            Controls
          </Button>
          <Button
            className="h-7 px-2 text-[10px]"
            onClick={onBackToDashboard}
            size="sm"
            variant="outline"
          >
            <ArrowLeft />
            Dashboard
          </Button>
        </div>
        {(importErrorMessage || saveErrorMessage) && (
          <div className="basis-full space-y-1">
            {importErrorMessage && (
              <p className="border border-destructive bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive">
                {importErrorMessage}
              </p>
            )}
            {saveErrorMessage && (
              <p className="border border-destructive bg-destructive/10 px-2 py-1 font-mono text-[10px] text-destructive">
                {saveErrorMessage}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(360px,1fr)_minmax(320px,45vh)] gap-2 overflow-hidden p-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[minmax(0,1fr)]">
        <section
          className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-[#0e1317]"
          data-editor-canvas-panel
        >
          <div className="flex h-7 shrink-0 items-center justify-between border-b border-border bg-card/70 px-2">
            <h3 className="font-mono text-[11px] font-semibold">Preview</h3>
            <span className="font-mono text-[9px] text-muted-foreground">
              {pathCount} {pathCount === 1 ? 'path item' : 'path items'}
            </span>
          </div>
          <div
            className={`min-h-0 flex-1 p-1.5 ${guideHighlightClass('preview')}`}
            {...guideTargetProps('preview')}
          >
            <EditorPreview
              hoveredLine={hoveredLine}
              keyboardShortcutsEnabled={!guideOpen}
              measurementPoints={measurementPoints}
              onCursorPointChange={setPreviewCursorPoint}
              onPreviewPointClick={(point) => addMeasurementPoint(point.x, point.y)}
              pinnedLines={pinnedLines}
              program={draftProgram}
              snapToGrid={gridSnapEnabled}
              selectedLines={selectedLines}
            />
          </div>
        </section>

        <aside
          className="grid min-h-0 overflow-hidden border border-border bg-card/95 font-mono text-[10px] lg:grid-rows-[minmax(0,1fr)_auto]"
          data-editor-inspector-panel
        >
          <div
            className="grid min-h-0 gap-2 overflow-hidden p-2 lg:grid-rows-[minmax(260px,1fr)_auto]"
            data-editor-side-code-panel
          >
            {renderProgramLinesPanel()}
            {renderProgramTextPanel()}
          </div>
          <div
            className="max-h-[42vh] overflow-y-auto border-t border-border p-2"
            data-editor-inspector-summary
          >
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold">Position</h3>
              <button
                aria-label="Toggle preview grid snap"
                aria-pressed={gridSnapEnabled}
                className={`inline-flex h-6 items-center gap-1 border px-2 font-mono text-[10px] outline-none transition hover:bg-accent ${
                  gridSnapEnabled ? 'border-primary text-primary' : 'border-border text-muted-foreground'
                } ${guideHighlightClass('grid-snap')}`}
                data-editor-grid-snap
                {...guideTargetProps('grid-snap')}
                onClick={() => setGridSnapEnabled((current) => !current)}
                title="Snap cursor and measurement clicks to the 5 mm preview grid"
                type="button"
              >
                <Magnet className="size-3" />
                {gridSnapEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
              <dt className="text-muted-foreground">Mouse X</dt>
              <dd data-editor-cursor="x">{formatCursorCoordinate(previewCursorPoint?.x)}</dd>
              <dt className="text-muted-foreground">Mouse Y</dt>
              <dd data-editor-cursor="y">{formatCursorCoordinate(previewCursorPoint?.y)}</dd>
            </dl>
          </section>

          <details className="mt-3 border-t border-border pt-3" data-editor-stats-section>
            <summary className="cursor-pointer select-none font-mono text-[11px] font-semibold outline-none hover:text-foreground">
              Statistics
            </summary>
            <section className="mt-2">
              <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Program</h3>
              {draftProgram ? (
                <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
                  <dt className="text-muted-foreground">Path</dt>
                  <dd>
                    <span data-editor-stat="total-moves">{pathCount}</span>{' '}
                    {pathCount === 1 ? 'path item' : 'path items'}
                  </dd>
                  <dt className="text-muted-foreground">Rapid</dt>
                  <dd data-editor-stat="rapid-moves">{rapidMoveCount}</dd>
                  <dt className="text-muted-foreground">Cutting</dt>
                  <dd data-editor-stat="cutting-moves">{cuttingMoveCount}</dd>
                  <dt className="text-muted-foreground">Arcs</dt>
                  <dd data-editor-stat="arc-moves">{arcMoveCount}</dd>
                  <dt className="text-muted-foreground">Bounds</dt>
                  <dd data-editor-stat="bounds">{boundsText}</dd>
                  <dt className="text-muted-foreground">File</dt>
                  <dd className="truncate" data-editor-stat="file" title={program?.filePath}>
                    {editorFileName}
                  </dd>
                  <dt className="text-muted-foreground">Lines</dt>
                  <dd>{draftProgram.parseResult.stats.totalLines}</dd>
                  <dt className="text-muted-foreground">Linear</dt>
                  <dd>{draftProgram.parseResult.stats.linearMoves}</dd>
                  <dt className="text-muted-foreground">Warnings</dt>
                  <dd>{draftProgram.parseResult.warnings.length}</dd>
                  <dt className="text-muted-foreground">Errors</dt>
                  <dd>{draftProgram.parseResult.errors.length}</dd>
                </dl>
              ) : (
                <p className="border border-border bg-background/50 p-2 text-muted-foreground">
                  Import `.gcode`, `.nc`, `.iso`, or `.txt` to preview and edit it.
                </p>
              )}
            </section>

            {structure && (
              <section className="mt-3 border-t border-border pt-3">
                <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Structure</h3>
                <dl className="grid grid-cols-[78px_minmax(0,1fr)] gap-y-1.5">
                  <dt className="text-muted-foreground">Header</dt>
                  <dd data-editor-structure="header">{structure.header.lines.length}</dd>
                  <dt className="text-muted-foreground">Body</dt>
                  <dd data-editor-structure="body">{structure.body.lines.length}</dd>
                  <dt className="text-muted-foreground">Footer</dt>
                  <dd data-editor-structure="footer">{structure.footer.lines.length}</dd>
                  <dt className="text-muted-foreground">Groups</dt>
                  <dd data-editor-structure="groups">{structure.body.contours?.length ?? 0}</dd>
                </dl>
              </section>
            )}

            {draftProgram &&
              (draftProgram.parseResult.errors.length > 0 ||
                draftProgram.parseResult.warnings.length > 0) && (
                <section className="mt-3 border-t border-border pt-3">
                  <h3 className="mb-2 text-[10px] font-semibold uppercase text-muted-foreground">Parse Issues</h3>
                  <div className="max-h-32 overflow-auto border border-border bg-background/50">
                    {[...draftProgram.parseResult.errors, ...draftProgram.parseResult.warnings].map(
                      (issue, index) => (
                        <div
                          className="border-b border-border px-2 py-1.5 last:border-b-0"
                          data-editor-parse-issue={index}
                          key={`${issue.type}-${issue.line}-${issue.message}-${index}`}
                        >
                          <div className="flex items-center justify-between gap-2 text-[9px] uppercase">
                            <span
                              className={issue.type === 'error' ? 'text-destructive' : 'text-amber-300'}
                            >
                              {issue.type}
                            </span>
                            <span className="text-muted-foreground">
                              {issue.line > 0 ? `Line ${issue.line}` : 'Program'}
                            </span>
                          </div>
                          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                            {issue.message}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                </section>
              )}
          </details>

          <section
            className={`mt-3 border-t border-border pt-3 ${guideHighlightClass('measurement-points')}`}
            {...guideTargetProps('measurement-points')}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold">Measurement</h3>
              <span className="text-[10px] text-muted-foreground">{measurementPoints.length}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
                X
                <input
                  aria-label="Measurement point X"
                  className="h-6 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
                  inputMode="decimal"
                  onChange={(event) => setPointXDraft(event.currentTarget.value)}
                  placeholder="0.000"
                  type="number"
                  value={pointXDraft}
                />
              </label>
              <label className="grid gap-1 text-[9px] uppercase text-muted-foreground">
                Y
                <input
                  aria-label="Measurement point Y"
                  className="h-6 border border-border bg-background px-1.5 font-mono text-[10px] text-foreground outline-none focus:border-primary"
                  inputMode="decimal"
                  onChange={(event) => setPointYDraft(event.currentTarget.value)}
                  placeholder="0.000"
                  type="number"
                  value={pointYDraft}
                />
              </label>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <Button className="h-6 px-2 text-[10px]" onClick={handleAddMeasurementPoint} size="sm" type="button" variant="outline">
                Add Point
              </Button>
              <Button
                className="h-6 px-2 text-[10px]"
                disabled={measurementPoints.length === 0}
                onClick={() => setMeasurementPoints([])}
                size="sm"
                type="button"
                variant="outline"
              >
                Clear Points
              </Button>
            </div>
            {measurementPoints.length > 0 && (
              <div className="mt-2 max-h-24 overflow-auto border border-border bg-background/50">
                {measurementPoints.map((point, index) => (
                  <div
                    className="grid grid-cols-[30px_1fr_1fr_22px] items-center gap-1.5 border-b border-border px-1.5 py-1 last:border-b-0"
                    data-measurement-point-row={index + 1}
                    key={point.id}
                  >
                    <span className="text-sky-200">P{index + 1}</span>
                    <span className="text-muted-foreground">{point.x.toFixed(3)}</span>
                    <span className="text-muted-foreground">{point.y.toFixed(3)}</span>
                    <button
                      aria-label={`Delete measurement point P${index + 1}`}
                      className="flex size-5 items-center justify-center border border-border text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setMeasurementPoints((current) =>
                          current.filter((measurementPoint) => measurementPoint.id !== point.id)
                        )
                      }
                      title="Delete point"
                      type="button"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-1 gap-1.5">
              <Button
                className="h-6 px-2 text-[10px]"
                disabled={!program || measurementPoints.length === 0 || isSaving}
                onClick={handleInsertMeasurementPoints}
                size="sm"
                type="button"
                variant="outline"
              >
                <ArrowRightFromLine />
                Insert Points
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  className="h-6 px-2 text-[10px]"
                  disabled={measurementPoints.length === 0}
                  onClick={() => handleExportMeasurementPoints('csv')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Download />
                  Export CSV
                </Button>
                <Button
                  className="h-6 px-2 text-[10px]"
                  disabled={measurementPoints.length === 0}
                  onClick={() => handleExportMeasurementPoints('gcode')}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Download />
                  Export G-code
                </Button>
              </div>
              <Button
                className="h-6 px-2 text-[10px]"
                disabled={measurementPoints.length === 0}
                onClick={() => handleExportMeasurementPoints('iso')}
                size="sm"
                type="button"
                variant="outline"
              >
                <Download />
                Export Point ISO
              </Button>
            </div>
          </section>
          </div>
        </aside>
      </section>
    </div>
  );
}

interface EditorLineRow extends GCodeStructuredLine {
  section: 'header' | 'body' | 'footer';
}

function flattenStructureLines(structure: GCodeStructure): EditorLineRow[] {
  return [
    ...structure.header.lines.map((line) => ({ ...line, section: 'header' as const })),
    ...structure.body.lines.map((line) => ({ ...line, section: 'body' as const })),
    ...structure.footer.lines.map((line) => ({ ...line, section: 'footer' as const }))
  ].sort((a, b) => a.num - b.num);
}

function toggleLine(lines: number[], lineNumber: number) {
  const next = new Set(lines);
  if (next.has(lineNumber)) {
    next.delete(lineNumber);
  } else {
    next.add(lineNumber);
  }

  return [...next].sort((a, b) => a - b);
}

function selectLineRange(rows: EditorLineRow[], fromLine: number, toLine: number) {
  const fromIndex = rows.findIndex((row) => row.num === fromLine);
  const toIndex = rows.findIndex((row) => row.num === toLine);
  if (fromIndex < 0 || toIndex < 0) return [toLine];

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return rows.slice(start, end + 1).map((row) => row.num);
}

function readStoredGroupExpanded(groupId: string) {
  try {
    return globalThis.localStorage.getItem(groupStorageKey(groupId)) !== 'false';
  } catch {
    return true;
  }
}

function writeStoredGroupExpanded(groupId: string, expanded: boolean) {
  try {
    globalThis.localStorage.setItem(groupStorageKey(groupId), String(expanded));
  } catch {
    // Folder collapse is a convenience preference; editing must keep working without storage.
  }
}

function groupStorageKey(groupId: string) {
  if (groupId === 'header' || groupId === 'footer') {
    return `gcodeDrawer.folder.${groupId}`;
  }

  return `gcodeDrawer.contour.${groupId}`;
}

function formatCursorCoordinate(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '-';
}

function formatBounds(bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return '-';
  }

  return `X${bounds.minX.toFixed(3)}..${bounds.maxX.toFixed(3)} Y${bounds.minY.toFixed(3)}..${bounds.maxY.toFixed(3)}`;
}

function readStoredGuideLanguage(): EditorGuideLanguage {
  try {
    const stored = globalThis.localStorage.getItem(GUIDE_LANGUAGE_STORAGE_KEY);
    return stored === 'ro' ? 'ro' : 'en';
  } catch {
    return 'en';
  }
}

function readStoredLineMode(): 'select' | 'edit' {
  try {
    return globalThis.localStorage.getItem(LINE_MODE_STORAGE_KEY) === 'edit' ? 'edit' : 'select';
  } catch {
    return 'select';
  }
}

function writeStoredLineMode(mode: 'select' | 'edit') {
  try {
    globalThis.localStorage.setItem(LINE_MODE_STORAGE_KEY, mode);
  } catch {
    // Select/Edit mode is only a convenience preference.
  }
}

function confirmBulkLineDelete(count: number) {
  if (typeof globalThis.confirm !== 'function') return true;
  return globalThis.confirm(`Delete ${count} selected lines? Use Ctrl+Z to undo if needed.`);
}

function confirmGroupDelete(groupId: string, count: number) {
  if (typeof globalThis.confirm !== 'function') return true;
  return globalThis.confirm(`Delete folder '${groupId}' with ${count} lines? Use Ctrl+Z to undo.`);
}

function sanitizeLineText(text: string) {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trimEnd();
}
