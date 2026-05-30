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
});
