import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { captureWorkbenchRecovery, recoveryStorageSource } from '../workbenchRecovery';
import { connectCachedWorkbench } from '../connectCachedWorkbench';
import { connectWorkbenchDirectory } from '../connectWorkbenchDirectory';
import { FakeDirectoryHandle } from './fakeDirectoryHandle';
import type { WorkbenchStorageAdapter } from '../workbenchStorageAdapter';

const hash = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
const locks = navigator.locks;
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Object.defineProperty(navigator, 'locks', { configurable: true, value: locks }); });

function setup(kind: string) {
  return kind === 'cache' ? createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() })
    : createBrowserDirectoryAdapter(new FakeDirectoryHandle('failed-folder') as unknown as FileSystemDirectoryHandle);
}

describe.each(['cache', 'folder'])('%s read-only recovery', kind => {
  it('retains exact invalid catalogs, pending journals, BOM/CRLF source and hashes with no mutations', async () => {
    const adapter = setup(kind);
    const originals = { 'workbench.json': '\uFEFF{"schemaVersion":3,', 'transactions/workbench-files.json': '{interrupted', 'imports/original.nc': '\uFEFFG90\r\nG1 X2 Y3\r\n' };
    for (const [path, text] of Object.entries(originals)) await adapter.writeText(path, text);
    const write = vi.spyOn(adapter, 'writeText'); const remove = vi.spyOn(adapter, 'deleteText'); const ensure = vi.spyOn(adapter, 'ensureDirectory');
    const exported = await captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: 'Catalog cannot open.' }));
    const archive = JSON.parse(exported.text);
    expect(archive.format).toBe('wire-edm-recovery-export');
    for (const [path, text] of Object.entries(originals)) {
      expect(archive.files).toContainEqual({ path, status: 'captured', text, textEncoding: 'utf8', logicalTextSha256: await hash(JSON.stringify(text)), utf8Sha256: await hash(text) });
      expect(await adapter.readExactText!(path)).toBe(text);
    }
    expect(exported.receipt).toMatchObject({ contentComplete: true, inventoryComplete: true, capturedFiles: 3, omittedFiles: 0, atomicSnapshot: false,
      archiveBytes: new TextEncoder().encode(exported.text).length, archiveSha256: await hash(exported.text) });
    expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(ensure).not.toHaveBeenCalled();
  });

  it('omits whole oversized files and JSON-escaped records rather than truncating original text', async () => {
    const adapter = setup(kind);
    await adapter.writeText('large.nc', 'x'.repeat(10_000));
    await adapter.writeText('escaped.nc', '\u0000'.repeat(1500));
    await adapter.writeText('small.nc', 'G90\r\n');
    const exported = await captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: '' }), { maxFileBytes: 5000, maxArchiveBytes: 8192 });
    const files = JSON.parse(exported.text).files;
    expect(files).toContainEqual({ path: 'large.nc', status: 'too-large' });
    expect(files).toContainEqual({ path: 'escaped.nc', status: 'archive-limit' });
    expect(files).toContainEqual(expect.objectContaining({ path: 'small.nc', status: 'captured', text: 'G90\r\n' }));
    expect(exported.receipt).toMatchObject({ contentComplete: false, inventoryComplete: true, omittedFiles: 2 });
    expect(exported.receipt.archiveBytes).toBeLessThanOrEqual(8192);
  });

  it('retains readable evidence while reporting missing files, unreadable files, changed and partial inventory', async () => {
    const adapter = setup(kind);
    await adapter.writeText('original.nc', 'G90');
    const inventory = vi.spyOn(adapter, 'listFiles').mockResolvedValueOnce({ paths: ['bad.nc', 'missing.nc', 'original.nc'], truncated: true })
      .mockResolvedValueOnce({ paths: ['added.nc', 'original.nc'], truncated: false });
    const read = adapter.readBoundedExactText!.bind(adapter);
    vi.spyOn(adapter, 'readBoundedExactText').mockImplementation((path, limit, signal) => path === 'bad.nc' ? Promise.reject(new Error('Invalid UTF-8')) : read(path, limit, signal));
    const exported = await captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: '' }));
    expect(JSON.parse(exported.text).files).toEqual(expect.arrayContaining([
      { path: 'bad.nc', status: 'unreadable', message: 'Invalid UTF-8' }, { path: 'missing.nc', status: 'missing' }, expect.objectContaining({ path: 'original.nc', text: 'G90' })
    ]));
    expect(exported.receipt).toMatchObject({ contentComplete: false, inventoryComplete: false, inventoryChangedDuringCapture: true });
    expect(inventory).toHaveBeenCalledTimes(2);
  });

  it('cancels between reads without returning or writing an archive', async () => {
    const adapter = setup(kind); await adapter.writeText('one.nc', 'G90');
    const control = new AbortController();
    const read = vi.spyOn(adapter, 'readBoundedExactText').mockImplementation(async () => { control.abort(); return { status: 'read', text: 'G90' }; });
    const write = vi.spyOn(adapter, 'writeText');
    await expect(captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: '' }), { signal: control.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(read).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
  });
});

