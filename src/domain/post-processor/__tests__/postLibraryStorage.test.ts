import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import robofilPost from '../../../../tests/fixtures/machine-packages/robofil-100-v2/cristian-robofil-100-v2.wireedm-post.json';

import type { WorkbenchStorageAdapter } from '@/domain/storage/workbenchStorageAdapter';

import { createEmptyPostLibrary, installPostPackage } from '../postLibrary';
import {
  initializePostLibraryStorage,
  MAX_POST_LIBRARY_BYTES,
  POST_LIBRARY_DIRECTORY,
  POST_LIBRARY_PATH,
  readPostLibraryStorage,
  writePostLibraryStorage
} from '../postLibraryStorage';
import { parseWireEdmPostPackage } from '../postPackage';
import { minimalPostPackage } from './postPackageFixture';
import { canonicalJson } from '../canonicalJson';

class MemoryAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly directories: string[] = [];

  constructor(
    readonly name = 'post-library-test',
    private readonly failure?: 'ensure-directory' | 'read' | 'write'
  ) {}

  async ensureDirectory(path: string) {
    if (this.failure === 'ensure-directory') throw new Error('directory denied');
    this.directories.push(path);
  }

  async readText(path: string) {
    if (this.failure === 'read') throw new Error('read denied');
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    if (this.failure === 'write') throw new Error('write denied');
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }
}

function parsedPackage() {
  const result = parseWireEdmPostPackage(JSON.stringify(minimalPostPackage()));
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.package;
}

describe('post library storage', () => {
  it('initializes an explicitly empty library when its file does not exist', async () => {
    const adapter = new MemoryAdapter();

    expect(await initializePostLibraryStorage(adapter)).toEqual({
      ok: true,
      kind: 'created',
      library: createEmptyPostLibrary()
    });
    expect(adapter.directories).toEqual([POST_LIBRARY_DIRECTORY]);
    expect(JSON.parse(adapter.files.get(POST_LIBRARY_PATH) ?? '')).toEqual({
      format: 'wire-edm-post-library',
      schemaVersion: 1,
      installations: []
    });
  });

  it('round-trips exact installation references and package content', async () => {
    const adapter = new MemoryAdapter();
    const installed = await installPostPackage(createEmptyPostLibrary(), parsedPackage());
    if (!installed.ok) throw new Error(installed.error.message);

    expect(await writePostLibraryStorage(adapter, installed.library)).toEqual({ ok: true });

    expect(await readPostLibraryStorage(adapter)).toEqual({ ok: true, library: installed.library });
  });

  it('reopens unchanged legacy arc packages without rerunning installation conformance', async () => {
    const legacy = structuredClone(robofilPost);
    for (const command of Object.values(legacy.dialect.commands)) {
      Reflect.deleteProperty(command, 'arcDirection');
    }
    const parsed = parseWireEdmPostPackage(JSON.stringify(legacy));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
    const adapter = new MemoryAdapter();
    const library = {
      schemaVersion: 1 as const,
      installations: [{
        ref: {
          packageId: legacy.manifest.id,
          version: legacy.manifest.version,
          contentHash: createHash('sha256').update(canonicalJson(legacy)).digest('hex')
        },
        package: parsed.package
      }]
    };
    expect(await writePostLibraryStorage(adapter, library)).toEqual({ ok: true });
    expect(await initializePostLibraryStorage(adapter)).toEqual({ ok: true, kind: 'opened', library });
    expect(await installPostPackage(createEmptyPostLibrary(), parsed.package)).toMatchObject({
      ok: false, error: { code: 'POST_LIBRARY_CONFORMANCE_FAILED' }
    });
  });

  it.each([
    {
      label: 'obsolete schema',
      mutate: (document: Record<string, unknown>) => {
        document.schemaVersion = 0;
      },
      code: 'POST_LIBRARY_STORAGE_SCHEMA_INVALID'
    },
    {
      label: 'malformed package',
      mutate: (document: Record<string, unknown>) => {
        const installations = document.installations as Array<Record<string, unknown>>;
        installations[0].package = {};
      },
      code: 'POST_LIBRARY_STORAGE_PACKAGE_INVALID'
    },
    {
      label: 'tampered reference hash',
      mutate: (document: Record<string, unknown>) => {
        const installations = document.installations as Array<{ ref: { contentHash: string } }>;
        installations[0].ref.contentHash = '0'.repeat(64);
      },
      code: 'POST_LIBRARY_STORAGE_HASH_MISMATCH'
    },
    {
      label: 'tampered package content',
      mutate: (document: Record<string, unknown>) => {
        const installations = document.installations as Array<Record<string, unknown>>;
        const packageValue = installations[0].package as ReturnType<typeof minimalPostPackage>;
        packageValue.source.code += '\n// changed after hashing';
      },
      code: 'POST_LIBRARY_STORAGE_HASH_MISMATCH'
    }
  ])('rejects $label rather than returning an empty library', async ({ mutate, code }) => {
    const adapter = new MemoryAdapter();
    const installed = await installPostPackage(createEmptyPostLibrary(), parsedPackage());
    if (!installed.ok) throw new Error(installed.error.message);
    expect(await writePostLibraryStorage(adapter, installed.library)).toEqual({ ok: true });
    const document = JSON.parse(adapter.files.get(POST_LIBRARY_PATH) ?? '') as Record<string, unknown>;
    mutate(document);
    adapter.files.set(POST_LIBRARY_PATH, JSON.stringify(document));

    expect(await readPostLibraryStorage(adapter)).toEqual({
      ok: false,
      error: expect.objectContaining({ code })
    });
  });

  it('reports a missing library file instead of treating it as empty during reads', async () => {
    expect(await readPostLibraryStorage(new MemoryAdapter())).toEqual({
      ok: false,
      error: {
        code: 'POST_LIBRARY_STORAGE_NOT_FOUND',
        message: `Post library file does not exist: ${POST_LIBRARY_PATH}.`
      }
    });
  });

  it('rejects an oversized library before parsing it', async () => {
    const adapter = new MemoryAdapter();
    adapter.files.set(POST_LIBRARY_PATH, 'x'.repeat(MAX_POST_LIBRARY_BYTES + 1));

    expect(await readPostLibraryStorage(adapter)).toEqual({
      ok: false,
      error: {
        code: 'POST_LIBRARY_STORAGE_TOO_LARGE',
        message: `Post library is ${MAX_POST_LIBRARY_BYTES + 1} UTF-8 bytes; the maximum is ${MAX_POST_LIBRARY_BYTES}.`,
        actualBytes: MAX_POST_LIBRARY_BYTES + 1,
        maximumBytes: MAX_POST_LIBRARY_BYTES
      }
    });
  });

  it.each([
    {
      operation: 'ensure-directory' as const,
      invoke: (adapter: MemoryAdapter) => initializePostLibraryStorage(adapter),
      path: POST_LIBRARY_DIRECTORY
    },
    {
      operation: 'read' as const,
      invoke: (adapter: MemoryAdapter) => readPostLibraryStorage(adapter),
      path: POST_LIBRARY_PATH
    },
    {
      operation: 'write' as const,
      invoke: (adapter: MemoryAdapter) => writePostLibraryStorage(adapter, createEmptyPostLibrary()),
      path: POST_LIBRARY_PATH
    }
  ])('returns a typed $operation adapter failure', async ({ operation, invoke, path }) => {
    const result = await invoke(new MemoryAdapter('post-library-test', operation));

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'POST_LIBRARY_STORAGE_ACCESS_FAILED', operation, path }
    });
  });
});
