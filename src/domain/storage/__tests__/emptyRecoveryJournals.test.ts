import { describe, expect, it } from 'vitest';
import { initializeWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';

const journals = [
  'transactions/workbench-files.json',
  'transactions/saved-revision.json',
  'transactions/project-trash.json',
  'transactions/machine-package-install.json'
];

describe.each(['cache', 'folder'] as const)('%s interrupted journal creation', (kind) => {
  const storage = () => kind === 'cache'
    ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
    : createBrowserDirectoryAdapter(new FakeDirectoryHandle('recovery') as unknown as FileSystemDirectoryHandle);

  it.each(journals)('reopens after an empty %s was created before its first write', async (path) => {
    const adapter = storage();
    expect((await initializeWorkbenchCatalog(adapter)).ok).toBe(true);
    const manifest = await adapter.readText('workbench.json');
    await adapter.writeText('exports/keep.iso', '%\r\nM02\r\n');
    await adapter.writeText(path, '');

    expect((await initializeWorkbenchCatalog(adapter)).ok).toBe(true);
    expect(await adapter.readText(path)).toBeNull();
    expect(await adapter.readText('workbench.json')).toBe(manifest);
    expect(await adapter.readText('exports/keep.iso')).toBe('%\r\nM02\r\n');
  });

  it.each(journals)('preserves nonempty invalid recovery data at %s', async (path) => {
    const adapter = storage();
    expect((await initializeWorkbenchCatalog(adapter)).ok).toBe(true);
    const manifest = await adapter.readText('workbench.json');
    await adapter.writeText(path, '{incomplete');
    const result = await initializeWorkbenchCatalog(adapter).catch(() => ({ ok: false }));
    expect(result.ok).toBe(false);
    expect(await adapter.readText(path)).toBe('{incomplete');
    expect(await adapter.readText('workbench.json')).toBe(manifest);
  });
});
