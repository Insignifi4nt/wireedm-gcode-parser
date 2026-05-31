import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent
} from 'react';

import { useAppRail } from '@/app/AppRailContext';
import { buildOutputFilename, composeGCodeProgram } from '@/domain/post/gcodeTemplates';
import { parseGCodeProgram } from '@/domain/editor/gcodeParser';
import {
  deleteBodyGroup,
  moveBodyGroup,
  moveSelectedLines,
  setStartAtLine
} from '@/domain/editor/gcodeLineOperations';
import { organizeGCodeStructure } from '@/domain/editor/gcodeStructure';
import { normalizeToISO } from '@/domain/editor/isoNormalizer';
import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import { evaluateMachineFit } from '@/domain/machine/machineFit';
import {
  constructMagnetizedPoint,
  movePathOperation,
  previewClosedOperationStartNearPoint,
  reversePathOperation,
  setClosedOperationStartAtExistingPointNearPoint,
  setClosedOperationStartNearPoint,
  setPathOperationClassification,
  slideMagnetizedPointOnSegment,
  type MagnetizedPathPoint,
  type MagnetizeMode
} from '@/domain/path-editor/pathDocumentOperations';
import {
  boundsAreFinite,
  emptyBounds,
  mergeBounds,
  orientedSegmentEnd,
  orientedSegmentStart,
  pathBounds,
  pointsEqual,
  requiredSegment,
  segmentMap
} from '@/domain/path-intel/segments';
import type { Bounds2, ContourClassification, PathPlanningDocument, Point2 } from '@/domain/path-intel/types';
import { projectUpidDocument } from '@/domain/upid/projectUpid';
import { postUpidToGcode } from '@/domain/upid/upidDocument';
import {
  exportMeasurementPointsAsCsv,
  exportMeasurementPointsAsGCode,
  exportMeasurementPointsAsISO,
  insertMeasurementPointsIntoText,
  type MeasurementPoint,
  type MeasurementPointPathSnap
} from '@/domain/editor/measurementPoints';

import { EditorCanvasPanel } from './EditorCanvasPanel';
import { EditorGuideDialog } from './EditorGuideDialog';
import { EditorHeaderBar } from './EditorHeaderBar';
import { EditorInspectorPanel } from './EditorInspectorPanel';
import {
  EditorPathNavigatorPanel,
  EditorPathNavigatorRailCollapsed,
  type EditorPathElementRef
} from './EditorPathNavigatorPanel';
import { EditorProgramLinesPanel } from './EditorProgramLinesPanel';
import { EditorProgramTextPanel } from './EditorProgramTextPanel';
import { EditorUpidExportPreview } from './EditorUpidExportPreview';
import type { EditorGuideLanguage, EditorGuideTarget } from './editorGuideContent';
import {
  confirmBulkLineDelete,
  confirmGroupDelete,
  flattenStructureLines,
  formatBounds,
  readStoredGroupExpanded,
  readStoredGuideLanguage,
  readStoredLineMode,
  sanitizeLineText,
  selectLineRange,
  toggleLine,
  writeStoredGroupExpanded,
  writeStoredGuideLanguage,
  writeStoredLineMode
} from './editorLineState';

