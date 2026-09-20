import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentActivity } from './AgentActivity';
import { object, siteTool, useSiteTools, type ModelContext, type SiteTool, type SiteToolActivityState } from './siteTools';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); Reflect.deleteProperty(document, 'modelContext'); });

describe('visible agent activity', () => {
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
    expect(container.querySelector('summary')?.textContent).toContain('running · generate controller');
    version = 2;
    await act(async () => root!.render(<Harness />));
    await act(async () => { expect(await registered.get('edm_get_context')!.execute({})).toEqual({ ok: true, data: { version: 2 } }); });
    await act(async () => { finish(); await generating; });
    expect(container.querySelector('summary')?.textContent).toContain('failed · generate controller');
    expect(container.textContent).toContain('Review the exact post.');
  });

  it('keeps the ordinary interface uncluttered when the browser has no site tools', async () => {
    function Harness() { return <AgentActivity activity={useSiteTools([])} />; }
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    await act(async () => root!.render(<Harness />));
    expect(container.textContent).toBe('');
  });
});
