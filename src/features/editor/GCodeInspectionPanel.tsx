import { useState } from 'react';
import type { GCodeProgramInspection } from '@/domain/editor/gcodeInspectionTypes';

export interface GCodeInspectionProvenance { readonly label: string; readonly value: string }

export function GCodeInspectionPanel({ inspection, selectedLine, provenance = [], onSelectLine, onSelectCommand }: {
  inspection: GCodeProgramInspection;
  selectedLine: number;
  provenance?: readonly GCodeInspectionProvenance[];
  onSelectLine: (line: number) => void;
  onSelectCommand: (code: string) => void;
}) {
  const [tab, setTab] = useState<'line' | 'commands' | 'issues' | 'context'>('line');
  const [commandPage, setCommandPage] = useState(0);
  const commandPageCount = Math.max(1, Math.ceil(inspection.commands.length / 100));
  const activeCommandPage = Math.min(commandPage, commandPageCount - 1);
  const line = inspection.lines[selectedLine - 1];
  return <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-t border-border" aria-label="G-code inspection details">
    <div className="flex flex-wrap gap-1 border-b border-border p-1" aria-label="Inspection sections">
      {(['line', 'commands', 'issues', 'context'] as const).map((id) => <button key={id} type="button"
        aria-pressed={tab === id} onClick={() => setTab(id)}
        className={`px-2 py-1 text-[11px] capitalize outline-none focus-visible:ring-1 focus-visible:ring-ring ${tab === id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'}`}>
        {id === 'line' ? `Line ${selectedLine}` : id === 'commands' ? `Commands (${inspection.commands.length})` : id === 'issues' ? `Issues (${inspection.diagnostics.length})` : 'Context'}
      </button>)}
    </div>
    <div className="work-region-scrollbar min-h-0 overflow-auto p-3 text-[11px]">
      {tab === 'line' && line && <>
        <code className="block whitespace-pre-wrap break-all border border-border bg-background p-2">{line.text || '(blank line)'}</code>
        <p className="my-2 text-muted-foreground">{line.previewStatus === 'motion' ? 'Nominal XY motion' : line.previewStatus === 'position' ? 'Coordinate position' : line.previewStatus === 'omitted' ? 'Omitted from XY preview' : 'No modeled XY motion'} · source line {line.line}</p>
        <table className="w-full text-left" aria-label={`Modal state at line ${line.line}`}>
          <thead className="text-muted-foreground"><tr><th className="pb-1 font-normal">State</th><th className="pb-1 font-normal">Before</th><th className="pb-1 font-normal">After</th></tr></thead>
          <tbody>{[
            ['Units in source', line.before.units ?? 'Undeclared', line.after.units ?? 'Undeclared'],
            ['XY mode', line.before.xyMode, line.after.xyMode],
            ['Arc centers I/J', line.before.ijMode, line.after.ijMode],
            ['Motion', line.before.motion ?? 'None', line.after.motion ?? 'None'],
            ['Plane', line.before.plane, line.after.plane],
            ['Compensation', line.before.compensation, line.after.compensation],
            ['X', line.before.positionKnown ? number(line.before.position.x) : 'Unknown', line.after.positionKnown ? number(line.after.position.x) : 'Unknown'],
            ['Y', line.before.positionKnown ? number(line.before.position.y) : 'Unknown', line.after.positionKnown ? number(line.after.position.y) : 'Unknown']
          ].map(([label, before, after]) => <tr key={label} className="border-t border-border/50"><th className="py-1 pr-2 font-normal text-muted-foreground">{label}</th><td className="pr-2">{before}</td><td>{after}</td></tr>)}</tbody>
        </table>
        <p className="mt-2 text-muted-foreground">Positions use millimetres when units are known; otherwise source values. State describes only the supported preview subset. Compensation is an annotation, not an offset applied to the path.</p>
        {line.diagnostics.map((issue, index) => <p className="mt-2 border-l-2 border-amber-500 pl-2" key={index}>{issue.message}</p>)}
      </>}
      {tab === 'commands' && <>
        <p className="mb-2 text-muted-foreground">Select a command to show its occurrences in source order. Recognition does not mean the controller behavior is simulated.</p>
        {inspection.commands.slice(activeCommandPage * 100, (activeCommandPage + 1) * 100).map((command) => <button className="block w-full border-t border-border py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring"
          type="button" key={command.code} onClick={() => onSelectCommand(command.code)} aria-label={`Inspect ${command.code} occurrences`}>
          <span className="flex justify-between gap-2"><strong className="font-mono">{command.code} <span className="font-normal text-muted-foreground">×{command.count}</span></strong>
            <span className={command.coverage === 'modeled' ? 'text-muted-foreground' : 'text-amber-300'}>{coverageLabel(command.coverage)}</span></span>
          <span className="mt-1 block">{command.meaning}</span><span className="mt-1 block text-[10px] text-muted-foreground">{command.scope}</span>
        </button>)}
        {inspection.commands.length === 0 && <p>No G/M words found.</p>}
        {commandPageCount > 1 && <div className="mt-2 flex items-center justify-between gap-2">
          <button type="button" className="border border-border px-2 py-1 disabled:opacity-40" disabled={activeCommandPage === 0} onClick={() => setCommandPage(activeCommandPage - 1)}>Previous commands</button>
          <span>{activeCommandPage + 1} / {commandPageCount}</span>
          <button type="button" className="border border-border px-2 py-1 disabled:opacity-40" disabled={activeCommandPage + 1 >= commandPageCount} onClick={() => setCommandPage(activeCommandPage + 1)}>Next commands</button>
        </div>}
      </>}
      {tab === 'issues' && <>
        <p className="mb-2 text-muted-foreground">These are interpretation limits and text diagnostics, not a controller approval report.</p>
        {inspection.diagnostics.slice(0, 200).map((issue, index) => <button type="button" key={index} disabled={issue.line < 1}
          onClick={() => onSelectLine(issue.line)} className="block w-full border-t border-border py-2 text-left outline-none hover:bg-accent/40 focus-visible:ring-1 focus-visible:ring-ring">
          <span className={issue.type === 'error' ? 'text-destructive' : 'text-amber-300'}>{issue.type} · {issue.line > 0 ? `Line ${issue.line}` : 'Program'}</span>
          <span className="mt-1 block">{issue.message}</span>
        </button>)}
        {inspection.diagnostics.length > 200 && <p className="mt-2">Showing the first 200 issues. Select other source lines to inspect their diagnostics.</p>}
        {inspection.diagnostics.length === 0 && <p>No text diagnostics in the supported subset.</p>}
      </>}
      {tab === 'context' && <>
        <h3 className="mb-2 font-semibold">Interpretation assumptions</h3>
        <ul className="list-disc space-y-1 pl-4">{inspection.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
        <h3 className="mb-2 mt-4 font-semibold">Source</h3>
        {provenance.length ? <dl className="space-y-2">{provenance.map(({ label, value }, index) => <div key={index}><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>)}</dl>
          : <p>Standalone text inspection. No UPID project or installed post is associated with this program.</p>}
        <p className="mt-3 text-muted-foreground">Change geometry and machining intent in the UPID editor, then generate and inspect a new saved revision. This view never changes the source text.</p>
      </>}
    </div>
  </section>;
}

function number(value: number) { return Number.isFinite(value) ? Number(value.toFixed(6)).toString() : 'Unknown'; }
function coverageLabel(value: string) {
  return value === 'modeled' ? 'Modeled subset' : value === 'recognized-not-modeled' ? 'Not modeled'
    : value === 'controller-specific' ? 'Controller specific' : 'Unknown';
}
