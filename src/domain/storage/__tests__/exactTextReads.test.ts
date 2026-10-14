import { afterEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'fflate';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { createBrowserDirectoryAdapter } from '../browserDirectoryAdapter';
import { readExactUtf8Blob } from '../exactTextStream';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const prefix = '\u0000wire-edm-cache-gzip-v1:';
function folder(stream: ReadableStream<Uint8Array>) {
  const arrayBuffer = vi.fn();
  const blob = { stream: () => stream, arrayBuffer };
  const root = { name: 'exact-stream', getFileHandle: async () => ({ getFile: async () => blob }) } as unknown as FileSystemDirectoryHandle;
  return { adapter: createBrowserDirectoryAdapter(root), arrayBuffer };
}

describe('cancellable exact storage reads', () => {
  it('preserves a split BOM and multibyte codepoints while avoiding a whole-file byte buffer', async () => {
    const text = '\uFEFFOțel ⚙\r\n原\uFEFF';
    const bytes = new TextEncoder().encode(text); let index = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (index === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(index, ++index));
    } });
    const { adapter, arrayBuffer } = folder(stream);
    expect(await adapter.readExactText!('part.cad.json')).toBe(text);
    expect(arrayBuffer).not.toHaveBeenCalled(); expect(stream.locked).toBe(false);
  });
  it('cancels a pending folder read, releases its reader and cannot return partial text', async () => {
    const cancel = vi.fn(); let pullStarted!: () => void;
    const started = new Promise<void>(resolve => { pullStarted = resolve; });
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('\uFEFForiginal')); }
      else { pullStarted(); return new Promise<void>(() => {}); }
    }, cancel });
    const { adapter, arrayBuffer } = folder(stream); const abort = new AbortController();
    const pending = adapter.readExactText!('part.cad.json', abort.signal);
    await started; abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce(); expect(stream.locked).toBe(false); expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it('rejects invalid UTF-8 and releases the stream instead of replacing source bytes', async () => {
    const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xe2, 0x82])); controller.close(); }, cancel });
    const { adapter } = folder(stream);
    await expect(adapter.readExactText!('original.bin')).rejects.toThrow('exact UTF-8');
    expect(stream.locked).toBe(false);
  });
  it.each(['cache', 'folder'] as const)('does not begin an already cancelled %s exact read', async kind => {
    const abort = new AbortController(); abort.abort();
    const getFileHandle = vi.fn();
    const adapter = kind === 'folder' ? createBrowserDirectoryAdapter({ name: 'aborted', getFileHandle } as unknown as FileSystemDirectoryHandle)
      : createBrowserCacheAdapter(localStorage, { namespace: crypto.randomUUID() });
    await expect(adapter.readExactText!('missing.cad.json', abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getFileHandle).not.toHaveBeenCalled();
  });
  it('cancels streaming cache decompression without changing its stored envelope', async () => {
    const namespace = crypto.randomUUID(); const adapter = createBrowserCacheAdapter(localStorage, { namespace });
    const source = '\uFEFF' + 'Oțel ⚙\r\n'.repeat(700_000);
    await adapter.writeText('part.cad.json', source);
    const key = `${namespace}:file:part.cad.json`, stored = localStorage.getItem(key);
    expect(stored?.startsWith(prefix)).toBe(true);
    const abort = new AbortController(); const pending = adapter.readExactText!('part.cad.json', abort.signal);
    abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(localStorage.getItem(key)).toBe(stored);
    expect(await adapter.readExactText!('part.cad.json')).toBe(source);
  });
  it('rejects malformed plain-cache Unicode without rewriting it or disabling bounded rescue', async () => {
    const namespace = crypto.randomUUID(), key = `${namespace}:file:original.cad.json`;
    const original = 'original\ud800\r\n'; localStorage.setItem(key, original);
    const adapter = createBrowserCacheAdapter(localStorage, { namespace });
    await expect(adapter.readExactText!('original.cad.json')).rejects.toThrow('UTF-8');
    expect(localStorage.getItem(key)).toBe(original);
    expect(await adapter.readBoundedExactText!('original.cad.json', 4096)).toEqual({ status: 'read', text: original });
  });
  it('rejects malformed decompressed UTF-8, including a truncated final codepoint', async () => {
    const namespace = crypto.randomUUID(); const compressed = gzipSync(new Uint8Array([0xef, 0xbb, 0xbf, 0xe2, 0x82]));
    const envelope = prefix + btoa(String.fromCharCode(...compressed));
    localStorage.setItem(`${namespace}:file:original.bin`, envelope);
    const adapter = createBrowserCacheAdapter(localStorage, { namespace });
    await expect(adapter.readExactText!('original.bin')).rejects.toThrow();
    expect(localStorage.getItem(`${namespace}:file:original.bin`)).toBe(envelope);
  });
  it('reads bounded Blob slices with a multibyte character split across their boundary', async () => {
    const text = 'a'.repeat(65_535) + '⚙𐐀\uFEFF', bytes = new TextEncoder().encode(text);
    const slice = vi.fn((start: number, end: number) => ({ arrayBuffer: async () => bytes.slice(start, end).buffer }));
    const blob = { size: bytes.length, slice } as unknown as Blob;
    expect(await readExactUtf8Blob(blob)).toBe(text);
    expect(slice.mock.calls).toEqual([[0, 65_536], [65_536, bytes.length]]);
  });
  it('retains legacy compressed cache usability and cancels its cooperative fallback without native decompression', async () => {
    const namespace = crypto.randomUUID(), adapter = createBrowserCacheAdapter(localStorage, { namespace });
    const original = '\uFEFFOțel ⚙\r\n'.repeat(100_000);
    await adapter.writeText('original.cad.json', original);
    const key = `${namespace}:file:original.cad.json`, envelope = localStorage.getItem(key);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(await adapter.readExactText!('original.cad.json')).toBe(original);
    const abort = new AbortController(); const pending = adapter.readExactText!('original.cad.json', abort.signal);
    abort.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(localStorage.getItem(key)).toBe(envelope);
  });
  it.each(['native', 'fallback'] as const)('rejects corrupt gzip contents and malformed UTF-8 through the %s path', async mode => {
    const namespace = crypto.randomUUID(), adapter = createBrowserCacheAdapter(localStorage, { namespace });
    if (mode === 'fallback') vi.stubGlobal('DecompressionStream', undefined);
    for (const content of [new TextEncoder().encode('\uFEFFexact original'), new Uint8Array([0xe2, 0x82])]) {
      const compressed = gzipSync(content);
      if (content.length > 2) compressed[compressed.length - 8] ^= 1; // Corrupt the checksum, retain a complete deflate stream.
      const envelope = prefix + btoa(String.fromCharCode(...compressed)), key = `${namespace}:file:bad.bin`;
      localStorage.setItem(key, envelope);
      await expect(adapter.readExactText!('bad.bin')).rejects.toThrow();
      expect(localStorage.getItem(key)).toBe(envelope);
    }
  });
  it.each(['native', 'fallback'] as const)('validates each member of a complete concatenated gzip through the %s path', async mode => {
    if (mode === 'fallback') vi.stubGlobal('DecompressionStream', undefined);
    const namespace = crypto.randomUUID(), adapter = createBrowserCacheAdapter(localStorage, { namespace });
    const first = gzipSync(new TextEncoder().encode('\uFEFFfirst ⚙')), second = gzipSync(new TextEncoder().encode('\r\nsecond 原'));
    const combined = new Uint8Array(first.length + second.length); combined.set(first); combined.set(second, first.length);
    const key = `${namespace}:file:original.cad.json`;
    localStorage.setItem(key, prefix + btoa(String.fromCharCode(...combined)));
    expect(await adapter.readExactText!('original.cad.json')).toBe('\uFEFFfirst ⚙\r\nsecond 原');
    combined[first.length - 8] ^= 1;
    const corrupt = prefix + btoa(String.fromCharCode(...combined)); localStorage.setItem(key, corrupt);
    await expect(adapter.readExactText!('original.cad.json')).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(corrupt);
  });
});
