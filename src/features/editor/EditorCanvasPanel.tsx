import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { PostedPreviewTransition } from '@/domain/editor/previewGeometry';

import { EditorPreview, type EditorConstructionPreview, type EditorStartPreview } from './EditorPreview';
import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

interface EditorCanvasPanelProps {
  canvasMouseMode: CanvasMouseMode;
  draftProgram: LoadedEditorProgram | null;
  constructionPreview?: EditorConstructionPreview | null;
  startPreview?: EditorStartPreview | null;
  gridSnapEnabled: boolean;
  guideHighlightTarget: EditorGuideTarget | null;
  guideOpen: boolean;
  hoveredLine: number | null;
  interactionHint?: string | null;
  hoveredPathElement?: EditorPathElementRef | null;
  measurementPoints: MeasurementPoint[];
  pathEndpointActionOperationId?: string | null;
  pathDocument?: PathPlanningDocument | null;
  postedTransitions?: PostedPreviewTransition[];
  pathCount: number;
  pinnedLines: number[];
  selectedPathElement?: EditorPathElementRef | null;
  selectedLines: number[];
  onCursorPointChange: (point: { x: number; y: number } | null) => void;
  onMeasurementPointMove?: (pointId: string, point: { x: number; y: number }) => void;
  onPathEndpointClick?: (element: EditorPathElementRef) => void;
  onPathElementDrag?: (element: EditorPathElementRef, delta: { x: number; y: number }) => void;
  onPathElementClick?: (element: EditorPathElementRef) => void;
  onPathElementHover?: (element: EditorPathElementRef | null) => void;
  onPathSegmentCenterMove?: (element: EditorPathElementRef, targetCenter: { x: number; y: number }) => void;
  onPreviewPointClick?: (point: { x: number; y: number }) => void;
  onSetCanvasMouseMode: (mode: CanvasMouseMode) => void;
}

type CanvasMouseMode = 'select' | 'point';

export function EditorCanvasPanel({
  canvasMouseMode,
  draftProgram,
  constructionPreview,
  startPreview,
  gridSnapEnabled,
  guideHighlightTarget,
  guideOpen,
  hoveredLine,
  interactionHint,
  hoveredPathElement,
  measurementPoints,
  pathEndpointActionOperationId,
  pathDocument,
  postedTransitions,
  pathCount,
  pinnedLines,
  selectedPathElement,
  selectedLines,
  onCursorPointChange,
  onMeasurementPointMove,
  onPathEndpointClick,
  onPathElementDrag,
  onPathElementClick,
  onPathElementHover,
  onPathSegmentCenterMove,
  onPreviewPointClick,
  onSetCanvasMouseMode
}: EditorCanvasPanelProps) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-[#090d10] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
      data-editor-canvas-panel
      data-editor-canvas-model={pathDocument ? 'upid' : 'gcode'}
    >
      <div
        className={`min-h-0 flex-1 ${guideHighlightClass('preview', guideHighlightTarget)}`}
        {...guideTargetProps('preview', guideHighlightTarget)}
      >
        <EditorPreview
          canvasMouseMode={canvasMouseMode}
          hoveredLine={hoveredLine}
          hoveredPathElement={hoveredPathElement}
          constructionPreview={constructionPreview}
          startPreview={startPreview}
          keyboardShortcutsEnabled={!guideOpen}
          measurementPoints={measurementPoints}
          onCursorPointChange={onCursorPointChange}
          onMeasurementPointMove={onMeasurementPointMove}
          onPathEndpointClick={onPathEndpointClick}
          onPathElementDrag={onPathElementDrag}
          onPathElementClick={onPathElementClick}
          onPathElementHover={onPathElementHover}
          onPathSegmentCenterMove={onPathSegmentCenterMove}
          onPreviewPointClick={onPreviewPointClick}
          onSetCanvasMouseMode={onSetCanvasMouseMode}
          pathDocument={pathDocument}
          pathEndpointActionOperationId={pathEndpointActionOperationId}
          postedTransitions={postedTransitions}
          pathCount={pathCount}
          pinnedLines={pinnedLines}
          previewLabel={pathDocument ? 'UPID path preview' : 'G-code path preview'}
          previewTitle={pathDocument ? 'Path Canvas' : 'Preview'}
          program={draftProgram}
          selectedPathElement={selectedPathElement}
          snapToGrid={gridSnapEnabled}
          selectedLines={selectedLines}
        />
      </div>
      {interactionHint && (
        <div
          className="flex min-h-7 items-center border-t border-border bg-background/80 px-2 text-[10px] text-muted-foreground"
          aria-live="polite"
          data-editor-command-hint
          role="status"
        >
          {interactionHint}
        </div>
      )}
    </section>
  );
}