interface EditorPageProps {
  program: LoadedEditorProgram | null;
  importStatus: 'idle' | 'importing' | 'error';
  importErrorMessage: string | null;
  saveStatus: 'idle' | 'saving' | 'error';
  saveErrorMessage: string | null;
  onBackToDashboard: () => void;
  onDownloadEditorFile: (fileName: string, text: string) => void;
  onImportProgramFile: (file: File) => void | Promise<void>;
  onSaveProgramText: (text: string, pathDocument?: PathPlanningDocument | null) => void | Promise<void>;
  onStatusMessage?: (message: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

interface EditorDraftSnapshot {
  pathDocument: PathPlanningDocument | null;
  selectedPathElement: EditorPathElementRef | null;
  selectedPathOperationId: string | null;
  text: string;
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
  const { setRailContent } = useAppRail();
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
  const [pathClickMode, setPathClickMode] = useState<'set-start' | MagnetizeMode | null>(null);
  const [pathDocumentDraft, setPathDocumentDraft] = useState<PathPlanningDocument | null>(null);
  const [hoveredPathElement, setHoveredPathElement] = useState<EditorPathElementRef | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [pathHoverAssistEnabled, setPathHoverAssistEnabled] = useState(false);
  const [pathMagneticSnapEnabled, setPathMagneticSnapEnabled] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedPathElement, setSelectedPathElement] = useState<EditorPathElementRef | null>(null);
  const [selectedPathOperationId, setSelectedPathOperationId] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<number[]>([]);
  const [redoStack, setRedoStack] = useState<EditorDraftSnapshot[]>([]);
  const [undoStack, setUndoStack] = useState<EditorDraftSnapshot[]>([]);
  const savedPathDocument = useMemo(() => projectUpidDocument(program?.project), [program?.project]);
  const savedPathDocumentSignature = useMemo(
    () => pathDocumentSignature(savedPathDocument),
    [savedPathDocument]
  );
  const draftPathDocumentSignature = useMemo(
    () => pathDocumentSignature(pathDocumentDraft),
    [pathDocumentDraft]
  );
  const isImporting = importStatus === 'importing';
  const isSaving = saveStatus === 'saving';
  const draftProgram = useMemo<LoadedEditorProgram | null>(
    () =>
      program
        ? {
            filePath: program.filePath,
            text: draftText,
            parseResult: parseGCodeProgram(draftText),
            project: program.project
          }
        : null,
    [draftText, program]
  );
  const pathDocumentStats = useMemo(
    () => (pathDocumentDraft ? summarizePathDocumentForEditor(pathDocumentDraft) : null),
    [pathDocumentDraft]
  );
  const pathCount = pathDocumentStats?.pathCount ?? draftProgram?.parseResult.path.length ?? 0;
  const rapidMoveCount =
    pathDocumentStats?.rapidMoveCount ??
    draftProgram?.parseResult.path.filter((point) => point.type === 'rapid').length ??
    0;
  const cuttingMoveCount =
    pathDocumentStats?.cuttingMoveCount ??
    draftProgram?.parseResult.path.filter((point) => point.type === 'cut').length ??
    0;
  const arcMoveCount =
    pathDocumentStats?.arcMoveCount ??
    draftProgram?.parseResult.path.filter((point) => point.type === 'arc').length ??
    0;
  const boundsText = pathDocumentStats
    ? formatBounds(pathDocumentStats.bounds)
    : draftProgram && pathCount > 0
      ? formatBounds(draftProgram.parseResult.bounds)
      : '-';
  const machineFit = useMemo(
    () =>
      program
        ? evaluateMachineFit({
            document: pathDocumentDraft,
            profile: program.project?.machine
          })
        : null,
    [pathDocumentDraft, program]
  );
  const upidExport = useMemo(() => {
    if (!pathDocumentDraft || !program?.project) return null;

    const posted = postUpidToGcode(pathDocumentDraft);
    const body = posted.body;
    const machine = program.project.machine;
    const fileName =
      program.project.generated.files.at(-1)?.name ??
      buildOutputFilename(program.project.name, machine.output.extension, machine.output.customExtension);

    return {
      body,
      diagnostics: [...pathDocumentDraft.diagnostics, ...posted.diagnostics],
      fileName,
      machineName: machine.name,
      operationCount: pathDocumentDraft.plan.operations.length,
      programText: composeGCodeProgram({
        header: machine.templates.header,
        body,
        footer: machine.templates.footer,
        lineEnding: machine.output.lineEnding
      }),
      postMetrics: posted.metrics
    };
  }, [pathDocumentDraft, program?.project]);
  const constructionPreview = useMemo(() => {
    if (
      !pathDocumentDraft ||
      !pathMagneticSnapEnabled ||
      !previewCursorPoint ||
      (pathClickMode !== 'perpendicular' && pathClickMode !== 'tangent')
    ) {
      return null;
    }

    const sourcePoint = measurementPoints.at(-1);
    if (!sourcePoint) return null;

    const magnetized = constructMagnetizedPoint(
      pathDocumentDraft,
      sourcePoint,
      previewCursorPoint,
      pathClickMode
    );
    if (!magnetized) return null;

    return {
      mode: pathClickMode,
      operationId: magnetized.operationId,
      relation: magnetized.relation,
      segmentId: magnetized.segmentId,
      sourcePoint,
      targetPoint: magnetized.point
    };
  }, [measurementPoints, pathClickMode, pathDocumentDraft, pathMagneticSnapEnabled, previewCursorPoint]);
  const startPreview = useMemo(() => {
    if (
      !pathDocumentDraft ||
      !selectedPathOperationId ||
      !previewCursorPoint ||
      pathClickMode !== 'set-start'
    ) {
      return null;
    }

    const preview = previewClosedOperationStartNearPoint(
      pathDocumentDraft,
      selectedPathOperationId,
      previewCursorPoint,
      pathMagneticSnapEnabled
    );
    if (!preview) return null;

    return {
      operationId: preview.operationId,
      point: preview.point,
      pointRole: startPreviewPointRole(pathDocumentDraft, preview),
      relation: preview.relation,
      segmentId: preview.segmentId
    };
  }, [
    pathClickMode,
    pathDocumentDraft,
    pathMagneticSnapEnabled,
    previewCursorPoint,
    selectedPathOperationId
  ]);
  const editorFileName = program?.filePath.split('/').pop() ?? '-';
  const hasUnsavedChanges = Boolean(
    program && (draftText !== program.text || draftPathDocumentSignature !== savedPathDocumentSignature)
  );
  const constructionHoveredPathElement = useMemo<EditorPathElementRef | null>(
    () =>
      constructionPreview && pathHoverAssistEnabled
        ? {
            operationId: constructionPreview.operationId,
            segmentId: constructionPreview.segmentId
          }
        : null,
    [constructionPreview, pathHoverAssistEnabled]
  );
  const startHoveredPathElement = useMemo<EditorPathElementRef | null>(
    () =>
      startPreview && pathHoverAssistEnabled
        ? {
            operationId: startPreview.operationId,
            pointRole: startPreview.pointRole ?? undefined,
            segmentId: startPreview.segmentId
          }
        : null,
    [pathHoverAssistEnabled, startPreview]
  );
  const activeHoveredPathElement =
    constructionHoveredPathElement ?? startHoveredPathElement ?? hoveredPathElement;
  const structure = useMemo(
    () => (draftProgram ? organizeGCodeStructure(draftProgram.text.split(/\r?\n/)) : null),
    [draftProgram]
  );
  const lineRows = useMemo(() => (structure ? flattenStructureLines(structure) : []), [structure]);
  const bodyGroups = structure?.body.contours ?? [];
  const isPathProject = Boolean(pathDocumentDraft);
  const editorRailContent = useMemo(
    () =>
      pathDocumentDraft
        ? {
            collapsed: <EditorPathNavigatorRailCollapsed />,
            expanded: (
              <EditorPathNavigatorPanel
                hasUnsavedChanges={hasUnsavedChanges}
                hoveredPathElement={activeHoveredPathElement}
                hoverAssistEnabled={pathHoverAssistEnabled}
                isSaving={isSaving}
                magneticSnapEnabled={pathMagneticSnapEnabled}
                onActivatePathClickMode={setPathClickMode}
                onHoverPathElement={setHoveredPathElement}
                onMovePathOperation={handleMovePathOperation}
                onOpenExportPreview={() => setExportPreviewOpen(true)}
                onRedoDraft={handleRedoDraft}
                onReversePathOperation={handleReversePathOperation}
                onSaveClick={handleSaveClick}
                onSelectPathElement={handleSelectPathElement}
                onSetPathOperationClassification={handleSetPathOperationClassification}
                onSetPathStartFromElement={handleSetPathStartFromElement}
                onToggleHoverAssist={handleTogglePathHoverAssist}
                onToggleMagneticSnap={() => setPathMagneticSnapEnabled((current) => !current)}
                onUndoDraft={handleUndoDraft}
                pathClickMode={pathClickMode}
                pathDocument={pathDocumentDraft}
                redoAvailable={redoStack.length > 0}
                selectedPathElement={selectedPathElement}
                selectedPathOperationId={selectedPathOperationId}
                undoAvailable={undoStack.length > 0}
              />
            )
          }
        : null,
    [
      hasUnsavedChanges,
      isSaving,
      pathClickMode,
      pathDocumentDraft,
      activeHoveredPathElement,
      pathHoverAssistEnabled,
      pathMagneticSnapEnabled,
      redoStack.length,
      selectedPathElement,
      selectedPathOperationId,
      undoStack.length
    ]
  );

  useEffect(() => {
    setDraftText(program?.text ?? '');
    const pathDocument = projectUpidDocument(program?.project);
    const nextPathDocument = pathDocument ? structuredClone(pathDocument) : null;
    const nextOperationId = nextPathDocument?.plan.operations[0]?.id ?? null;
    setPathDocumentDraft(nextPathDocument);
    setSelectedPathOperationId(nextOperationId);
    setSelectedPathElement(nextOperationId ? { operationId: nextOperationId, segmentId: null } : null);
    setHoveredPathElement(null);
    setExportPreviewOpen(false);
    setPathClickMode(null);
    setRedoStack([]);
    setUndoStack([]);
    clearTransientLineState();
  }, [program?.filePath]);

  useEffect(() => {
    setRailContent(editorRailContent);
    return () => setRailContent(null);
  }, [editorRailContent, setRailContent]);

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
        if (pathDocumentDraft) {
          clearSelectedLines();
        } else {
          handleDeleteSelectedLines();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [draftText, isSaving, measurementPoints.length, pathDocumentDraft, program, redoStack, selectedLines, undoStack]);

  async function handleEditorDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (!file || isImporting) return;

    await onImportProgramFile(file);
  }

