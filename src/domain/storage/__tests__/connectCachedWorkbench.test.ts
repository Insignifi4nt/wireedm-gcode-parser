import { describe, expect, it } from 'vitest';

import { connectCachedWorkbench } from '../connectCachedWorkbench';
import { importExternalProgram } from '@/domain/editor/importExternalProgram';

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
  it('reconnects a saved project after its directory index is damaged', async () => {
    const storage = new MemoryStorage();
    const first = await connectCachedWorkbench({ storage });
    if (!first.ok) throw new Error(first.error.message);
    const imported = await importExternalProgram(first.workbench, { fileName: 'plate.nc', text: 'G21\nG1 X10 Y5' });
    if (!imported.ok) throw new Error(imported.error.message);
    const manifest = storage.getItem('wire-edm-workbench:file:workbench.json');
    storage.setItem('wire-edm-workbench:directories', '{damaged');
    const reopened = await connectCachedWorkbench({ storage });
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(reopened.workbench.manifest.projects).toEqual(imported.workbench.manifest.projects);
    expect(await reopened.workbench.adapter.readText(imported.editorProgram.filePath)).toBe(imported.editorProgram.text);
    await reopened.workbench.adapter.ensureDirectory('projects');
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(manifest);
    expect(JSON.parse(storage.getItem('wire-edm-workbench:directories')!)).toContain('projects');
  });

  it('creates a strict V2 browser-cache catalog without directory access', async () => {
    const storage = new MemoryStorage();

    const result = await connectCachedWorkbench({
      storage,
      now: new Date('2026-08-28T14:00:00.000Z')
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'created',
      workbench: {
        adapter: { kind: 'browser-cache' },
        manifest: {
          schemaVersion: 3,
          name: 'Local storage',
          preferences: {
            importUnits: { mode: 'ask' },
            recentPlanningMachineId: null
          },
          projects: []
        },
        posts: { installations: [] },
        machines: { machines: [] }
      }
    });
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toContain(
      '"schemaVersion": 3'
    );
    expect(storage.getItem('wire-edm-workbench:file:posts/library.json')).not.toBeNull();
    expect(storage.getItem('wire-edm-workbench:file:machines/library.json')).not.toBeNull();
  });

  it('opens the same V2 catalog without mutating its manifest timestamps', async () => {
    const storage = new MemoryStorage();
    const first = await connectCachedWorkbench({
      storage,
      now: new Date('2026-08-28T14:00:00.000Z')
    });
    const storedBefore = storage.getItem('wire-edm-workbench:file:workbench.json');

    const second = await connectCachedWorkbench({
      storage,
      now: new Date('2026-08-28T14:05:00.000Z')
    });

    expect(first).toMatchObject({ ok: true, kind: 'created' });
    expect(second).toMatchObject({
      ok: true,
      kind: 'opened',
      workbench: {
        manifest: {
          createdAt: '2026-08-28T14:00:00.000Z',
          updatedAt: '2026-08-28T14:00:00.000Z'
        }
      }
    });
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(storedBefore);
  });

  it('rejects an invalid V1 cache without rewriting it', async () => {
    const storage = new MemoryStorage();
    const original = JSON.stringify({ schemaVersion: 1, machineProfiles: [] });
    storage.setItem('wire-edm-workbench:file:workbench.json', original);

    expect(await connectCachedWorkbench({ storage })).toEqual({
      ok: false,
      error: {
        code: 'WORKBENCH_CATALOG_SCHEMA_INVALID',
        message: 'Legacy workbench manifest schema violation at /name: Expected required property.',
        path: '/name'
      }
    });
    expect(storage.getItem('wire-edm-workbench:file:workbench.json')).toBe(original);
    expect(storage.getItem('wire-edm-workbench:file:posts/library.json')).toBeNull();
  });

  it('uses an explicit temporary V2 catalog when persistent local storage is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      }
    });

    try {
      const result = await connectCachedWorkbench({
        now: new Date('2026-08-28T14:00:00.000Z')
      });

      expect(result).toMatchObject({
        ok: true,
        kind: 'created',
        workbench: {
          adapter: { kind: 'memory' },
          manifest: { schemaVersion: 3, name: 'Temporary storage' }
        }
      });
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
});
