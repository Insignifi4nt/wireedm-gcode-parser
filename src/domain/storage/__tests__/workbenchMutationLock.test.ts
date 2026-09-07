import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { withWorkbenchMutationLock } from '../workbenchMutationLock';

describe('workbench mutation scope', () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

  it.each(['browser-cache', 'directory'] as const)('does not write to %s when cross-tab coordination is unavailable', async (kind) => {
    vi.stubGlobal('navigator', {});
    const mutation = vi.fn(async () => {});
    const adapter = { ...createBrowserCacheAdapter(localStorage), kind };
    await expect(withWorkbenchMutationLock(adapter, mutation)).rejects.toThrow('Persistent storage requires Web Locks');
    expect(mutation).not.toHaveBeenCalled();
  });

  it('serializes temporary adapters sharing an in-realm storage scope without Web Locks', async () => {
    vi.stubGlobal('navigator', {});
    const first = createBrowserCacheAdapter(localStorage, { name: 'First label', kind: 'memory' });
    const second = createBrowserCacheAdapter(localStorage, { name: 'Another label', kind: 'memory' });
    await first.writeText('counter', '0');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const one = withWorkbenchMutationLock(first, async () => {
      const value = Number(await first.readText('counter'));
      entered();
      await gate;
      await first.writeText('counter', String(value + 1));
    });
    await started;
    const two = withWorkbenchMutationLock(second, async () => {
      const value = Number(await second.readText('counter'));
      await second.writeText('counter', String(value + 1));
    });
    release();
    await Promise.all([one, two]);
    expect(await first.readText('counter')).toBe('2');
    await expect(withWorkbenchMutationLock(second, async () => { throw new Error('write failed'); })).rejects.toThrow('write failed');
    await withWorkbenchMutationLock(first, () => first.writeText('counter', '3'));
    expect(await second.readText('counter')).toBe('3');
  });

  it('requests the same browser lock across adapter display names', async () => {
    const request = vi.fn(async (_name: string, mutation: () => Promise<void>) => mutation());
    vi.stubGlobal('navigator', { locks: { request } });
    for (const name of ['First label', 'Another label']) {
      await withWorkbenchMutationLock(createBrowserCacheAdapter(localStorage, { name }), async () => {});
    }
    expect(request.mock.calls.map(([name]) => name)).toEqual([
      'wire-edm-workbench:browser-storage:wire-edm-workbench',
      'wire-edm-workbench:browser-storage:wire-edm-workbench'
    ]);
  });
});
