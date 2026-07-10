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
  selectionSummary
}: EditorStatusBarProps) {
  const saveState = isSaving ? 'Saving' : hasUnsavedChanges ? 'Modified' : 'Saved';

  return (
    <footer
      className="flex h-6 shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-border bg-card/95 px-2 font-mono text-[9px] text-muted-foreground"
      data-editor-status-bar
    >
      <span>{DOCUMENT_CONTEXT_LABELS[documentContext]}</span>
      <span data-editor-document-state={saveState.toLowerCase()}>{saveState}</span>
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
