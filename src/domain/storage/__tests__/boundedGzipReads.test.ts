import { gzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserCacheAdapter } from '../browserCacheAdapter';
import { readBoundedGzip } from '../boundedExactText';
import { captureWorkbenchRecovery, recoveryStorageSource } from '../workbenchRecovery';

const prefix = '\u0000wire-edm-cache-gzip-v1:';
const encode = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
function concatenate(...members: readonly Uint8Array[]) {
  const result = new Uint8Array(members.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0; for (const member of members) { result.set(member, offset); offset += member.length; }
  return result;
}
function stored(bytes: Uint8Array) {
  const namespace = crypto.randomUUID(), key = `${namespace}:file:original.nc`, original = prefix + encode(bytes);
  localStorage.setItem(key, original);
  return { key, original, adapter: createBrowserCacheAdapter(localStorage, { namespace }) };
}
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe.each(['native-present', 'native-absent'] as const)('%s bounded exact gzip reads', availability => {
  function configure() {
    if (availability === 'native-absent') vi.stubGlobal('DecompressionStream', undefined);
    else expect(typeof DecompressionStream).toBe('function');
  }
  it('reads both members of a tiny complete gzip at its exact text-byte limit', async () => {
    configure();
    const source = stored(concatenate(gzipSync(new TextEncoder().encode('abc')), gzipSync(new TextEncoder().encode('def'))));
    expect(await source.adapter.readBoundedExactText!('original.nc', 6)).toEqual({ status: 'read', text: 'abcdef' });
    expect(localStorage.getItem(source.key)).toBe(source.original);
  });
  it('reads all concatenated members at the exact byte boundary, preserving split BOM/UTF-8 and stored originals', async () => {
    configure();
    const text = '\uFEFFOțel ⚙\r\n原\uFEFF', bytes = new TextEncoder().encode(text), split = bytes.indexOf(0xe2) + 1;
    const source = stored(concatenate(gzipSync(bytes.subarray(0, 2)), gzipSync(bytes.subarray(2, split)), gzipSync(bytes.subarray(split)), gzipSync(new Uint8Array())));
    expect(await source.adapter.readBoundedExactText!('original.nc', bytes.length)).toEqual({ status: 'read', text });
    expect(await source.adapter.readBoundedExactText!('original.nc', bytes.length - 1)).toEqual({ status: 'too-large' });
    expect(await source.adapter.readBoundedExactText!('original.nc', bytes.length + 1)).toEqual({ status: 'read', text });
    expect(localStorage.getItem(source.key)).toBe(source.original);
    const write = vi.spyOn(source.adapter, 'writeText'), remove = vi.spyOn(source.adapter, 'deleteText');
    const recovery = await captureWorkbenchRecovery(recoveryStorageSource(source.adapter, { code: 'BLOCKED', message: 'Read-only rescue' }));
    expect(JSON.parse(recovery.text).files).toContainEqual(expect.objectContaining({ path: 'original.nc', status: 'captured', text }));
    expect(recovery.receipt).toMatchObject({ contentComplete: true, capturedFiles: 1, omittedFiles: 0 });
    expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(localStorage.getItem(source.key)).toBe(source.original);
  });
  it('rejects corrupt, truncated, trailing and invalid UTF-8 members without rescuing partial contents or changing originals', async () => {
    configure();
    const first = gzipSync(new TextEncoder().encode('\uFEFFfirst')), second = gzipSync(new TextEncoder().encode('second'));
    const crc = second.slice(); crc[crc.length - 8] ^= 1;
    const size = second.slice(); size[size.length - 4] ^= 1;
    const reserved = second.slice(); reserved[3] |= 0x20;
    const invalidUtf8 = gzipSync(new Uint8Array([0xe2, 0x82]));
    for (const bytes of [concatenate(first, crc), concatenate(first, size), concatenate(first, reserved), concatenate(first, second.slice(0, -1)),
      concatenate(first, second.slice(0, 7)), concatenate(first, second, new Uint8Array([0])), concatenate(first, invalidUtf8)]) {
      const source = stored(bytes);
      await expect(source.adapter.readBoundedExactText!('original.nc', 4096)).rejects.toThrow();
      expect(localStorage.getItem(source.key)).toBe(source.original);
      const recovery = await captureWorkbenchRecovery(recoveryStorageSource(source.adapter, { code: 'BLOCKED', message: '' }));
      expect(JSON.parse(recovery.text).files).toContainEqual(expect.objectContaining({ path: 'original.nc', status: 'unreadable' }));
      expect(localStorage.getItem(source.key)).toBe(source.original);
    }
  });
  it('cancels decompression, releases every acquired reader, and retains its complete cache envelope', async () => {
    configure();
    const source = stored(concatenate(gzipSync(new TextEncoder().encode('first'.repeat(20_000))), gzipSync(new TextEncoder().encode('second'))));
    const readers: ReadableStreamDefaultReader[] = [], streams: ReadableStream[] = [], getReader = ReadableStream.prototype.getReader;
    vi.spyOn(ReadableStream.prototype, 'getReader').mockImplementation(function(this: ReadableStream) {
      const reader = getReader.call(this) as ReadableStreamDefaultReader; readers.push(reader); streams.push(this); return reader;
    });
    const control = new AbortController(), pending = source.adapter.readBoundedExactText!('original.nc', 128 * 1024, control.signal);
    control.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(readers.length).toBeGreaterThan(0);
    for (const stream of streams) expect(stream.locked).toBe(false);
    expect(localStorage.getItem(source.key)).toBe(source.original);
    expect(await source.adapter.readBoundedExactText!('original.nc', 128 * 1024)).toEqual({ status: 'read', text: 'first'.repeat(20_000) + 'second' });
    expect(localStorage.getItem(source.key)).toBe(source.original);
  });
  it('stops expanded output before text retention and reads only base64 chunks while preserving the oversized source', async () => {
    configure();
    let seed = 0x24cafe;
    const tail = Array.from({ length: 50_000 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return String.fromCharCode(33 + seed % 90); }).join('');
    const source = stored(concatenate(gzipSync(new TextEncoder().encode('G90\r\n'.repeat(20_000))), gzipSync(new TextEncoder().encode(tail))));
    expect(source.original.length).toBeGreaterThan(4096);
    expect(source.original.length).toBeLessThan(Math.ceil((16 + 64 * 1024) / 3) * 4);
    const decode = vi.spyOn(TextDecoder.prototype, 'decode'), base64 = vi.spyOn(globalThis, 'atob');
    const streams: ReadableStream[] = [], getReader = ReadableStream.prototype.getReader;
    vi.spyOn(ReadableStream.prototype, 'getReader').mockImplementation(function(this: ReadableStream) { streams.push(this); return getReader.call(this) as ReadableStreamDefaultReader; });
    expect(await source.adapter.readBoundedExactText!('original.nc', 16)).toEqual({ status: 'too-large' });
    expect(decode).not.toHaveBeenCalled();
    expect(base64.mock.calls.length).toBeGreaterThan(0);
    expect(base64.mock.calls.every(([encoded]) => encoded.length <= 4096)).toBe(true);
    expect(base64.mock.calls.reduce((sum, [encoded]) => sum + encoded.length, 0)).toBeLessThan(source.original.length);
    for (const stream of streams) expect(stream.locked).toBe(false);
    expect(localStorage.getItem(source.key)).toBe(source.original);
  });
});

it('omits an oversized physical envelope before decoding and keeps the explicit bounded-read policy', async () => {
  const decode = vi.spyOn(globalThis, 'atob');
  expect(await readBoundedGzip('A'.repeat(Math.ceil(65536 / 3) * 4 + 4), 0)).toEqual({ status: 'too-large' });
  expect(decode).not.toHaveBeenCalled();
  await expect(readBoundedGzip('', 128 * 1024 * 1024 + 1)).rejects.toThrow('Invalid exact-read byte limit');
  await expect(readBoundedGzip('', -1)).rejects.toThrow('Invalid exact-read byte limit');
});
