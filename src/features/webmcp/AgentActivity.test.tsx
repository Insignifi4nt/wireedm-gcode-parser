import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentActivity } from './AgentActivity';
import { object, siteTool, useSiteTools, type ModelContext, type SiteTool, type SiteToolActivityState } from './siteTools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); Reflect.deleteProperty(document, 'modelContext'); vi.restoreAllMocks(); });

describe('visible agent activity', () => {
  it('reports preparation until every sequential native registration finishes', async () => {
    const acknowledgements = [deferred<void>(), deferred<void>()];
    let nextAcknowledgement = 0;
    const registerTool = vi.fn(() => acknowledgements[nextAcknowledgement++].promise);
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool } satisfies ModelContext });
    function Harness() { return <AgentActivity activity={useSiteTools([
      siteTool('edm_first', 'First', object({}), () => null),
      siteTool('edm_second', 'Second', object({}), () => null)
    ])} />; }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    expect(container.textContent).toBe('Preparing agent tools');
    expect(registerTool).toHaveBeenCalledTimes(1);
    await act(async () => acknowledgements[0].resolve());
    expect(registerTool).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('Preparing agent tools');
    await act(async () => acknowledgements[1].resolve());
    expect(container.textContent).toBe('Agent tools ready');
  });

  it.each(['before', 'after'] as const)('keeps startup calls visible when registration finishes %s the call', async (completion) => {
    const registration = deferred<void>();
    const execution = deferred<void>();
    const registered = new Map<string, SiteTool>();
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: SiteTool) => {
      registered.set(tool.name, tool);
      if (tool.name === 'edm_second') return registration.promise;
    } } satisfies ModelContext });
    function Harness() { return <AgentActivity activity={useSiteTools([
      siteTool('edm_first', 'First', object({}), () => execution.promise),
      siteTool('edm_second', 'Second', object({}), () => null)
    ])} />; }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    let pending!: Promise<unknown>;
    await act(async () => { pending = registered.get('edm_first')!.execute({}); });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('running · first');
    if (completion === 'before') {
      await act(async () => registration.resolve());
      expect(container.querySelector('[role="status"]')?.textContent).toContain('running · first');
    }
    await act(async () => { execution.resolve(); await pending; });
    expect(container.textContent).toContain('first · succeeded');
    if (completion === 'after') {
      expect(container.querySelector('[role="status"]')?.textContent).toBe('Preparing agent tools');
      await act(async () => registration.resolve());
    }
    expect(container.querySelector('[role="status"]')?.textContent).toContain('done · first');
  });

  it('ignores the disposed StrictMode registration while the replacement is preparing', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const acknowledgements: (() => void)[] = [];
    const signals: AbortSignal[] = [];
    Object.defineProperty(document, 'modelContext', { configurable: true, value: {
      registerTool: (_tool: SiteTool, { signal }: { signal: AbortSignal }) => new Promise<void>((resolve, reject) => {
        acknowledgements.push(resolve);
        signals.push(signal);
        signal.addEventListener('abort', () => reject(new DOMException('Registration disposed', 'AbortError')), { once: true });
      })
    } satisfies ModelContext });
    function Harness() { return <AgentActivity activity={useSiteTools([siteTool('edm_first', 'First', object({}), () => null)])} />; }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<StrictMode><Harness /></StrictMode>));
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(container.textContent).toBe('Preparing agent tools');
    expect(warning).not.toHaveBeenCalled();
    await act(async () => acknowledgements[1]());
    expect(container.textContent).toBe('Agent tools ready');
    expect(warning).not.toHaveBeenCalled();
  });

  it('reports a failed registration but does not warn about rejection after unmount', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const first = deferred<void>();
    const second = deferred<void>();
    const registerTool = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool } satisfies ModelContext });
    function Harness() { return <AgentActivity activity={useSiteTools([siteTool('edm_first', 'First', object({}), () => null)])} />; }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    await act(async () => first.reject(new Error('Registration unavailable')));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Agent tools unavailable');
    expect(warning).toHaveBeenCalledOnce();
    await act(async () => root!.render(null));
    await act(async () => root!.render(<Harness />));
    await act(async () => root!.render(null));
    await act(async () => second.reject(new Error('Disposed registration')));
    expect(warning).toHaveBeenCalledOnce();
  });

  it('keeps a running action visible during context reads and displays actionable tool errors', async () => {
    const registered = new Map<string, SiteTool>();
    const context: ModelContext = { registerTool: tool => { registered.set(tool.name, tool); } };
    Object.defineProperty(document, 'modelContext', { configurable: true, value: context });
    let finish!: () => void;
    const slow = new Promise<void>(resolve => { finish = resolve; });
    let version = 1;
    let state!: SiteToolActivityState;
    function Harness() {
      state = useSiteTools([
        siteTool('edm_generate_controller', 'Generate', object({}), async () => { await slow; return { generated: false, error: { code: 'POST_FAILED', message: 'Review the exact post.' } }; }, false),
        siteTool('edm_get_context', 'Context', object({}), () => ({ version }))
      ]);
      return <AgentActivity activity={state} />;
    }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    expect(container.textContent).toBe('Agent tools ready');
    let generating!: Promise<unknown>;
    await act(async () => { generating = registered.get('edm_generate_controller')!.execute({}); });
    for (let index = 0; index < 10; index++) await act(async () => { await registered.get('edm_get_context')!.execute({}); });
    expect(state.calls).toHaveLength(8);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('running · generate controller');
    version = 2;
    await act(async () => root!.render(<Harness />));
    await act(async () => { expect(await registered.get('edm_get_context')!.execute({})).toEqual({ ok: true, data: { version: 2 } }); });
    await act(async () => { finish(); await generating; });
    expect(container.querySelector('[role="status"]')?.textContent).toContain('failed · generate controller');
    expect(container.textContent).toContain('Review the exact post.');
  });

  it('explains unsupported browsers within the Agent panel', async () => {
    function Harness() { return <AgentActivity activity={useSiteTools([])} />; }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Agent tools unavailable');
    expect(container.textContent).toContain('This browser does not support WebMCP agent tools.');
    expect(container.textContent).toContain('The ordinary app controls remain available.');
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
