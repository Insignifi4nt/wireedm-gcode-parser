import { describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import { commitWorkbenchFileTransaction, recoverWorkbenchFileTransaction, WORKBENCH_FILE_TRANSACTION_PATH } from '../workbenchFileTransaction';
import { withWorkbenchMutationLock } from '../workbenchMutationLock';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';
import { readExactTransactionText as exact } from '../transactionFileState';

describe.each(['cache', 'folder'] as const)('%s file transaction recovery', (kind) => {
  function storage(): WorkbenchStorageAdapter {
    if (kind === 'folder') return createBrowserDirectoryAdapter(new FakeDirectoryHandle('transactions') as unknown as FileSystemDirectoryHandle);
    return createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });
  }
  const files = [
    { path: 'imports/new.dxf', previous: null, next: 'SOURCE' },
    { path: 'projects/part.json', previous: 'OLD PROJECT', next: 'NEW PROJECT' },
    { path: 'workbench.json', previous: 'OLD INDEX', next: 'NEW INDEX' }
  ] as const;

  it('preserves exact originals and writes no journal when the final guard rejects', async () => {
    const adapter = storage();
    await adapter.ensureDirectory('projects');
    await adapter.writeText('projects/part.json', '\ufeffORIGINAL\r\n');
    const reason = new DOMException('Cancelled before writing', 'AbortError');
    const guard = vi.fn(() => { throw reason; });
    await expect(withWorkbenchMutationLock(adapter, () => commitWorkbenchFileTransaction(adapter,
      [{ path: 'projects/part.json', contents: 'REPLACEMENT' }], guard))).rejects.toMatchObject({ reason });
    expect(guard).toHaveBeenCalledOnce();
    expect(await (adapter.readExactText ?? adapter.readText)('projects/part.json')).toBe('\ufeffORIGINAL\r\n');
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it.each([null, '\ufeffEXPECTED\r\n'])('checks every expected previous image before writing any file, expected=%s', async expectedPrevious => {
    const adapter = storage();
    await adapter.writeText('projects/first.json', 'FIRST ORIGINAL');
    await adapter.writeText('projects/changed.json', '\ufeffEXTERNAL\r\n');
    const write = vi.spyOn(adapter, 'writeText'); const guard = vi.fn();
    await expect(withWorkbenchMutationLock(adapter, () => commitWorkbenchFileTransaction(adapter, [
      { path: 'projects/first.json', contents: 'FIRST NEXT', expectedPrevious: 'FIRST ORIGINAL' },
      { path: 'projects/changed.json', contents: 'SECOND NEXT', expectedPrevious },
    ], guard))).rejects.toMatchObject({ path: 'projects/changed.json' });
    expect(write).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
    expect(await adapter.readExactText?.('projects/first.json')).toBe('FIRST ORIGINAL');
    expect(await adapter.readExactText?.('projects/changed.json')).toBe('\ufeffEXTERNAL\r\n');
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('uses the checked exact previous image for recovery after an interrupted conditional write', async () => {
    const adapter = storage(); const original = '\ufeffIMPORTED SOURCE\r\n名称\r\n';
    await adapter.writeText('projects/original.json', original);
    const write = adapter.writeText.bind(adapter); let failed = false;
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === 'projects/second.json' && !failed) { failed = true; throw new Error('Interrupted second write'); }
      await write(path, text);
    });
    await expect(withWorkbenchMutationLock(adapter, () => commitWorkbenchFileTransaction(adapter, [
      { path: 'projects/original.json', contents: 'NEXT', expectedPrevious: original },
      { path: 'projects/second.json', contents: 'NEW', expectedPrevious: null },
    ]))).rejects.toThrow('Interrupted second write');
    expect(await adapter.readExactText?.('projects/original.json')).toBe(original);
    expect(await adapter.readText('projects/second.json')).toBeNull();
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    await commitWorkbenchFileTransaction(adapter, [{ path: 'projects/original.json', contents: 'RETRIED', expectedPrevious: original }]);
    expect(await adapter.readText('projects/original.json')).toBe('RETRIED');
  });
  it.each([0, 1, 2, 3])('recovers after %i completed file writes without leaving mixed revisions', async (completed) => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files }));
    for (const [index, file] of files.entries()) {
      const contents = index < completed ? file.next : file.previous;
      if (contents !== null) await adapter.writeText(file.path, contents);
    }
    await withWorkbenchMutationLock(adapter, async () => {
      for (const file of files) expect(await adapter.readText(file.path)).toBe(completed === files.length ? file.next : file.previous);
      expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
    });
    await recoverWorkbenchFileTransaction(adapter);
  });
  it('makes no project writes if the recovery journal cannot be stored', async () => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'ORIGINAL');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) throw new Error('Quota');
      return write(path, text);
    });
    await expect(commitWorkbenchFileTransaction(adapter, [{ path: 'workbench.json', contents: 'NEXT' }])).rejects.toThrow('Quota');
    expect(await adapter.readText('workbench.json')).toBe('ORIGINAL');
  });
  it('removes an empty newly created file left before its first write completed', async () => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files: [files[0]] }));
    await adapter.writeText(files[0].path, '');
    await recoverWorkbenchFileTransaction(adapter);
    expect(await adapter.readText(files[0].path)).toBeNull();
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
  it('recovers an empty first-write handle after earlier writes completed and before later indexes advance', async () => {
    const adapter = storage();
    const interruptedFiles = [files[0], { path: 'projects/new.json', previous: null, next: 'NEW PROJECT' }, files[2]];
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files: interruptedFiles }));
    await adapter.writeText(files[0].path, files[0].next);
    await adapter.writeText('projects/new.json', '');
    await adapter.writeText('workbench.json', files[2].previous);
    await recoverWorkbenchFileTransaction(adapter);
    expect(await exact(adapter, files[0].path)).toBeNull();
    expect(await exact(adapter, 'projects/new.json')).toBeNull();
    expect(await exact(adapter, 'workbench.json')).toBe(files[2].previous);
  });
  it.each(['project', 'committed'] as const)('retains an emptied source after the %s index state advanced', async (state) => {
    const adapter = storage();
    const journal = JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files });
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, journal);
    await adapter.writeText(files[0].path, '');
    await adapter.writeText(files[1].path, files[1].next);
    await adapter.writeText(files[2].path, state === 'committed' ? files[2].next : files[2].previous);
    const paths = [...files.map(({ path }) => path), WORKBENCH_FILE_TRANSACTION_PATH];
    const before = await Promise.all(paths.map((path) => exact(adapter, path)));
    const writes = vi.spyOn(adapter, 'writeText');
    const deletes = vi.spyOn(adapter, 'deleteText');
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('outside');
    expect(writes).not.toHaveBeenCalled();
    expect(deletes).not.toHaveBeenCalled();
    expect(await Promise.all(paths.map((path) => exact(adapter, path)))).toEqual(before);
  });
  it('retains a replacement journal and every file before immediate rollback', async () => {
    const adapter = storage();
    await adapter.writeText(files[1].path, files[1].previous);
    const write = adapter.writeText.bind(adapter);
    const replacement = '\ufeffEXTERNAL RECOVERY EVIDENCE\r\n';
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      if (path === files[1].path && text === files[1].next) {
        await write(WORKBENCH_FILE_TRANSACTION_PATH, replacement);
        throw new Error('Interrupted project write');
      }
      await write(path, text);
    });
    const deletes = vi.spyOn(adapter, 'deleteText');
    await expect(commitWorkbenchFileTransaction(adapter, files.slice(0, 2).map(({ path, next }) => ({ path, contents: next })))).rejects.toThrow('retained');
    expect(await exact(adapter, files[0].path)).toBe(files[0].next);
    expect(await exact(adapter, files[1].path)).toBe(files[1].previous);
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBe(replacement);
    expect(deletes).not.toHaveBeenCalled();
  });
  it('retains unexpected journal bytes after a failed first journal write', async () => {
    const adapter = storage();
    await adapter.writeText('workbench.json', 'ORIGINAL');
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, path === WORKBENCH_FILE_TRANSACTION_PATH ? 'UNRELATED JOURNAL' : text);
      if (path === WORKBENCH_FILE_TRANSACTION_PATH) throw new Error('Interrupted journal write');
    });
    const deletes = vi.spyOn(adapter, 'deleteText');
    await expect(commitWorkbenchFileTransaction(adapter, [{ path: 'workbench.json', contents: 'NEXT' }])).rejects.toThrow('outside');
    expect(await exact(adapter, 'workbench.json')).toBe('ORIGINAL');
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBe('UNRELATED JOURNAL');
    expect(deletes).not.toHaveBeenCalled();
  });
  it('retains a journal changed while recovery preflights its files', async () => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files }));
    await adapter.writeText(files[0].path, files[0].next);
    await adapter.writeText(files[1].path, files[1].previous);
    await adapter.writeText(files[2].path, files[2].previous);
    const read = adapter.readExactText!.bind(adapter);
    vi.spyOn(adapter, 'readExactText').mockImplementation(async (path) => {
      const text = await read(path);
      if (path === files[2].path) await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, 'REPLACED DURING PREFLIGHT');
      return text;
    });
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('outside');
    expect(await exact(adapter, files[0].path)).toBe(files[0].next);
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBe('REPLACED DURING PREFLIGHT');
  });
  it('reports committed writes while retaining a journal changed before final cleanup', async () => {
    const adapter = storage();
    const write = adapter.writeText.bind(adapter);
    vi.spyOn(adapter, 'writeText').mockImplementation(async (path, text) => {
      await write(path, text);
      if (path === 'projects/new.json') await write(WORKBENCH_FILE_TRANSACTION_PATH, '\ufeffEXTERNAL JOURNAL');
    });
    const deletes = vi.spyOn(adapter, 'deleteText');
    await commitWorkbenchFileTransaction(adapter, [{ path: 'projects/new.json', contents: 'SAVED' }]);
    expect(await exact(adapter, 'projects/new.json')).toBe('SAVED');
    expect(await exact(adapter, WORKBENCH_FILE_TRANSACTION_PATH)).toBe('\ufeffEXTERNAL JOURNAL');
    expect(deletes).not.toHaveBeenCalled();
  });
  it('retains evidence and refuses unexpected external edits during recovery', async () => {
    const adapter = storage();
    await adapter.writeText(WORKBENCH_FILE_TRANSACTION_PATH, JSON.stringify({ format: 'wire-edm-file-transaction', schemaVersion: 1, files }));
    await adapter.writeText('projects/part.json', 'EXTERNAL CHANGE');
    await expect(recoverWorkbenchFileTransaction(adapter)).rejects.toThrow('outside');
    expect(await adapter.readText('projects/part.json')).toBe('EXTERNAL CHANGE');
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).not.toBeNull();
  });
  it('retries cleanup after committed writes without reporting them as failed', async () => {
    const adapter = storage();
    const remove = adapter.deleteText.bind(adapter);
    vi.spyOn(adapter, 'deleteText').mockRejectedValueOnce(new Error('Cleanup interrupted')).mockImplementation(remove);
    await commitWorkbenchFileTransaction(adapter, [{ path: 'projects/new.json', contents: 'SAVED' }]);
    expect(await adapter.readText('projects/new.json')).toBe('SAVED');
    await recoverWorkbenchFileTransaction(adapter);
    expect(await adapter.readText('projects/new.json')).toBe('SAVED');
    expect(await adapter.readText(WORKBENCH_FILE_TRANSACTION_PATH)).toBeNull();
  });
});
