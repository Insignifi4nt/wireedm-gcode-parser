import type { MachineFitStatus } from '@/domain/machine/machineFit';

import type { EditorDocumentContext } from './EditorHeaderBar';

interface EditorStatusBarProps {
  contourCount: number | null;
  documentContext: EditorDocumentContext;
  diagnosticCount: number;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  machineFitStatus: MachineFitStatus | null;
  machineProfileName: string | null;
  moveCount: number;
  operationCount: number | null;
  programLineCount: number | null;
  previewCursorPoint: { x: number; y: number } | null;
  segmentCount: number | null;
  selectionSummary: string;
  unitSummary: string | null;
}

const DOCUMENT_CONTEXT_LABELS: Record<EditorDocumentContext, string> = {
  'empty-program': 'Empty Program',
  'machine-program': 'Machine Program',
  'path-project': 'Path Project'
};

export function EditorStatusBar({
  contourCount,
  documentContext,
  diagnosticCount,
  hasUnsavedChanges,
  isSaving,
  machineFitStatus,
  machineProfileName,
  moveCount,
  operationCount,
  programLineCount,
  previewCursorPoint,
  segmentCount,
  selectionSummary,
  unitSummary
}: EditorStatusBarProps) {
  const saveState = isSaving ? 'Saving' : hasUnsavedChanges ? 'Modified · Unsaved' : 'Saved';

  return (
    <footer
      className="technical-value work-region-scrollbar flex h-6 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-border bg-card/95 px-2 text-[10px] text-muted-foreground"
      data-editor-status-bar
    >
      <span>{DOCUMENT_CONTEXT_LABELS[documentContext]}</span>
      <span
        aria-atomic="true"
        aria-live="polite"
        data-editor-document-state={saveState.toLowerCase()}
        role="status"
      >
        {saveState}
      </span>
      <span data-editor-status-selection>Selection {selectionSummary}</span>
      <span data-editor-status-cursor>
        Cursor X {formatCoordinate(previewCursorPoint?.x)} Y {formatCoordinate(previewCursorPoint?.y)}
      </span>
      <span data-editor-status-moves>Moves {moveCount}</span>
      {operationCount !== null && (
        <span data-editor-status-operations>Operations {operationCount}</span>
      )}
      {contourCount !== null && (
        <span data-editor-status-contours>Contours {contourCount}</span>
      )}
      {segmentCount !== null && (
        <span data-editor-status-segments>Segments {segmentCount}</span>
      )}
      {documentContext === 'machine-program' && programLineCount !== null && (
        <span data-editor-program-lines>Program Lines {programLineCount}</span>
      )}
      <span data-editor-status-diagnostics>Diagnostics {diagnosticCount}</span>
      <span data-editor-status-machine>Machine {machineProfileName ?? '—'}</span>
      <span data-editor-status-machine-fit>Fit {formatMachineFit(machineFitStatus)}</span>
      {unitSummary && <span data-editor-status-units>Units {unitSummary}</span>}
    </footer>
  );
}

function formatCoordinate(value: number | undefined) {
  if (value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatMachineFit(status: MachineFitStatus | null) {
  if (status === 'fits') return 'Fits';
  if (status === 'too-large') return 'Too large';
  return 'Unchecked';
}
