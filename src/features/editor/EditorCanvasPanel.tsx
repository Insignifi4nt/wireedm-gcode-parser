import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';
import type { PathPlanningDocument } from '@/domain/path-intel/types';

import { EditorPreview, type EditorConstructionPreview } from './EditorPreview';
import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';
import type { EditorPathElementRef } from './EditorPathNavigatorPanel';

interface EditorCanvasPanelProps {
  draftProgram: LoadedEditorProgram | null;
  constructionPreview?: EditorConstructionPreview | null;
  gridSnapEnabled: boolean;
  guideHighlightTarget: EditorGuideTarget | null;
  guideOpen: boolean;
  hoveredLine: number | null;
  hoveredPathElement?: EditorPathElementRef | null;
  measurementPoints: MeasurementPoint[];
  pathDocument?: PathPlanningDocument | null;
  pathCount: number;
  pinnedLines: number[];
  selectedLines: number[];
  onAddMeasurementPoint: (x: number, y: number) => void;
  onCursorPointChange: (point: { x: number; y: number } | null) => void;
  onMeasurementPointMove?: (pointId: string, point: { x: number; y: number }) => void;
  onPathElementHover?: (element: EditorPathElementRef | null) => void;
  onPreviewPointClick?: (point: { x: number; y: number }) => void;
}

export function EditorCanvasPanel({
  draftProgram,
  constructionPreview,
  gridSnapEnabled,
  guideHighlightTarget,
  guideOpen,
  hoveredLine,
  hoveredPathElement,
  measurementPoints,
  pathDocument,
  pathCount,
  pinnedLines,
  selectedLines,
  onAddMeasurementPoint,
  onCursorPointChange,
  onMeasurementPointMove,
  onPathElementHover,
  onPreviewPointClick
}: EditorCanvasPanelProps) {
  return (
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
        className={`min-h-0 flex-1 p-1.5 ${guideHighlightClass('preview', guideHighlightTarget)}`}
        {...guideTargetProps('preview', guideHighlightTarget)}
      >
        <EditorPreview
          hoveredLine={hoveredLine}
          hoveredPathElement={hoveredPathElement}
          constructionPreview={constructionPreview}
          keyboardShortcutsEnabled={!guideOpen}
          measurementPoints={measurementPoints}
          onCursorPointChange={onCursorPointChange}
          onMeasurementPointMove={onMeasurementPointMove}
          onPathElementHover={onPathElementHover}
          onPreviewPointClick={onPreviewPointClick ?? ((point) => onAddMeasurementPoint(point.x, point.y))}
          pathDocument={pathDocument}
          pinnedLines={pinnedLines}
          program={draftProgram}
          snapToGrid={gridSnapEnabled}
          selectedLines={selectedLines}
        />
      </div>
    </section>
  );
}
