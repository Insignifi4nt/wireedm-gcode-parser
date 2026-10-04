import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { inspectGCodeProgram } from '@/domain/editor/gcodeInspection';
import type { GCodeInspectionOptions } from '@/domain/editor/gcodeInspectionTypes';
import { EditorPreview } from './EditorPreview';
import { GCodeInspectionPanel, type GCodeInspectionDetailView, type GCodeInspectionProvenance } from './GCodeInspectionPanel';

const PAGE_SIZE = 150;
const MAX_PREVIEW_ITEMS = 10_000;

export function GCodeInspectionWorkspace({ text, options, provenance }: {
  text: string;
  options?: GCodeInspectionOptions;
  provenance?: readonly GCodeInspectionProvenance[];
}) {
  const [defaults, setDefaults] = useState(options?.defaults);
  const [profile, setProfile] = useState(options?.profile ?? 'neutral');
  const inspection = useMemo(() => inspectGCodeProgram(text, { ...options, profile, defaults }), [text, options, profile, defaults]);
  const [selectedLine, setSelectedLine] = useState(1);
  const [query, setQuery] = useState('');
  const [commandFilter, setCommandFilter] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [page, setPage] = useState(0);
  const [lineInput, setLineInput] = useState('1');
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [companionView, setCompanionView] = useState<'preview' | GCodeInspectionDetailView>('preview');
  const [compactView, setCompactView] = useState<'code' | 'companion'>('code');
  const [compactLayout, setCompactLayout] = useState(() => window.matchMedia?.('(max-width: 767px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 767px)');
    if (!media) return;
    const update = () => setCompactLayout(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const lineList = useRef<HTMLDivElement>(null);
  const focusSelectedLine = useRef(false);
  const pinnedContext = Boolean(options?.lineContexts?.length);
  const filteredLines = useMemo(() => {
    const search = query.trim().toLowerCase();
    return inspection.lines.filter((line) =>
      (!search || line.text.toLowerCase().includes(search)) &&
      (!commandFilter || line.commands.includes(commandFilter)) &&
      (!onlyIssues || line.diagnostics.length > 0));
  }, [inspection.lines, query, commandFilter, onlyIssues]);
  const pageCount = Math.max(1, Math.ceil(filteredLines.length / PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const visibleLines = filteredLines.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const focusableLine = visibleLines.some((line) => line.line === selectedLine) ? selectedLine : visibleLines[0]?.line;
  const previewLimited = inspection.parseResult.path.length > MAX_PREVIEW_ITEMS;
  const previewResult = useMemo(() => previewLimited
    ? { ...inspection.parseResult, path: inspection.parseResult.path.slice(0, MAX_PREVIEW_ITEMS) }
    : inspection.parseResult, [inspection.parseResult, previewLimited]);

  function selectLine(line: number, reveal = false) {
    setSelectedLine(line);
    setLineInput(String(line));
    setNavigationError(null);
    if (reveal) {
      setCompactView('code');
      focusSelectedLine.current = true;
      setQuery(''); setCommandFilter(null); setOnlyIssues(false);
      setPage(Math.floor((line - 1) / PAGE_SIZE));
    } else {
      const index = filteredLines.findIndex((candidate) => candidate.line === line);
      if (index >= 0) setPage(Math.floor(index / PAGE_SIZE));
    }
  }
  useEffect(() => {
    const row = lineList.current?.querySelector<HTMLButtonElement>(`[data-inspection-line="${selectedLine}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
    if (focusSelectedLine.current && row) {
      row.focus();
      focusSelectedLine.current = false;
    }
  }, [selectedLine, activePage, query, commandFilter, onlyIssues, compactView]);

  const settings = <div className="mb-4 grid gap-3 border-b border-border pb-4">
      <div><h3 className="font-semibold">Preview settings</h3>
        <p className="mt-1 text-muted-foreground">{pinnedContext ? 'Pinned post context; these saved assumptions cannot be changed here.' : 'Program declarations take precedence. These assumptions only affect this read-only view.'}</p></div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex items-center gap-1">Source
        <select aria-label="Inspection source interpreter" value={profile} disabled={pinnedContext}
          className="h-7 border border-border bg-background px-1" onChange={(event) => setProfile(event.currentTarget.value as typeof profile)}>
          <option value="neutral">Generic G-code</option><option value="legacy-robofil">Legacy Robofil</option>
        </select>
      </label>
      <label className="flex items-center gap-1">Initial units
        <select aria-label="Inspection initial units" value={defaults?.units ?? ''} disabled={pinnedContext}
          className="h-7 border border-border bg-background px-1"
          onChange={(event) => setDefaults({ ...defaults, units: event.currentTarget.value as 'mm' | 'in' || undefined })}>
          <option value="">Undeclared</option><option value="mm">mm</option><option value="in">inch</option>
        </select>
      </label>
      <label className="flex items-center gap-1">Initial X/Y
        <select aria-label="Inspection initial XY mode" value={defaults?.xyMode ?? 'absolute'} disabled={pinnedContext}
          className="h-7 border border-border bg-background px-1"
          onChange={(event) => setDefaults({ ...defaults, xyMode: event.currentTarget.value as 'absolute' | 'incremental' })}>
          <option value="absolute">Absolute</option><option value="incremental">Incremental</option>
        </select>
      </label>
      <label className="flex items-center gap-1">Initial I/J
        <select aria-label="Inspection initial IJ mode" value={defaults?.ijMode ?? 'incremental'} disabled={pinnedContext}
          className="h-7 border border-border bg-background px-1"
          onChange={(event) => setDefaults({ ...defaults, ijMode: event.currentTarget.value as 'absolute' | 'incremental' })}>
          <option value="incremental">Incremental</option><option value="absolute">Absolute</option>
        </select>
      </label>
      </div>
    </div>;

  return <div className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden" data-gcode-inspection-workspace data-compact-active-pane={compactView === 'code' ? 'code' : companionView}>
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11px]" role="status">
      <strong className={inspection.preview.status === 'complete' ? '' : 'text-amber-300'}>{inspection.preview.status === 'complete' ? 'Nominal XY preview' : inspection.preview.status === 'limited' ? 'Limited XY preview' : 'XY preview unavailable'}</strong>
      <span className="text-muted-foreground">Line {selectedLine} / {inspection.lines.length} · {pinnedContext ? 'Pinned post context' : profile === 'neutral' ? 'Generic G-code' : 'Legacy Robofil'}</span>
      {previewLimited && <p className="mt-1 text-amber-300">Rendering the first {MAX_PREVIEW_ITEMS.toLocaleString()} path items only. All source lines remain available.</p>}
    </div>
    <div className="flex min-w-0 flex-wrap gap-1 border-b border-border px-2 py-1" aria-label="Inspection views">
      <button type="button" aria-pressed={compactView === 'code'} onClick={() => setCompactView('code')}
        className={`px-2 py-1 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring md:hidden ${compactView === 'code' ? 'bg-accent' : 'text-muted-foreground'}`}>Code</button>
      {(['preview', 'line', 'commands', 'issues', 'context'] as const).map(view => <button type="button" key={view}
        aria-pressed={companionView === view && (!compactLayout || compactView === 'companion')} onClick={() => { setCompanionView(view); setCompactView('companion'); }}
        className={`px-2 py-1 text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-ring ${companionView === view && (!compactLayout || compactView === 'companion') ? 'bg-accent' : 'text-muted-foreground hover:bg-accent/50'}`}>
        {view === 'preview' ? 'Preview' : view === 'line' ? `Line ${selectedLine}` : view === 'commands' ? `Commands (${inspection.commands.length})` : view === 'issues' ? `Issues (${inspection.diagnostics.length})` : 'Context'}
      </button>)}
    </div>
    <div className="grid min-h-0 min-w-0 grid-cols-1 overflow-hidden md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className={`${compactView === 'code' ? 'grid' : 'hidden md:grid'} min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden md:border-r md:border-border`} aria-label="G-code source" aria-hidden={compactLayout && compactView !== 'code'} data-inspection-source-pane>
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-2 text-[11px]">
          <input aria-label="Search G-code source" className="h-7 min-w-20 flex-1 border border-border bg-background px-2" placeholder="Find text…" value={query}
            onChange={(event) => { setQuery(event.currentTarget.value); setPage(0); }} />
          <label className="flex items-center gap-1"><input type="checkbox" checked={onlyIssues} onChange={(event) => { setOnlyIssues(event.currentTarget.checked); setPage(0); }} />Issues only</label>
          <form className="flex items-center gap-1" onSubmit={(event) => {
            event.preventDefault();
            const line = Number(lineInput);
            if (!Number.isInteger(line) || line < 1 || line > inspection.lines.length) {
              setNavigationError(`Enter a source line from 1 to ${inspection.lines.length}.`); return;
            }
            selectLine(line, true);
          }}>
            <input aria-label="Go to source line" inputMode="numeric" className="h-7 w-16 border border-border bg-background px-2" value={lineInput} onChange={(event) => setLineInput(event.currentTarget.value)} />
            <Button size="sm" variant="outline" type="submit" className="h-7 px-2">Go</Button>
          </form>
          {commandFilter && <button className="text-sky-300" onClick={() => { setCommandFilter(null); setPage(0); }} type="button">{commandFilter} occurrences · clear</button>}
          {navigationError && <p className="w-full text-destructive" role="alert">{navigationError}</p>}
        </div>
        <div ref={lineList} className="work-region-scrollbar min-h-0 overflow-auto bg-background/60" aria-label="Source lines">
          {visibleLines.map((line) => <button type="button" key={line.line} data-inspection-line={line.line}
            aria-label={`Source line ${line.line}: ${line.text || 'blank'}`} aria-pressed={selectedLine === line.line}
            tabIndex={line.line === focusableLine ? 0 : -1}
            className={`flex min-h-6 min-w-full gap-3 px-2 py-0.5 text-left font-mono text-[11px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${selectedLine === line.line ? 'bg-sky-500/20' : 'hover:bg-accent/50'}`}
            onClick={() => selectLine(line.line)} onKeyDown={(event) => {
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const index = filteredLines.findIndex((candidate) => candidate.line === line.line);
              const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? filteredLines.length - 1
                : Math.max(0, Math.min(filteredLines.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
              const target = filteredLines[targetIndex];
              if (target && target.line !== line.line) { focusSelectedLine.current = true; selectLine(target.line); }
            }}>
            <span className={`sticky left-0 w-12 shrink-0 text-right ${line.diagnostics.length ? 'text-amber-300' : 'text-muted-foreground'}`}>{line.line}{line.diagnostics.length ? ' •' : ''}</span>
            <code className="whitespace-pre">{line.text || ' '}</code>
          </button>)}
          {visibleLines.length === 0 && <p className="p-3 text-xs text-muted-foreground">No matching source lines. Clear the search or filters to see the program.</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-2 text-[10px] text-muted-foreground">
          <span>{filteredLines.length} / {inspection.lines.length} lines · ↑↓ browse</span>
          <div className="flex items-center gap-2"><Button size="sm" variant="outline" className="h-6 px-2" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous</Button>
            <span>{activePage + 1} / {pageCount}</span><Button size="sm" variant="outline" className="h-6 px-2" disabled={activePage + 1 >= pageCount} onClick={() => setPage(activePage + 1)}>Next</Button></div>
        </div>
      </section>
      <div className={`${compactView === 'companion' ? 'grid' : 'hidden md:grid'} min-h-0 min-w-0 overflow-hidden`} aria-hidden={compactLayout && compactView !== 'companion'} data-inspection-companion-pane>
        <div className={`${companionView === 'preview' ? 'grid' : 'hidden'} min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden [&>div]:min-h-0`} aria-hidden={companionView !== 'preview'} data-inspection-preview-pane>
          <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">{inspection.preview.summary}</p>
        <EditorPreview program={null} parseResult={previewResult} hoveredLine={null} measurementPoints={[]} pinnedLines={[]}
          selectedLines={[selectedLine]} onLineSelect={(line) => selectLine(line, true)} keyboardShortcutsEnabled={false}
          previewTitle="Nominal XY" previewLabel="Inspected G-code XY preview" />
        </div>
        <div className={`${companionView === 'preview' ? 'hidden' : 'grid'} min-h-0 min-w-0 overflow-hidden`} aria-hidden={companionView === 'preview'}>
        <GCodeInspectionPanel inspection={inspection} selectedLine={selectedLine} view={companionView === 'preview' ? 'line' : companionView} settings={settings} provenance={provenance}
          onSelectLine={(line) => selectLine(line, true)} onSelectCommand={(code) => {
            setCommandFilter(code); setQuery(''); setOnlyIssues(false); setPage(0);
            setCompactView('code');
            focusSelectedLine.current = true;
            const first = inspection.commands.find((command) => command.code === code)?.sourceLines[0];
            if (first) { setSelectedLine(first); setLineInput(String(first)); }
          }} />
        </div>
      </div>
    </div>
  </div>;
}
