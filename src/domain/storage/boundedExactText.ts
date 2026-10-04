import type { BoundedExactTextResult } from './workbenchStorageAdapter';

/** Counts like TextEncoder, but avoids allocating a second copy of an oversized cache string. */
export function exceedsUtf8Limit(text: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4; index++;
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

export function isWellFormedText(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

export function assertReadLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 128 * 1024 * 1024) throw new Error('Invalid exact-read byte limit.');
}

/** Browser streaming decompression bounds expansion, validates gzip, and releases the stream on cancellation. */
export async function readBoundedGzip(base64: string, maxBytes: number, signal?: AbortSignal): Promise<BoundedExactTextResult> {
  assertReadLimit(maxBytes);
  signal?.throwIfAborted();
  // Limit the physical envelope too. Gzip framing overhead is allowed; oversized envelopes are omitted explicitly.
  if (base64.length > Math.ceil((maxBytes + 64 * 1024) / 3) * 4) return { status: 'too-large' };
  if (typeof DecompressionStream === 'undefined') throw new Error('Bounded gzip reading is unavailable in this browser.');
  const encoded = atob(base64);
  const bytes = Uint8Array.from(encoded, character => character.charCodeAt(0));
  let offset = 0;
  const input = new ReadableStream<BufferSource>({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end)); offset = end;
    }
  });
  const reader = input.pipeThrough(new DecompressionStream('gzip')).getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  let total = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return { status: 'too-large' };
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return { status: 'read', text: parts.join('') };
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
