import { useEffect, useLayoutEffect, useRef } from 'react';
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
  constructor(readonly code: string, message: string) { super(message); }
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
        if (!Value.Check(inputSchema, input)) throw new ToolError('INVALID_ARGUMENT', 'Arguments must match the tool schema.');
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
          : error instanceof ToolError ? { code: error.code, message: error.message }
          : { code: 'OPERATION_FAILED', message: 'Operation failed. Review the page or retry with corrected inputs.' } };
      }
    }
  };
}

/** Registration lifetime and execution cancellation are separate in current WebMCP. */
export function registerSiteTools(context: ModelContext, tools: readonly SiteTool[]) {
  const lifetime = new AbortController();
  const running = new Set<AbortController>();
  const ready = (async () => {
    for (const tool of tools) {
      if (lifetime.signal.aborted) return;
      await context.registerTool({ ...tool, execute: async (input, options) => {
        const call = new AbortController();
        const abort = () => call.abort();
        if (lifetime.signal.aborted || options?.signal?.aborted) call.abort();
        options?.signal?.addEventListener('abort', abort, { once: true });
        running.add(call);
        try { return await tool.execute(input, { signal: call.signal }); }
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
  useLayoutEffect(() => { latest.current = tools; });
  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (typeof context?.registerTool !== 'function') return;
    const registration = registerSiteTools(context, latest.current.map((tool) => ({ ...tool,
      execute: (input, options) => {
        const current = latest.current.find(({ name }) => name === tool.name);
        return current ? current.execute(input, options) : Promise.resolve({ ok: false, error: { code: 'UNAVAILABLE', message: 'Tool is no longer available.' } });
      }
    })));
    void registration.ready.catch(() => { console.warn('Site tools could not be registered; the normal interface remains available.'); });
    return registration.dispose;
  }, []);
}
