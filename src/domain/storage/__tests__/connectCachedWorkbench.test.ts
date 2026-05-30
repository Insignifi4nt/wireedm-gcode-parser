import { describe, expect, it } from 'vitest';

import { connectCachedWorkbench } from '../connectCachedWorkbench';

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

describe('connectCachedWorkbench', () => {
  it('initializes a usable browser-cache workbench without directory access', async () => {
    const storage = new MemoryStorage();

    const workbench = await connectCachedWorkbench({
      storage,
      now: new Date('2026-05-29T14:00:00.000Z')
    });

    expect(workbench.adapter.kind).toBe('browser-cache');
    expect(workbench.manifest.name).toBe('Local storage');
    expect(workbench.manifest.projects).toEqual([]);
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toContain(
      '"schemaVersion": 1'
    );
    expect(storage.getItem('wire-edm-workbench:file:templates/header.gcode')).toContain(
      'G90 G21 G17 G40'
    );
  });

  it('preserves cached templates and manifest on reconnect', async () => {
    const storage = new MemoryStorage();
    storage.setItem('wire-edm-workbench:file:templates/header.gcode', 'CUSTOM HEADER');

    const first = await connectCachedWorkbench({
      storage,
      now: new Date('2026-05-29T14:00:00.000Z')
    });
    const second = await connectCachedWorkbench({
      storage,
      now: new Date('2026-05-29T14:05:00.000Z')
    });

    expect(first.header).toBe('CUSTOM HEADER');
    expect(second.header).toBe('CUSTOM HEADER');
    expect(second.manifest.createdAt).toBe('2026-05-29T14:00:00.000Z');
    expect(second.manifest.updatedAt).toBe('2026-05-29T14:05:00.000Z');
  });

  it('falls back to temporary memory storage when persistent local storage is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      }
    });

    try {
      const workbench = await connectCachedWorkbench({
        now: new Date('2026-05-29T14:00:00.000Z')
      });

      expect(workbench.adapter.kind).toBe('memory');
      expect(workbench.manifest.name).toBe('Temporary storage');
      expect(workbench.header).toContain('G90 G21 G17 G40');
      expect(workbench.footer).toContain('M30');
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor);
      }
    }
  });
});
