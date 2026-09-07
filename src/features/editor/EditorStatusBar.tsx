import type { PhysicalMachineFitResult } from '@/domain/machine-definition/machineFit';

interface EditorStatusBarProps {
  coordinateUnits: 'mm' | 'in' | null;
  diagnosticCount: number;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  machineFit: PhysicalMachineFitResult | null;
  onOpenDiagnostics: () => void;
  previewCursorPoint: { x: number; y: number } | null;
  selectionSummary: string;
}

export function EditorStatusBar({
  coordinateUnits,
  diagnosticCount,
  hasUnsavedChanges,
  isSaving,
  machineFit,
  onOpenDiagnostics,
  previewCursorPoint,
  selectionSummary
}: EditorStatusBarProps) {
  const saveState = isSaving ? 'Saving' : hasUnsavedChanges ? 'Unsaved' : 'Saved';
  const fitWarning = getMachineFitWarning(machineFit);

  return (
    <footer
      className="technical-value flex min-h-6 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-card/95 px-2 py-1 text-[10px] text-muted-foreground"
      data-editor-status-bar
    >
      <span
        aria-atomic="true"
        aria-live="polite"
        data-editor-document-state={saveState.toLowerCase()}
        role="status"
      >
        {saveState}
      </span>
      <span className="min-w-0 break-words" data-editor-status-selection>Selection {selectionSummary}</span>
      <span data-editor-status-cursor>
        Cursor X {formatCoordinate(previewCursorPoint?.x)} Y {formatCoordinate(previewCursorPoint?.y)}
        {coordinateUnits && <> <span data-editor-status-units>{coordinateUnits}</span></>}
      </span>
      {diagnosticCount > 0 && (
        <button
          className="text-amber-200 underline decoration-amber-200/40 underline-offset-2 hover:decoration-amber-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
          data-editor-status-diagnostics
          onClick={onOpenDiagnostics}
          title="Open diagnostics"
          type="button"
        >
          Diagnostics {diagnosticCount}
        </button>
      )}
      {fitWarning && (
        <span className="min-w-0 break-words text-amber-200" data-editor-status-machine-fit role="status">
          {fitWarning}
        </span>
      )}
    </footer>
  );
}

function formatCoordinate(value: number | undefined) {
  if (value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function getMachineFitWarning(result: PhysicalMachineFitResult | null): string | null {
  if (!result) return null;
  if (!result.ok) {
    return result.error.code === 'MACHINE_FIT_GEOMETRY_EMPTY' ? null : result.error.message;
  }
  switch (result.fit.status) {
    case 'too-large': return 'Fit Too large';
    case 'indeterminate': return 'Fit Indeterminate';
    case 'fits':
    case 'not-evaluated': return null;
    default: {
      const exhaustive: never = result.fit;
      return exhaustive;
    }
  }
}
