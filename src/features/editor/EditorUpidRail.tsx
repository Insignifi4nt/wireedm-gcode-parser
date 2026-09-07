import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

import type { UpidEditorTree } from '@/domain/upid/upidEditorTree';

export type EditorUpidRailMode = 'program' | 'geometry';

export interface EditorUpidRailProps {
  collapsed: boolean;
  geometryContent: ReactNode;
  mode: EditorUpidRailMode;
  onCollapseChange: (collapsed: boolean) => void;
  onModeChange: (mode: EditorUpidRailMode) => void;
  programContent: ReactNode;
  selectedOperationOrdinal: number | null;
  status: UpidEditorTree['status'];
}

export function EditorUpidRail({
  collapsed,
  geometryContent,
  mode,
  onCollapseChange,
  onModeChange,
  programContent,
  selectedOperationOrdinal,
  status
}: EditorUpidRailProps) {
  const railId = useId();
  const tabIds: Record<EditorUpidRailMode, string> = {
    program: `editor-upid-rail-${railId}-tab-program`,
    geometry: `editor-upid-rail-${railId}-tab-geometry`
  };
  const panelIds: Record<EditorUpidRailMode, string> = {
    program: `editor-upid-rail-${railId}-panel-program`,
    geometry: `editor-upid-rail-${railId}-panel-geometry`
  };
  const tabRefs = useRef<Record<EditorUpidRailMode, HTMLButtonElement | null>>({
    program: null,
    geometry: null
  });

  function selectLens(nextMode: EditorUpidRailMode) {
    onModeChange(nextMode);
    tabRefs.current[nextMode]?.focus();
  }

  function handleLensKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentMode = event.currentTarget.id === tabIds.program ? 'program' : 'geometry';
    let nextMode: EditorUpidRailMode | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextMode = currentMode === 'program' ? 'geometry' : 'program';
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextMode = currentMode === 'program' ? 'geometry' : 'program';
    }
    if (event.key === 'Home') nextMode = 'program';
    if (event.key === 'End') nextMode = 'geometry';
    if (!nextMode) return;

    event.preventDefault();
    selectLens(nextMode);
  }

  if (collapsed) {
    const nextMode = mode === 'program' ? 'geometry' : 'program';
    return (
      <aside
        aria-label="Collapsed UPID rail"
        className="flex w-9 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-1 text-[10px]"
        data-editor-upid-rail
      >
        <button
          aria-label="Expand UPID rail"
          className="flex size-7 items-center justify-center outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onCollapseChange(false)}
          title="Expand UPID rail"
          type="button"
        >
          <span aria-hidden="true">›</span>
        </button>
        <button
          aria-label={`Switch to ${nextMode === 'geometry' ? 'Geometry' : 'Program'} lens`}
          className="flex size-6 items-center justify-center border border-border font-semibold outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onModeChange(nextMode)}
          title={`${formatMode(mode)} lens`}
          type="button"
        >
          {mode === 'program' ? 'P' : 'G'}
        </button>
        <span
          aria-label={`Program status: ${formatStatus(status)}`}
          className={`size-2 rounded-full ${statusColor(status)}`}
          role="img"
          title={`Program status: ${formatStatus(status)}`}
        />
        {selectedOperationOrdinal === null ? null : (
          <span
            aria-label={`Selected operation ${selectedOperationOrdinal}`}
            className="technical-value text-[10px] text-muted-foreground"
            title={`Selected operation ${selectedOperationOrdinal}`}
          >
            {String(selectedOperationOrdinal).padStart(2, '0')}
          </span>
        )}
      </aside>
    );
  }

  return (
    <aside
      aria-label="UPID rail"
      className="grid h-full min-h-0 w-full shrink-0 grid-rows-[auto_minmax(0,1fr)] border-r border-border bg-card text-[11px]"
      data-editor-upid-rail
    >
      <div className="flex h-8 items-center border-b border-border px-1">
        <div aria-label="UPID rail lens" className="flex min-w-0 flex-1" role="tablist">
          <button
            aria-label="Program lens"
            aria-controls={panelIds.program}
            aria-selected={mode === 'program'}
            className={`px-2 py-1 ${mode === 'program' ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            id={tabIds.program}
            onClick={() => onModeChange('program')}
            onKeyDown={handleLensKeyDown}
            ref={(element) => { tabRefs.current.program = element; }}
            role="tab"
            tabIndex={mode === 'program' ? 0 : -1}
            type="button"
          >
            Program
          </button>
          <button
            aria-label="Geometry lens"
            aria-controls={panelIds.geometry}
            aria-selected={mode === 'geometry'}
            className={`px-2 py-1 ${mode === 'geometry' ? 'bg-accent font-medium' : 'text-muted-foreground hover:text-foreground'}`}
            id={tabIds.geometry}
            onClick={() => onModeChange('geometry')}
            onKeyDown={handleLensKeyDown}
            ref={(element) => { tabRefs.current.geometry = element; }}
            role="tab"
            tabIndex={mode === 'geometry' ? 0 : -1}
            type="button"
          >
            Geometry
          </button>
        </div>
        <button
          aria-label="Collapse UPID rail"
          className="flex size-6 items-center justify-center outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onCollapseChange(true)}
          title="Collapse UPID rail"
          type="button"
        >
          <span aria-hidden="true">‹</span>
        </button>
      </div>
      <div
        aria-labelledby={tabIds.program}
        className="min-h-0 overflow-hidden"
        hidden={mode !== 'program'}
        id={panelIds.program}
        role="tabpanel"
      >
        {programContent}
      </div>
      <div
        aria-labelledby={tabIds.geometry}
        className="min-h-0 overflow-hidden"
        hidden={mode !== 'geometry'}
        id={panelIds.geometry}
        role="tabpanel"
      >
        {geometryContent}
      </div>
    </aside>
  );
}

function formatMode(mode: EditorUpidRailMode) {
  return mode === 'program' ? 'Program' : 'Geometry';
}

function formatStatus(status: UpidEditorTree['status']) {
  return {
    ready: 'Ready',
    invalid: 'Invalid',
    unresolved: 'Unresolved'
  }[status];
}

function statusColor(status: UpidEditorTree['status']) {
  return {
    ready: 'bg-emerald-500',
    invalid: 'bg-red-500',
    unresolved: 'bg-amber-400'
  }[status];
}