  async function handleSaveClick() {
    if (!program || !hasUnsavedChanges || isSaving) return;
    await onSaveProgramText(draftText, pathDocumentDraft);
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

  function handleTogglePathHoverAssist() {
    setPathHoverAssistEnabled((current) => {
      if (current) {
        setHoveredPathElement(null);
        setPathMagneticSnapEnabled(false);
      }
      return !current;
    });
  }

  function handleSelectPathElement(element: EditorPathElementRef) {
    setSelectedPathOperationId(element.operationId);
    setSelectedPathElement(element);
  }

  function handleSelectPathOperation(operationId: string) {
    handleSelectPathElement({ operationId, segmentId: null });
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
    if (!program || pathDocumentDraft || selectedLines.length === 0 || isSaving) return;
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
    if (!program || pathDocumentDraft || selectedLines.length === 0 || isSaving) return;

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
    writeStoredGuideLanguage(language);
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
        id: nextMeasurementPointId(current.length),
        x,
        y
      }
    ]);
  }

  function addPathConstructionPoint(magnetized: MagnetizedPathPoint) {
    setMeasurementPoints((current) => [
      ...current,
      {
        id: nextMeasurementPointId(current.length),
        pathSnap: pathSnapFromMagnetized(magnetized),
        x: magnetized.point.x,
        y: magnetized.point.y
      }
    ]);
  }

  function handlePreviewPointClick(point: { x: number; y: number }) {
    if (!pathClickMode || !pathDocumentDraft || !selectedPathOperationId) {
      addMeasurementPoint(point.x, point.y);
      return;
    }

    if (pathClickMode === 'set-start') {
      const edited = pathMagneticSnapEnabled
        ? setClosedOperationStartNearPoint(pathDocumentDraft, selectedPathOperationId, point)
        : setClosedOperationStartAtExistingPointNearPoint(pathDocumentDraft, selectedPathOperationId, point);
      if (!edited) {
        onStatusMessage?.('Choose a closed path operation before setting the start.', 'warning');
        setPathClickMode(null);
        return;
      }
      applyPathDocumentEdit(edited);
      setPathClickMode(null);
      onStatusMessage?.('Path start updated.', 'success');
      return;
    }

    const sourcePoint = measurementPoints.at(-1) ?? point;
    const magnetized = constructMagnetizedPoint(pathDocumentDraft, sourcePoint, point, pathClickMode);
    if (!magnetized) {
      setPathClickMode(null);
      return;
    }

    addPathConstructionPoint(magnetized);
    setPathClickMode(null);
  }

  function handleSetPathStartFromElement(element: EditorPathElementRef) {
    if (!pathDocumentDraft || !element.operationId || !element.segmentId || !element.pointRole || isSaving) {
      return;
    }

    const point = pathElementPoint(pathDocumentDraft, element);
    if (!point) return;

    const edited = setClosedOperationStartAtExistingPointNearPoint(
      pathDocumentDraft,
      element.operationId,
      point
    );
    if (!edited) return;

    applyPathDocumentEdit(edited, {
      selectedPathElement: element,
      selectedPathOperationId: element.operationId
    });
    setPathClickMode(null);
    onStatusMessage?.('Path start updated.', 'success');
  }

  function handleMeasurementPointMove(pointId: string, point: { x: number; y: number }) {
    setMeasurementPoints((current) =>
      current.map((measurementPoint) => {
        if (measurementPoint.id !== pointId) return measurementPoint;
        if (!measurementPoint.pathSnap || !pathDocumentDraft) {
          return { ...measurementPoint, x: point.x, y: point.y };
        }

        const magnetized = slideMagnetizedPointOnSegment(
          pathDocumentDraft,
          measurementPoint.pathSnap,
          point
        );
        if (!magnetized) return measurementPoint;

        return {
          ...measurementPoint,
          pathSnap: {
            ...pathSnapFromMagnetized(magnetized),
            sourcePoint: measurementPoint.pathSnap.sourcePoint
          },
          x: magnetized.point.x,
          y: magnetized.point.y
        };
      })
    );
  }

  function handleMovePathOperation(direction: -1 | 1, operationId = selectedPathOperationId ?? undefined) {
    if (!pathDocumentDraft || !operationId || isSaving) return;
    const edited = movePathOperation(pathDocumentDraft, operationId, direction);
    if (edited) applyPathDocumentEdit(edited, { selectedPathOperationId: operationId });
  }

  function handleReversePathOperation() {
    if (!pathDocumentDraft || !selectedPathOperationId || isSaving) return;
    const edited = reversePathOperation(pathDocumentDraft, selectedPathOperationId);
    if (edited) applyPathDocumentEdit(edited);
  }

  function handleSetPathOperationClassification(classification: ContourClassification) {
    if (!pathDocumentDraft || !selectedPathOperationId || isSaving) return;
    const edited = setPathOperationClassification(pathDocumentDraft, selectedPathOperationId, classification);
    if (edited) applyPathDocumentEdit(edited);
  }

  function applyPathDocumentEdit(
    nextDocument: PathPlanningDocument,
    options: {
      selectedPathElement?: EditorPathElementRef | null;
      selectedPathOperationId?: string | null;
    } = {}
  ) {
    if (!program?.project) return;

    const body = postUpidToGcode(nextDocument).body;
    replaceDraftText(
      composeGCodeProgram({
        header: program.project.machine.templates.header,
        body,
        footer: program.project.machine.templates.footer,
        lineEnding: program.project.machine.output.lineEnding
      }),
      {
        pathDocument: nextDocument,
        selectedPathElement: Object.hasOwn(options, 'selectedPathElement')
          ? options.selectedPathElement
          : selectedPathElement,
        selectedPathOperationId: options.selectedPathOperationId ?? selectedPathOperationId
      }
    );
  }

  function handleInsertMeasurementPoints() {
    if (!program || pathDocumentDraft || measurementPoints.length === 0 || isSaving) return;

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

  function replaceDraftText(
    nextText: string,
    options: {
      pathDocument?: PathPlanningDocument | null;
      selectedPathElement?: EditorPathElementRef | null;
      selectedPathOperationId?: string | null;
    } = {}
  ) {
    const hasPathDocumentOption = Object.hasOwn(options, 'pathDocument');
    if (nextText === draftText && !hasPathDocumentOption) return;

    const nextPathDocument = hasPathDocumentOption
      ? clonePathDocument(options.pathDocument ?? null)
      : null;
    const nextSelectedPathOperationId = nextPathDocument
      ? options.selectedPathOperationId ?? selectedPathOperationId
      : null;
    const candidateSelectedPathElement = Object.hasOwn(options, 'selectedPathElement')
      ? options.selectedPathElement ?? null
      : selectedPathElement;
    const nextSelectedPathElement = nextPathDocument
      ? normalizePathElementSelection(nextPathDocument, nextSelectedPathOperationId, candidateSelectedPathElement)
      : null;

    setUndoStack((current) => [...current, currentDraftSnapshot()]);
    setRedoStack([]);
    setDraftText(nextText);
    setPathDocumentDraft(nextPathDocument);
    setSelectedPathOperationId(nextSelectedPathOperationId);
    setSelectedPathElement(nextSelectedPathElement);
    if (!nextPathDocument) setPathClickMode(null);
  }

  function handleUndoDraft() {
    const previous = undoStack.at(-1);
    if (previous === undefined) return;

    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [currentDraftSnapshot(), ...current]);
    restoreDraftSnapshot(previous);
    clearTransientLineState();
  }

  function handleRedoDraft() {
    const next = redoStack[0];
    if (next === undefined) return;

    setRedoStack((current) => current.slice(1));
    setUndoStack((current) => [...current, currentDraftSnapshot()]);
    restoreDraftSnapshot(next);
    clearTransientLineState();
  }

  function handleDraftTextChange(nextText: string) {
    if (nextText === draftText) return;
    if (pathDocumentDraft) {
      setUndoStack((current) => [...current, currentDraftSnapshot()]);
      setRedoStack([]);
    }
    setDraftText(nextText);
    setPathDocumentDraft(null);
    setSelectedPathOperationId(null);
    setSelectedPathElement(null);
    setPathClickMode(null);
  }

  function currentDraftSnapshot(): EditorDraftSnapshot {
    return {
      text: draftText,
      pathDocument: clonePathDocument(pathDocumentDraft),
      selectedPathElement,
      selectedPathOperationId
    };
  }

  function restoreDraftSnapshot(snapshot: EditorDraftSnapshot) {
    const restoredPathDocument = clonePathDocument(snapshot.pathDocument);
    setDraftText(snapshot.text);
    setPathDocumentDraft(restoredPathDocument);
    const restoredOperationId = restoredPathDocument ? snapshot.selectedPathOperationId : null;
    setSelectedPathOperationId(restoredOperationId);
    setSelectedPathElement(
      restoredPathDocument
        ? normalizePathElementSelection(
            restoredPathDocument,
            restoredOperationId,
            snapshot.selectedPathElement
          )
        : null
    );
    setPathClickMode(null);
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

  function renderProgramTextPanel() {
    return (
      <EditorProgramTextPanel
        draftText={draftText}
        hasUnsavedChanges={hasUnsavedChanges}
        isSaving={isSaving}
        onDraftTextChange={handleDraftTextChange}
        program={program}
      />
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col overflow-hidden"
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
      <EditorHeaderBar
        filePath={program?.filePath}
        guideHighlightTarget={guideHighlightTarget}
        importErrorMessage={importErrorMessage}
        isImporting={isImporting}
        onBackToDashboard={onBackToDashboard}
        onImportProgramFile={onImportProgramFile}
        onOpenGuide={() => setGuideOpen(true)}
        saveErrorMessage={saveErrorMessage}
      />

      <section className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(360px,1fr)_minmax(320px,45vh)] gap-2 overflow-hidden p-2 lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-[minmax(0,1fr)]">
        <EditorCanvasPanel
          constructionPreview={constructionPreview}
          draftProgram={draftProgram}
          gridSnapEnabled={gridSnapEnabled}
          guideHighlightTarget={guideHighlightTarget}
          guideOpen={guideOpen}
          hoveredLine={hoveredLine}
          hoveredPathElement={activeHoveredPathElement}
          measurementPoints={measurementPoints}
          onAddMeasurementPoint={addMeasurementPoint}
          onCursorPointChange={setPreviewCursorPoint}
          onMeasurementPointMove={handleMeasurementPointMove}
          onPathElementClick={!pathClickMode ? handleSelectPathElement : undefined}
          onPathElementHover={pathHoverAssistEnabled ? setHoveredPathElement : undefined}
          onPreviewPointClick={handlePreviewPointClick}
          pathDocument={pathDocumentDraft}
          pathCount={pathCount}
          pinnedLines={pinnedLines}
          selectedPathElement={selectedPathElement}
          selectedLines={selectedLines}
          startPreview={startPreview}
        />

        <aside
          className={`min-h-0 overflow-hidden border border-border bg-card/95 font-mono text-[10px] ${
            isPathProject ? '' : 'grid lg:grid-rows-[minmax(0,1fr)_auto]'
          }`}
          data-editor-inspector-panel
          data-editor-inspector-rail
        >
          {!pathDocumentDraft && (
            <div
              className="grid min-h-0 gap-2 overflow-hidden p-2 lg:grid-rows-[minmax(260px,1fr)_auto]"
              data-editor-side-code-panel
            >
              <EditorProgramLinesPanel
                bodyGroups={bodyGroups}
                draftText={draftText}
                guideHighlightTarget={guideHighlightTarget}
                hasUnsavedChanges={hasUnsavedChanges}
                isGroupExpanded={isGroupExpanded}
                isSaving={isSaving}
                lineMode={lineMode}
                lineRows={lineRows}
                onClearPins={() => setPinnedLines([])}
                onClearSelectedLines={clearSelectedLines}
                onDeleteGroup={handleDeleteGroup}
                onDeleteSelectedLines={handleDeleteSelectedLines}
                onExportNormalizedISO={handleExportNormalizedISO}
                onHoverLineChange={setHoveredLine}
                onLineClick={handleLineClick}
                onLineEditCommit={handleLineEditCommit}
                onMoveGroup={handleMoveGroup}
                onMoveSelectedLines={handleMoveSelectedLines}
                onNormalizeDraft={handleNormalizeDraft}
                onRedoDraft={handleRedoDraft}
                onSaveClick={handleSaveClick}
                onSetLineMode={handleSetLineMode}
                onSetStartHere={handleSetStartHere}
                onToggleGroup={handleToggleGroup}
                onTogglePin={handleTogglePin}
                onToggleProgramLinesOpen={() => setProgramLinesOpen((current) => !current)}
                onUndoDraft={handleUndoDraft}
                pinnedLines={pinnedLines}
                program={program}
                programLinesOpen={programLinesOpen}
                redoAvailable={redoStack.length > 0}
                selectedLines={selectedLines}
                structure={structure}
                undoAvailable={undoStack.length > 0}
              />
              {renderProgramTextPanel()}
            </div>
          )}
          <EditorInspectorPanel
            arcMoveCount={arcMoveCount}
            boundsText={boundsText}
            cuttingMoveCount={cuttingMoveCount}
            canInsertMeasurementPoints={!isPathProject}
            draftProgram={draftProgram}
            editorFileName={editorFileName}
            fullHeight={isPathProject}
            gridSnapEnabled={gridSnapEnabled}
            guideHighlightTarget={guideHighlightTarget}
            isSaving={isSaving}
            measurementPoints={measurementPoints}
            machineFit={machineFit}
            machineProfile={program?.project?.machine ?? null}
            onActivatePathClickMode={setPathClickMode}
            onAddMeasurementPoint={handleAddMeasurementPoint}
            onClearMeasurementPoints={() => setMeasurementPoints([])}
            onDeleteMeasurementPoint={(pointId) =>
              setMeasurementPoints((current) =>
                current.filter((measurementPoint) => measurementPoint.id !== pointId)
              )
            }
            onExportMeasurementPoints={handleExportMeasurementPoints}
            onHoverPathElement={setHoveredPathElement}
            onInsertMeasurementPoints={handleInsertMeasurementPoints}
            onMovePathOperation={handleMovePathOperation}
            onPointXDraftChange={setPointXDraft}
            onPointYDraftChange={setPointYDraft}
            onReversePathOperation={handleReversePathOperation}
            onSelectPathElement={handleSelectPathElement}
            onSelectPathOperation={handleSelectPathOperation}
            onToggleGridSnap={() => setGridSnapEnabled((current) => !current)}
            pathCount={pathCount}
            pathClickMode={pathClickMode}
            pathDocument={pathDocumentDraft}
            pointXDraft={pointXDraft}
            pointYDraft={pointYDraft}
            previewCursorPoint={previewCursorPoint}
            program={program}
            rapidMoveCount={rapidMoveCount}
            selectedPathElement={selectedPathElement}
            selectedPathOperationId={selectedPathOperationId}
            showPathOperations={!isPathProject}
            structure={isPathProject ? null : structure}
          />
        </aside>
      </section>
      {exportPreviewOpen && upidExport && (
        <EditorUpidExportPreview
          fileName={upidExport.fileName}
          diagnostics={upidExport.diagnostics}
          machineName={upidExport.machineName}
          onClose={() => setExportPreviewOpen(false)}
          onDownload={() => onDownloadEditorFile(upidExport.fileName, upidExport.programText)}
          operationCount={upidExport.operationCount}
          postMetrics={upidExport.postMetrics}
          programText={upidExport.programText}
        />
      )}
    </div>
  );
}

