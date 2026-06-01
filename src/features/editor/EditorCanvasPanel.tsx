import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

import { EditorPreview, type EditorConstructionPreview, type EditorStartPreview } from './EditorPreview';
import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

interface EditorCanvasPanelProps {
  draftProgram: LoadedEditorProgram | null;
  constructionPreview?: EditorConstructionPreview | null;
  startPreview?: EditorStartPreview | null;
  gridSnapEnabled: boolean;
  guideHighlightTarget: EditorGuideTarget | null;
  guideOpen: boolean;
  hoveredLine: number | null;
  hoveredPathElement?: EditorPathElementRef | null;
  measurementPoints: MeasurementPoint[];
  pathDocument?: PathPlanningDocument | null;
  pathCount: number;
  pinnedLines: number[];
  selectedPathElement?: EditorPathElementRef | null;
  selectedLines: number[];
  onAddMeasurementPoint: (x: number, y: number) => void;
  onCursorPointChange: (point: { x: number; y: number } | null) => void;
  onMeasurementPointMove?: (pointId: string, point: { x: number; y: number }) => void;
  onPathEndpointClick?: (element: EditorPathElementRef) => void;
  onPathElementClick?: (element: EditorPathElementRef) => void;
  onPathElementHover?: (element: EditorPathElementRef | null) => void;
  onPreviewPointClick?: (point: { x: number; y: number }) => void;
}

export function EditorCanvasPanel({
  draftProgram,
  constructionPreview,
  startPreview,
  gridSnapEnabled,
  guideHighlightTarget,
  guideOpen,
  hoveredLine,
  hoveredPathElement,
  measurementPoints,
  pathDocument,
  pathCount,
  pinnedLines,
  selectedPathElement,
  selectedLines,
  onAddMeasurementPoint,
  onCursorPointChange,
  onMeasurementPointMove,
  onPathEndpointClick,
  onPathElementClick,
  onPathElementHover,
  onPreviewPointClick
}: EditorCanvasPanelProps) {
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-[#0e1317]"
      data-editor-canvas-panel
    >
      <div
        className={`min-h-0 flex-1 ${guideHighlightClass('preview', guideHighlightTarget)}`}
        {...guideTargetProps('preview', guideHighlightTarget)}
      >
        <EditorPreview
          hoveredLine={hoveredLine}
          hoveredPathElement={hoveredPathElement}
          constructionPreview={constructionPreview}
          startPreview={startPreview}
          keyboardShortcutsEnabled={!guideOpen}
          measurementPoints={measurementPoints}
          onCursorPointChange={onCursorPointChange}
          onMeasurementPointMove={onMeasurementPointMove}
          onPathEndpointClick={onPathEndpointClick}
          onPathElementClick={onPathElementClick}
          onPathElementHover={onPathElementHover}
          onPreviewPointClick={onPreviewPointClick ?? ((point) => onAddMeasurementPoint(point.x, point.y))}
          pathDocument={pathDocument}
          pathCount={pathCount}
          pinnedLines={pinnedLines}
          previewLabel={pathDocument ? 'UPID path preview' : 'G-code path preview'}
          program={draftProgram}
          selectedPathElement={selectedPathElement}
          snapToGrid={gridSnapEnabled}
          selectedLines={selectedLines}
        />
      </div>
    </section>
  );
}
