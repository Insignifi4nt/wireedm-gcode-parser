import type { SiteToolActivityState } from './siteTools';

/** Small shared indicator; arguments and document contents never enter its history. */
export function AgentActivity({ activity }: { activity: SiteToolActivityState }) {
  if (activity.registration === 'unsupported') return null;
  if (activity.registration === 'failed') return <span className="text-xs text-destructive" role="status">Agent tools unavailable</span>;
  const running = activity.calls.filter(call => call.phase === 'running');
  const latest = running[0] ?? activity.calls[0];
  const preparing = activity.registration === 'pending' && running.length === 0;
  if (!latest) return <span className="text-xs text-muted-foreground" role="status" aria-live="polite">{preparing ? 'Preparing agent tools' : 'Agent tools ready'}</span>;
  const label = latest.toolName.replace(/^edm_/, '').replaceAll('_', ' ');
  const status = latest.phase === 'running' ? 'Running' : latest.phase === 'succeeded' ? 'Done' : latest.phase === 'cancelled' ? 'Cancelled' : 'Failed';
  return <details className="relative text-xs text-muted-foreground">
    <summary className="max-w-60 cursor-pointer truncate" aria-label="Agent activity" role="status" aria-live="polite">{preparing ? 'Preparing agent tools' : <>Agent: {status.toLowerCase()} · {label}{running.length > 1 ? ` (+${running.length - 1})` : ''}</>}</summary>
    <div className="absolute right-0 top-full z-50 mt-1 w-80 border border-border bg-background p-2 shadow-md" aria-label="Recent agent actions">
      <p className="mb-2 text-foreground">Recent agent actions</p>
      <ol className="space-y-2">{activity.calls.map(call => <li key={call.id}>
        <span className={call.phase === 'failed' ? 'text-destructive' : 'text-foreground'}>{call.toolName.replace(/^edm_/, '').replaceAll('_', ' ')} · {call.phase}</span>
        {call.errorCode && <span className="ml-1 font-mono text-[10px]">{call.errorCode}</span>}
        {call.message && <p className="mt-0.5 break-words">{call.message}</p>}
      </li>)}</ol>
    </div>
  </details>;
}