function clonePathDocument(document: PathPlanningDocument | null) {
  return document ? structuredClone(document) : null;
}

function pathDocumentSignature(document: PathPlanningDocument | null) {
  return document ? JSON.stringify(document) : '';
}

function normalizePathElementSelection(
  document: PathPlanningDocument,
  operationId: string | null,
  element: EditorPathElementRef | null
): EditorPathElementRef | null {
  const fallbackOperation = document.plan.operations[0] ?? null;
  const operation =
    document.plan.operations.find((candidate) => candidate.id === operationId) ?? fallbackOperation;
  if (!operation) return null;

  if (
    element?.operationId === operation.id &&
    (element.travelRole === 'rapid-in' ||
      !element.segmentId ||
      operation.segmentRefs.some((candidate) => candidate.segmentId === element.segmentId))
  ) {
    return element;
  }

  return {
    operationId: operation.id,
    segmentId: null
  };
}

function pathElementPoint(document: PathPlanningDocument, element: EditorPathElementRef) {
  if (!element.operationId || !element.segmentId || !element.pointRole) return null;

  const operation = document.plan.operations.find((candidate) => candidate.id === element.operationId);
  const ref = operation?.segmentRefs.find((candidate) => candidate.segmentId === element.segmentId);
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  return element.pointRole === 'start' ? orientedSegmentStart(segment, ref) : orientedSegmentEnd(segment, ref);
}

