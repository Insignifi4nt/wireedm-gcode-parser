import { describe, expect, it } from 'vitest';

import { createBrowserCacheAdapter } from '../browserCacheAdapter';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class QuotaStorage extends MemoryStorage {
  constructor(private readonly maxCharacters: number) { super(); }

  override setItem(key: string, value: string) {
    let used = 0;
    for (let index = 0; index < this.length; index++) {
      const existingKey = this.key(index)!;
      if (existingKey !== key) used += existingKey.length + this.getItem(existingKey)!.length;
    }
    if (used + key.length + value.length > this.maxCharacters) {
      throw new DOMException('Setting the value exceeded the quota.', 'QuotaExceededError');
    }
    super.setItem(key, value);
  }
}

describe('createBrowserCacheAdapter', () => {
  it.each(['{broken', 'null', '{}', '42', '["empty-folder",42]', null])(
    'rebuilds damaged or missing directory metadata %j from owned file paths', async (metadata) => {
      const storage = new MemoryStorage();
      const namespace = 'wire-edm-test';
      const adapter = createBrowserCacheAdapter(storage, { namespace });
      await adapter.writeText('projects/plate/source/part.dxf', 'DXF CONTENT');
      await adapter.writeText('projects/plate/revision.json', 'REVISION CONTENT');
      storage.setItem('other:file:unrelated/file.txt', 'UNRELATED');
      if (metadata !== null) storage.setItem(`${namespace}:directories`, metadata);
      const expected = ['projects', 'projects/plate', 'projects/plate/source'];
      if (metadata === '["empty-folder",42]') expected.unshift('empty-folder');
      expect(await adapter.listDirectories()).toEqual(expected);
      await adapter.ensureDirectory('machines');
      const reopened = createBrowserCacheAdapter(storage, { namespace });
      expect(await reopened.listDirectories()).toEqual([...expected, 'machines'].sort());
      expect(await reopened.readText('projects/plate/source/part.dxf')).toBe('DXF CONTENT');
      expect(await reopened.readText('projects/plate/revision.json')).toBe('REVISION CONTENT');
      expect(storage.getItem('other:file:unrelated/file.txt')).toBe('UNRELATED');
    }
  );

  it('persists workbench text files in a Storage-backed cache', async () => {
    const storage = new MemoryStorage();
    const adapter = createBrowserCacheAdapter(storage, {
      name: 'Browser cache',
      namespace: 'wire-edm-test'
    });

    await adapter.ensureDirectory('templates');
    await adapter.writeText('templates/header.gcode', 'HEADER');

    const reconnected = createBrowserCacheAdapter(storage, {
      name: 'Browser cache',
      namespace: 'wire-edm-test'
    });

    expect(await reconnected.readText('templates/header.gcode')).toBe('HEADER');
    expect(JSON.parse(storage.getItem('wire-edm-test:directories') || '[]')).toEqual([
      'templates'
    ]);
  });

  it('can be cleared without affecting unrelated storage keys', async () => {
    const storage = new MemoryStorage();
    storage.setItem('other-app:key', 'keep');
    const adapter = createBrowserCacheAdapter(storage, {
      name: 'Browser cache',
      namespace: 'wire-edm-test'
    });

    await adapter.writeText('workbench.json', '{}');
    await adapter.clear();

    expect(await adapter.readText('workbench.json')).toBeNull();
    expect(storage.getItem('other-app:key')).toBe('keep');
  });

  it('deletes individual cached files', async () => {
    const storage = new MemoryStorage();
    const adapter = createBrowserCacheAdapter(storage, {
      name: 'Browser cache',
      namespace: 'wire-edm-test'
    });

    await adapter.writeText('projects/example/project.json', '{}');
    await adapter.deleteText('projects/example/project.json');

    expect(await adapter.readText('projects/example/project.json')).toBeNull();
  });

  it('can save a revision beside existing large project revisions within a browser storage quota', async () => {
    const storage = new QuotaStorage(5_000_000);
    const adapter = createBrowserCacheAdapter(storage, { namespace: 'wire-edm-test' });
    storage.setItem('existing-project-and-revisions', 'x'.repeat(3_000_000));
    const project = JSON.stringify({ geometry: 'G'.repeat(600_000) });
    const revision = JSON.stringify({ geometry: 'R'.repeat(440_000) });
    const journal = JSON.stringify({ previousProject: project, nextProject: project, nextRevision: revision });

    await adapter.writeText('transactions/saved-revision.json', journal);
    await adapter.writeText('projects/gear/revisions/revision.1.wireedm-job.json', revision);
    expect(await adapter.readText('transactions/saved-revision.json')).toBe(journal);
    expect(await adapter.readText('projects/gear/revisions/revision.1.wireedm-job.json')).toBe(revision);
    expect(storage.getItem('existing-project-and-revisions')).toHaveLength(3_000_000);
  });

  it('reads legacy text and round-trips compressed Unicode without changing its logical bytes', async () => {
    const storage = new MemoryStorage();
    const adapter = createBrowserCacheAdapter(storage, { namespace: 'wire-edm-test' });
    const path = 'projects/gear.json';
    const text = JSON.stringify({ name: 'Oțel ⚙', geometry: 'segment,'.repeat(2000) });
    storage.setItem(`wire-edm-test:file:${path}`, text);
    expect(await adapter.readText(path)).toBe(text);
    await adapter.writeText(path, text);
    expect(storage.getItem(`wire-edm-test:file:${path}`)?.length).toBeLessThan(text.length);
    expect(await createBrowserCacheAdapter(storage, { namespace: 'wire-edm-test' }).readText(path)).toBe(text);
  });

  it('round-trips a varied geometry revision and transaction journal under quota', async () => {
    const storage = new QuotaStorage(5_000_000);
    const adapter = createBrowserCacheAdapter(storage, { namespace: 'wire-edm-test' });
    const geometry = Array.from({ length: 4_000 }, (_, index) => ({
      id: `seg_${index + 1}`,
      start: { x: Math.sin(index * 0.71) * 100, y: Math.cos(index * 0.43) * 80 },
      end: { x: Math.sin((index + 1) * 0.71) * 100, y: Math.cos((index + 1) * 0.43) * 80 }
    }));
    const revision = JSON.stringify({ format: 'wire-edm-job-revision', geometry });
    const journal = JSON.stringify({ previousProject: { geometry }, nextProject: { geometry }, nextRevision: { geometry } });

    await adapter.writeText('projects/gear/revisions/revision.1.json', revision);
    await adapter.writeText('transactions/saved-revision.json', journal);
    expect(await createBrowserCacheAdapter(storage, { namespace: 'wire-edm-test' })
      .readText('projects/gear/revisions/revision.1.json')).toBe(revision);
    expect(await adapter.readText('transactions/saved-revision.json')).toBe(journal);
    expect(storage.getItem('wire-edm-test:file:transactions/saved-revision.json')?.length)
      .toBeLessThan(journal.length);
  });
});
