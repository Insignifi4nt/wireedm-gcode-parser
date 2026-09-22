import type { SiteToolActivityState } from './siteTools';

/** Inline panel content; arguments and document contents never enter its history. */
export function AgentActivity({ activity }: { activity: SiteToolActivityState }) {
  const running = activity.calls.filter(call => call.phase === 'running');
  const latest = running[0] ?? activity.calls[0];
  const preparing = activity.registration === 'pending' && running.length === 0;
  const unavailable = activity.registration === 'unsupported' || activity.registration === 'failed';
  const label = latest?.toolName.replace(/^edm_/, '').replaceAll('_', ' ');
  const status = latest?.phase === 'running' ? 'running' : latest?.phase === 'succeeded' ? 'done' : latest?.phase === 'cancelled' ? 'cancelled' : 'failed';
  return <section className="min-w-0 text-xs text-muted-foreground" aria-label="Agent activity">
    <p className={`break-words ${unavailable ? 'text-muted-foreground' : 'text-foreground'}`} role="status" aria-live="polite">
      {running.length > 0 ? <>Agent: running · {label}{running.length > 1 ? ` (+${running.length - 1})` : ''}</>
        : unavailable ? 'Agent tools unavailable' : preparing ? 'Preparing agent tools'
          : latest ? <>Agent: {status} · {label}</> : 'Agent tools ready'}
    </p>
    {activity.registration === 'unsupported' && <p className="mt-2 leading-5">This browser does not support WebMCP agent tools. The ordinary app controls remain available.</p>}
    {activity.registration === 'failed' && <p className="mt-2 leading-5">Agent tools could not be registered. Reload the page to retry; the ordinary app controls remain available.</p>}
    {activity.calls.length > 0 && <div className="mt-3 border-t border-border pt-2" aria-label="Recent agent actions">
      <p className="mb-2 text-[10px] uppercase text-muted-foreground">Recent agent actions</p>
      <ol className="space-y-2">{activity.calls.map(call => <li key={call.id} className="break-words border border-border bg-background/50 p-2">
        <span className={call.phase === 'failed' ? 'text-destructive' : 'text-foreground'}>{call.toolName.replace(/^edm_/, '').replaceAll('_', ' ')} · {call.phase}</span>
        {call.errorCode && <span className="ml-1 break-all font-mono text-[10px]">{call.errorCode}</span>}
        {call.message && <p className="mt-0.5 break-words">{call.message}</p>}
      </li>)}</ol>
    </div>}
  </section>;
}