it('bounds compressed cache expansion, preserves valid compressed BOM text, and reports corrupt envelopes', async () => {
  const namespace = crypto.randomUUID(); const adapter = createBrowserCacheAdapter(localStorage, { namespace });
  const text = '\uFEFF' + 'G90\r\n'.repeat(4000);
  await adapter.writeText('compressed.nc', text);
  expect(await adapter.readBoundedExactText!('compressed.nc', 64)).toEqual({ status: 'too-large' });
  expect(await adapter.readBoundedExactText!('compressed.nc', 30_000)).toEqual({ status: 'read', text });
  localStorage.setItem(`${namespace}:file:bad.nc`, '\u0000wire-edm-cache-gzip-v1:AAAA');
  const exported = await captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: '' }));
  expect(JSON.parse(exported.text).files).toContainEqual(expect.objectContaining({ path: 'bad.nc', status: 'unreadable' }));
  expect(exported.receipt.omittedFiles).toBe(1);
});

it('cancels streaming decompression and explicitly omits compressed files when the bounded primitive is unavailable', async () => {
  const adapter = setup('cache'); await adapter.writeText('compressed.nc', 'G90\r\n'.repeat(4000));
  const control = new AbortController();
  const pending = adapter.readBoundedExactText!('compressed.nc', 30_000, control.signal);
  control.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  vi.stubGlobal('DecompressionStream', undefined);
  const exported = await captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: '' }));
  expect(JSON.parse(exported.text).files).toContainEqual({ path: 'compressed.nc', status: 'unreadable', message: 'Bounded gzip reading is unavailable in this browser.' });
  expect(exported.receipt).toMatchObject({ omittedFiles: 1, contentComplete: false });
});

it('preserves malformed plain-cache UTF-16 code units with a truthful logical hash', async () => {
  const namespace = crypto.randomUUID(); const adapter = createBrowserCacheAdapter(localStorage, { namespace });
  const text = 'original\ud800\r\n'; localStorage.setItem(`${namespace}:file:source.nc`, text);
  const exported = await captureWorkbenchRecovery(recoveryStorageSource(adapter, { code: 'BLOCKED', message: '' }));
  expect(JSON.parse(exported.text).files[0]).toEqual({ path: 'source.nc', status: 'captured', text, textEncoding: 'utf16-code-units', utf8Sha256: null, logicalTextSha256: await hash(JSON.stringify(text)) });
});

it('preflights folder size without reading bytes and rejects invalid UTF-8 rather than replacing it', async () => {
  const readBytes = vi.fn(async () => new Uint8Array([0xff]).buffer);
  let size = 100;
  const root = { name: 'folder', getFileHandle: async () => ({ getFile: async () => ({ get size() { return size; }, arrayBuffer: readBytes }) }) } as unknown as FileSystemDirectoryHandle;
  const adapter = createBrowserDirectoryAdapter(root);
  expect(await adapter.readBoundedExactText!('binary.nc', 5)).toEqual({ status: 'too-large' }); expect(readBytes).not.toHaveBeenCalled();
  size = 1; await expect(adapter.readBoundedExactText!('binary.nc', 5)).rejects.toThrow(); expect(readBytes).toHaveBeenCalledOnce();
});

it('retains failed connection adapters for cache and folder without making them connected', async () => {
  localStorage.setItem('wire-edm-workbench:file:workbench.json', '{broken');
  const cache = await connectCachedWorkbench({ storage: localStorage });
  expect(cache.ok).toBe(false); expect(cache.recoverySource?.adapter.kind).toBe('browser-cache');
  const folder = new FakeDirectoryHandle('bad-folder'); folder.files.set('workbench.json', '{broken');
  const remember = vi.fn();
  const connected = await connectWorkbenchDirectory({ requestDirectory: async () => folder as unknown as FileSystemDirectoryHandle, handleStore: { read: async () => null, write: remember } });
  expect(connected.ok).toBe(false); expect(connected.recoverySource?.adapter.name).toBe('bad-folder'); expect(remember).not.toHaveBeenCalled();
});

it('exposes readable persistent cache beside temporary fallback without locks or a write probe', async () => {
  localStorage.setItem('wire-edm-workbench:file:workbench.json', '{broken');
  const write = vi.spyOn(Storage.prototype, 'setItem');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const connected = await connectCachedWorkbench({ storage: localStorage });
  if (!connected.ok || !connected.recoverySource) throw new Error('Expected temporary fallback and persistent recovery source.');
  expect(connected.workbench.adapter.kind).toBe('memory'); expect(connected.recoverySource.adapter.kind).toBe('browser-cache');
  const exported = await captureWorkbenchRecovery(connected.recoverySource);
  expect(exported.receipt.coordination).toBe('uncoordinated'); expect(JSON.parse(exported.text).files[0].text).toBe('{broken'); expect(write).not.toHaveBeenCalled();
});

it('can export a full, corrupt readable cache even when writes reject', async () => {
  localStorage.setItem('wire-edm-workbench:file:workbench.json', '{broken');
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
  const connected = await connectCachedWorkbench();
  if (connected.ok || !connected.recoverySource) throw new Error('Expected failed corrupt cache source.');
  write.mockClear();
  const exported = await captureWorkbenchRecovery(connected.recoverySource);
  expect(exported.receipt.capturedFiles).toBe(1); expect(write).not.toHaveBeenCalled();
});
