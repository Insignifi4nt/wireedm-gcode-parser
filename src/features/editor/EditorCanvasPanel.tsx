import type { LoadedEditorProgram } from '@/domain/editor/loadEditorProgram';
import type { MeasurementPoint } from '@/domain/editor/measurementPoints';

import { EditorPreview } from './EditorPreview';
import type { EditorGuideTarget } from './editorGuideContent';
import { guideHighlightClass, guideTargetProps } from './editorGuideHighlight';

interface EditorCanvasPanelProps {
  draftProgram: LoadedEditorProgram | null;
  gridSnapEnabled: boolean;
  guideHighlightTarget: EditorGuideTarget | null;
  guideOpen: boolean;
  hoveredLine: number | null;
  measurementPoints: MeasurementPoint[];
  pathCount: number;
  pinnedLines: number[];
  selectedLines: number[];
  onAddMeasurementPoint: (x: number, y: number) => void;
  onCursorPointChange: (point: { x: number; y: number } | null) => void;
  onMeasurementPointMove?: (pointId: string, point: { x: number; y: number }) => void;
  onPreviewPointClick?: (point: { x: number; y: number }) => void;
}

export function EditorCanvasPanel({
  draftProgram,
  gridSnapEnabled,
  guideHighlightTarget,
  guideOpen,
  hoveredLine,
  measurementPoints,
  pathCount,
  pinnedLines,
  selectedLines,
  onAddMeasurementPoint,
  onCursorPointChange,
  onMeasurementPointMove,
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
          keyboardShortcutsEnabled={!guideOpen}
          measurementPoints={measurementPoints}
          onCursorPointChange={onCursorPointChange}
          onMeasurementPointMove={onMeasurementPointMove}
          onPreviewPointClick={onPreviewPointClick ?? ((point) => onAddMeasurementPoint(point.x, point.y))}
          pinnedLines={pinnedLines}
          program={draftProgram}
          snapToGrid={gridSnapEnabled}
          selectedLines={selectedLines}
        />
      </div>
    </section>
  );
}
