import { describe, expect, it } from 'vitest';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorage';

import { installStoredPostPackage } from '../postLibraryMutations';
import {
  initializePostLibraryStorage,
  POST_LIBRARY_PATH
} from '../postLibraryStorage';
import { minimalPostPackage } from './postPackageFixture';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();

  constructor(readonly name = 'post-library-mutations') {}

  async ensureDirectory() {}
  async readText(path: string) { return this.files.get(path) ?? null; }
  async writeText(path: string, contents: string) { this.files.set(path, contents); }
  async deleteText(path: string) { this.files.delete(path); }
}

describe('persisted post library mutations', () => {
  it('installs parsed package content and leaves stored bytes unchanged on a version conflict', async () => {
    const adapter = new MemoryAdapter();
    await initializePostLibraryStorage(adapter);
    const installed = await installStoredPostPackage(adapter, JSON.stringify(minimalPostPackage()));
    expect(installed.ok).toBe(true);
    if (!installed.ok) throw new Error(installed.error.message);
    const storedAfterInstall = adapter.files.get(POST_LIBRARY_PATH);

    const conflict = minimalPostPackage();
    conflict.source.code += '\n// conflicting implementation';
    expect(await installStoredPostPackage(adapter, JSON.stringify(conflict))).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_VERSION_CONFLICT' }
    });
    expect(adapter.files.get(POST_LIBRARY_PATH)).toBe(storedAfterInstall);
  });

  it('rejects invalid uploaded package text before reading or writing the library', async () => {
    const adapter = new MemoryAdapter();

    expect(await installStoredPostPackage(adapter, '{')).toMatchObject({
      ok: false,
      error: {
        code: 'POST_PACKAGE_INVALID',
        diagnostics: [{ code: 'POST_PACKAGE_JSON_INVALID' }]
      }
    });
    expect(adapter.files.has(POST_LIBRARY_PATH)).toBe(false);
  });
});
