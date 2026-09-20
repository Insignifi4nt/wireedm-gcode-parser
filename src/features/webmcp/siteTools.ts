import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export interface SiteTool {
  name: string;
  description: string;
  inputSchema: TSchema;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}
export interface ModelContext {
  registerTool(tool: SiteTool, options: { signal: AbortSignal }): Promise<void> | void;
}
export class ToolError extends Error {
  constructor(readonly code: string, message: string, readonly details?: Readonly<Record<string, unknown>>) { super(message); }
}
export const object = <T extends Record<string, TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
export const pageFields = {
  offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
};
export function page<T>(rows: readonly T[], input: { offset?: number; limit?: number }) {
  const offset = input.offset ?? 0;
  const end = Math.min(rows.length, offset + (input.limit ?? 10));
  return { items: rows.slice(offset, end), total: rows.length, nextOffset: end < rows.length ? end : null };
}
export function siteTool<S extends TSchema>(
  name: string, description: string, inputSchema: S,
  run: (input: Static<S>, signal: AbortSignal) => unknown | Promise<unknown>,
  readOnlyHint = true
): SiteTool {
  return { name, description, inputSchema, annotations: { readOnlyHint, untrustedContentHint: true },
    async execute(input, options) {
      const signal = options?.signal ?? new AbortController().signal;
      try {
        signal.throwIfAborted();
        if (!Value.Check(inputSchema, input)) {
          const issues = [];
          for (const issue of Value.Errors(inputSchema, input)) {
            issues.push({ path: (issue.path || '/').slice(0, 240), message: issue.message.slice(0, 240) });
            if (issues.length === 5) break;
          }
          throw new ToolError('INVALID_ARGUMENT', 'Arguments must match the tool schema.', { issues });
        }
        const data = await run(input, signal);
        // Once a mutation commits, return its receipt even if cancellation arrived during the write.
        if (readOnlyHint) signal.throwIfAborted();
        const result = { ok: true, data };
        if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 32 * 1024) {
          throw new ToolError('OUTPUT_TOO_LARGE', 'Request fewer rows or use the visible page report for full details.');
        }
        return result;
      } catch (error) {
        return { ok: false, error: signal.aborted ? { code: 'CANCELLED', message: 'Operation cancelled.' }
          : error instanceof ToolError ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
          : { code: 'OPERATION_FAILED', message: 'Operation failed. Review the page or retry with corrected inputs.' } };
      }
    }
  };
}

/** Registration lifetime and execution cancellation are separate in current WebMCP. */
export interface SiteToolActivity {
  readonly id: number;
  readonly toolName: string;
  readonly phase: 'running' | 'succeeded' | 'failed' | 'cancelled';
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly errorCode?: string;
  readonly message?: string;
}

export interface SiteToolActivityState {
  readonly registration: 'unsupported' | 'pending' | 'ready' | 'failed';
  readonly calls: readonly SiteToolActivity[];
}

export function registerSiteTools(context: ModelContext, tools: readonly SiteTool[], onActivity?: (activity: SiteToolActivity) => void) {
  const lifetime = new AbortController();
  const running = new Set<AbortController>();
  let sequence = 0;
  const ready = (async () => {
    for (const tool of tools) {
      if (lifetime.signal.aborted) return;
      await context.registerTool({ ...tool, execute: async (input, options) => {
        const call = new AbortController();
        const abort = () => call.abort();
        if (lifetime.signal.aborted || options?.signal?.aborted) call.abort();
        options?.signal?.addEventListener('abort', abort, { once: true });
        running.add(call);
        const activity = { id: ++sequence, toolName: tool.name, startedAt: Date.now() };
        onActivity?.({ ...activity, phase: 'running' });
        try {
          const result = await tool.execute(input, { signal: call.signal });
          const outcome = activityOutcome(result);
          onActivity?.({ ...activity, ...outcome, completedAt: Date.now() });
          return result;
        } catch (error) {
          onActivity?.({ ...activity, phase: call.signal.aborted ? 'cancelled' : 'failed', completedAt: Date.now(), message: 'Tool execution failed.' });
          throw error;
        }
        finally { running.delete(call); options?.signal?.removeEventListener('abort', abort); }
      } }, { signal: lifetime.signal });
    }
  })();
  const dispose = () => { lifetime.abort(); for (const call of running) call.abort(); };
  return { ready: ready.catch((error: unknown) => { dispose(); throw error; }), dispose };
}

/** Stable registration; callbacks always see the most recently committed React state. */
export function useSiteTools(tools: readonly SiteTool[]) {
  const latest = useRef(tools);
  const [activity, setActivity] = useState<SiteToolActivityState>({ registration: 'unsupported', calls: [] });
  useLayoutEffect(() => { latest.current = tools; });
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (typeof context?.registerTool !== 'function') return;
    let mounted = true;
    setActivity({ registration: 'pending', calls: [] });
    const registration = registerSiteTools(context, latest.current.map((tool) => ({ ...tool,
      execute: (input, options) => {
        const current = latest.current.find(({ name }) => name === tool.name);
        return current ? current.execute(input, options) : Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', message: 'Tool is no longer available.' } });
      }
    })), (call) => {
      if (mounted) setActivity(current => {
        const next = [call, ...current.calls.filter(previous => previous.id !== call.id)];
        return { ...current, calls: [...next.filter(item => item.phase === 'running'), ...next.filter(item => item.phase !== 'running')].slice(0, 8) };
      });
    });
    void registration.ready.then(() => {
      if (mounted) setActivity(current => ({ ...current, registration: 'ready' }));
    }).catch(() => {
      // StrictMode and navigation can dispose a pending registration normally.
      if (!mounted) return;
      setActivity(current => ({ ...current, registration: 'failed' }));
      console.warn('Site tools could not be registered; the normal interface remains available.');
    });
    return () => { mounted = false; registration.dispose(); };
  }, []);
  return activity;
}

function activityOutcome(result: unknown): Pick<SiteToolActivity, 'phase' | 'errorCode' | 'message'> {
  if (!result || typeof result !== 'object') return { phase: 'succeeded' };
  const envelope = result as { ok?: boolean; error?: { code?: unknown; message?: unknown }; data?: { generated?: boolean; error?: { code?: unknown; message?: unknown }; status?: unknown } };
  if (envelope.ok !== false && envelope.data?.status === 'generated-download-not-requested') return {
    phase: 'succeeded', message: 'Controller artifact generated; download was not requested after cancellation.'
  };
  const error = envelope.ok === false ? envelope.error : envelope.data?.generated === false ||
    envelope.data?.status === 'generated-download-failed' || envelope.data?.status === 'captured-download-failed' ? envelope.data.error : undefined;
  if (envelope.ok !== false && !error) return { phase: 'succeeded' };
  return { phase: error?.code === 'CANCELLED' ? 'cancelled' : 'failed',
    ...(typeof error?.code === 'string' ? { errorCode: error.code.slice(0, 160) } : {}),
    ...(typeof error?.message === 'string' ? { message: error.message.slice(0, 500) } : {}) };
}
