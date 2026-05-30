import { describe, expect, it } from 'vitest';

import { connectWorkbenchDirectory } from '../connectWorkbenchDirectory';
import type { WorkbenchStorageAdapter } from '../workbenchStorage';

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly directories = new Set<string>();
  readonly files = new Map<string, string>();

  constructor(readonly name = 'wire-jobs') {}

  async ensureDirectory(path: string) {
    this.directories.add(path);
  }

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    this.files.set(path, contents);
  }
}

describe('connectWorkbenchDirectory', () => {
  it('requests a directory handle, adapts it, and initializes the workbench folder', async () => {
    const adapter = new MemoryWorkbenchAdapter('wire-jobs');
    const result = await connectWorkbenchDirectory({
      requestDirectory: async () => ({ name: 'wire-jobs' }) as FileSystemDirectoryHandle,
      createAdapter: () => adapter,
      now: new Date('2026-05-29T12:00:00.000Z')
    });

    expect(result.manifest.name).toBe('wire-jobs');
    expect(result.header).toContain('G90 G21 G17 G40');
    expect(result.footer).toContain('M30');
    expect(adapter.files.has('workbench.json')).toBe(true);
  });
});