function startPreviewPointRole(
  document: PathPlanningDocument,
  preview: {
    operationId: string;
    point: { x: number; y: number };
    segmentId: string;
  }
): 'start' | 'end' | null {
  const operation = document.plan.operations.find((candidate) => candidate.id === preview.operationId);
  const ref = operation?.segmentRefs.find((candidate) => candidate.segmentId === preview.segmentId);
  if (!ref) return null;

  const segment = requiredSegment(segmentMap(document.segments), ref.segmentId);
  if (pointsEqual(preview.point, orientedSegmentStart(segment, ref), document.options.coincidenceEpsilon)) {
    return 'start';
  }
  if (pointsEqual(preview.point, orientedSegmentEnd(segment, ref), document.options.coincidenceEpsilon)) {
    return 'end';
  }
  return null;
}

function summarizePathDocumentForEditor(document: PathPlanningDocument) {
  const segmentsById = segmentMap(document.segments);
  let bounds = emptyBounds();
  let currentPoint: Point2 | null = null;
  let rapidMoveCount = 0;
  let cuttingMoveCount = 0;
  let arcMoveCount = 0;

  for (const operation of document.plan.operations) {
    if (operation.segmentRefs.length === 0) continue;

    const operationBounds = pathBounds(operation.segmentRefs, segmentsById);
    if (boundsAreFinite(operationBounds)) {
      bounds = mergeBounds(bounds, operationBounds);
    }

    if (!currentPoint || !pointsEqual(currentPoint, operation.startPoint, document.options.coincidenceEpsilon)) {
      rapidMoveCount += 1;
    }

    for (const ref of operation.segmentRefs) {
      const segment = requiredSegment(segmentsById, ref.segmentId);
      if (segment.kind === 'line') {
        cuttingMoveCount += 1;
      } else if (segment.kind === 'circle') {
        arcMoveCount += 2;
      } else {
        arcMoveCount += 1;
      }
    }

    currentPoint = operation.endPoint;
  }

  if (!boundsAreFinite(bounds)) {
    bounds = emptyDisplayBounds();
  }

  return {
    arcMoveCount,
    bounds,
    cuttingMoveCount,
    pathCount: rapidMoveCount + cuttingMoveCount + arcMoveCount,
    rapidMoveCount
  };
}

function emptyDisplayBounds(): Bounds2 {
  return {
    minX: Number.NaN,
    minY: Number.NaN,
    maxX: Number.NaN,
    maxY: Number.NaN
  };
}

function nextMeasurementPointId(currentLength: number) {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${currentLength}`;
}

function pathSnapFromMagnetized(magnetized: MagnetizedPathPoint): MeasurementPointPathSnap {
  return {
    kind: 'path-construction',
    mode: magnetized.mode,
    operationId: magnetized.operationId,
    relation: magnetized.relation,
    segmentId: magnetized.segmentId,
    sourcePoint: magnetized.sourcePoint,
    tangent: magnetized.tangent
  };
}
