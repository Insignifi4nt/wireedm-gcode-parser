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
});
