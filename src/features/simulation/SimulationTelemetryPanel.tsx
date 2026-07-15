import { sampleSimulationCursor, type SimulationTimeline } from '@/domain/simulation/simulationTimeline';

export interface SimulationTelemetryPanelProps {
  timeline: SimulationTimeline;
  progress: number;
}

export function SimulationTelemetryPanel({ timeline, progress }: SimulationTelemetryPanelProps) {
  const cursor = sampleSimulationCursor(timeline, progress);
  const operation = cursor.operationId
    ? timeline.operations.find((candidate) => candidate.operationId === cursor.operationId)
    : null;

  return (
    <aside
      aria-labelledby="simulation-telemetry-title"
      className="min-h-0 overflow-auto border-l border-border bg-card/95"
      data-simulation-telemetry
    >
      <div className="border-b border-border px-3 py-2.5">
        <p className="text-[9px] uppercase tracking-[0.12em] text-muted-foreground">Live trace</p>
        <h2 className="mt-1 text-xs font-semibold" id="simulation-telemetry-title">Telemetry</h2>
      </div>

      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 border-b border-border p-3 text-[10px]">
        <TelemetryValue label="State" value={cursor.kind ? cursor.kind.toUpperCase() : 'READY'} />
        <TelemetryValue label="Operation" value={operation?.displayName ?? cursor.operationId ?? '—'} />
        <TelemetryValue label="Command" value={cursor.command ?? '—'} />
        <TelemetryValue label="Reason" value={cursor.reason ?? '—'} />
        <TelemetryValue label="Program line" value={cursor.programLineNumber === null ? '—' : `N${cursor.programLineNumber}`} />
        <TelemetryValue label="X position" value={millimetres(cursor.point?.x)} />
        <TelemetryValue label="Y position" value={millimetres(cursor.point?.y)} />
        <TelemetryValue label="Traveled" value={`${cursor.distanceMm.toFixed(2)} / ${timeline.totalDistanceMm.toFixed(2)} mm`} />
        <TelemetryValue label="Progress" value={`${(cursor.progress * 100).toFixed(1)}%`} />
      </dl>

      <div className="p-3">
        <h3 className="mb-2 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          Operation sequence
        </h3>
        {timeline.operations.length > 0 ? (
          <ol className="grid gap-1.5">
            {timeline.operations.map((item, index) => {
              const active = item.operationId === cursor.operationId;
              return (
                <li
                  className={`border px-2 py-1.5 text-[9px] ${active ? 'border-primary/60 bg-primary/10 text-foreground' : 'border-border text-muted-foreground'}`}
                  key={item.operationId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{index + 1}. {item.displayName}</span>
                    <span className="font-mono">{item.endDistanceMm.toFixed(1)} mm</span>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-[9px] text-muted-foreground">No posted operations.</p>
        )}
      </div>
    </aside>
  );
}

function TelemetryValue({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="technical-value max-w-36 truncate text-right font-mono text-foreground" title={value}>{value}</dd>
    </>
  );
}

function millimetres(value: number | undefined) {
  return value === undefined ? '—' : `${value.toFixed(3)} mm`;
}
