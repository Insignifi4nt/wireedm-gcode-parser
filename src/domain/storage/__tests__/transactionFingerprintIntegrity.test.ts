import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { beginRevisionDeletionTransaction, recoverSavedRevisionTransaction, SAVED_REVISION_TRANSACTION_PATH } from '../savedRevisionTransaction';
import { commitProjectPurgeTransaction, recoverProjectTrashTransaction, PROJECT_TRASH_TRANSACTION_PATH } from '../projectTrashTransaction';
import { transactionFileHash } from '../transactionFileState';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

const revisionPaths = ['projects/part/revisions/revision.one.wireedm-job.json', 'projects/part/revisions/revision.two.wireedm-job.json'];
const purgePaths = ['projects/part.json', 'imports/part.nc'];
const indexImages = { previousProject: 'OLD PROJECT', nextProject: 'NEW PROJECT', previousManifest: 'OLD INDEX', nextManifest: 'NEW INDEX' };
const operations = [
  {
    name: 'revision deletion', journal: SAVED_REVISION_TRANSACTION_PATH, paths: revisionPaths,
    begin: (adapter: WorkbenchStorageAdapter) => beginRevisionDeletionTransaction(adapter, {
      projectId: 'part', revisionIds: ['revision.one', 'revision.two'], ...indexImages
    }),
    journalText: (hashes: readonly string[]) => JSON.stringify({ format: 'wire-edm-revision-deletion-transaction', schemaVersion: 2,
      projectId: 'part', revisionIds: ['revision.one', 'revision.two'], ...indexImages, previousRevisionHashes: hashes }),
    recover: recoverSavedRevisionTransaction
  },
  {
    name: 'project purge', journal: PROJECT_TRASH_TRANSACTION_PATH, paths: purgePaths,
    begin: (adapter: WorkbenchStorageAdapter) => commitProjectPurgeTransaction(adapter, {
      projectId: 'part', ownedPaths: purgePaths, next: indexImages.nextManifest
    }),
    journalText: (hashes: readonly string[]) => JSON.stringify({ format: 'wire-edm-project-purge-transaction', schemaVersion: 2,
      projectId: 'part', ownedPaths: purgePaths, previous: indexImages.previousManifest, next: indexImages.nextManifest, ownedHashes: hashes }),
    recover: recoverProjectTrashTransaction
  }
];

async function utf8Hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

describe.each(['cache', 'folder'] as const)('%s exact transaction fingerprint controls', kind => {
  it.each(['', 'ASCII\r\n', 'Café Ω 😀\r\n', '\ufeffCafé Ω 😀\r\n'])('retains the existing UTF-8 hash for %j', async text => {
    const adapter = kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
      : createBrowserDirectoryAdapter(new FakeDirectoryHandle('exact-fingerprints') as unknown as FileSystemDirectoryHandle);
    await adapter.writeText('imports/original.nc', text);
    expect(await transactionFileHash(adapter, 'imports/original.nc')).toBe(await utf8Hash(text));
    expect(await adapter.readExactText!('imports/original.nc')).toBe(text);
  });
});

describe.each(operations)('plain-cache $name malformed fingerprint retention', operation => {
  const storage = () => createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });

  it.each(['\ud800', '\udc00'])('rejects malformed source %j before creating destructive recovery data', async malformed => {
    const adapter = storage();
    await adapter.writeText('workbench.json', indexImages.previousManifest);
    await adapter.writeText('projects/part.json', indexImages.previousProject);
    await adapter.writeText(operation.paths[0], 'EXACT FIRST ORIGINAL');
    await adapter.writeText(operation.paths[1], malformed);
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    expect(await operation.begin(adapter)).toMatchObject({ ok: false });
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await adapter.readExactText!(operation.journal)).toBeNull();
    expect(await adapter.readExactText!('workbench.json')).toBe(indexImages.previousManifest);
    expect(await adapter.readExactText!(operation.paths[0])).toBe('EXACT FIRST ORIGINAL');
    expect(await adapter.readExactText!(operation.paths[1])).toBe(malformed);
  });

  it.each(['\ud801', '\udc01'])('retains changed malformed contents %j and its older journal through retries', async replacement => {
    const adapter = storage();
    const first = '\ufeffEXACT FIRST ORIGINAL\r\n';
    const hashes = [await utf8Hash(first), await utf8Hash('\ufffd')];
    const raw = operation.journalText(hashes);
    await adapter.writeText('projects/part.json', indexImages.nextProject);
    await adapter.writeText('workbench.json', indexImages.nextManifest);
    await adapter.writeText(operation.paths[0], first);
    await adapter.writeText(operation.paths[1], replacement);
    await adapter.writeText(operation.journal, raw);
    const write = vi.spyOn(adapter, 'writeText');
    const remove = vi.spyOn(adapter, 'deleteText');
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await operation.recover(adapter)).toMatchObject({ ok: false });
      expect(await adapter.readExactText!(operation.paths[0])).toBe(first);
      expect(await adapter.readExactText!(operation.paths[1])).toBe(replacement);
      expect(await adapter.readExactText!(operation.journal)).toBe(raw);
    }
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
