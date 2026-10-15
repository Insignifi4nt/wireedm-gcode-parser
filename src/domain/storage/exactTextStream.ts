import { Gunzip } from 'fflate';

const chunkBytes = 64 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});

/** Complete, strict UTF-8 text; preserve a leading BOM and release pending I/O on cancellation. */
export async function readExactUtf8Stream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const reader = stream.getReader(), decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const parts: string[] = [];
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Blob.stream is preferred. Older Blob implementations read only one bounded slice at a time. */
export async function readExactUtf8Blob(blob: Blob, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  if (typeof blob.stream === 'function') return readExactUtf8Stream(blob.stream(), signal);
  let offset = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      signal?.throwIfAborted();
      if (offset >= blob.size) { controller.close(); return; }
      const end = Math.min(offset + chunkBytes, blob.size);
      const bytes = await blob.slice(offset, end).arrayBuffer();
      if (cancelled) return;
      signal?.throwIfAborted();
      controller.enqueue(new Uint8Array(bytes)); offset = end;
    },
    cancel() { cancelled = true; }
  });
  return readExactUtf8Stream(stream, signal);
}

/** Decode the cache envelope incrementally; no complete binary base64 or expanded byte buffer. */
export async function readExactUtf8GzipBase64(base64: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  // Compression Streams only permits one gzip member; cache files retain the
  // complete RFC1952 member series through one deliberate portable decoder.
  return readExactUtf8Stream(createStrictGzipByteStream(base64, signal), signal);
}

function base64Bytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  if (btoa(binary) !== encoded) throw new Error('Invalid compressed cache base64 padding.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Full consumption validates every real member and exact source completion.
 * Consumers may cancel early for bounded rescue without retaining a full output. */
export function createStrictGzipByteStream(base64: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  signal?.throwIfAborted();
  if (!base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid compressed cache base64.');
  const byteLength = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  let windowStart = -1, window = new Uint8Array(0);
  function byteAt(position: number) {
    if (position < 0 || position >= byteLength) throw new Error('Truncated compressed cache gzip header.');
    const start = Math.floor(position / 3072) * 3072;
    if (windowStart !== start) { window = base64Bytes(base64.slice(start / 3 * 4, Math.min(start / 3 * 4 + 4096, base64.length))); windowStart = start; }
    return window[position - start];
  }
  function headerEnd(start: number) {
    let position = start, headerCrc = 0xffffffff;
    const next = () => { const byte = byteAt(position++); headerCrc = crcTable[(headerCrc ^ byte) & 255] ^ headerCrc >>> 8; return byte; };
    if (next() !== 31 || next() !== 139 || next() !== 8) throw new Error('Invalid compressed cache gzip header.');
    const flags = next();
    if (flags & 0xe0) throw new Error('Invalid compressed cache gzip reserved flags.');
    for (let index = 0; index < 6; index++) next();
    if (flags & 4) { const length = next() | next() << 8; for (let index = 0; index < length; index++) next(); }
    for (const flag of [8, 16]) if (flags & flag) while (next() !== 0) { /* NUL-terminated original name/comment. */ }
    if (flags & 2) {
      const expected = byteAt(position++) | byteAt(position++) << 8;
      if (expected !== ((headerCrc ^ 0xffffffff) & 0xffff)) throw new Error('Invalid compressed cache gzip header checksum.');
    }
    return position;
  }
  let offset = 0, cancelled = false, crc = 0xffffffff, size = 0, completion = false, enqueued = false, workUntil = 0;
  let currentHeaderEnd = headerEnd(0);
  let output: ReadableStreamDefaultController<Uint8Array>;
  function verifyFooter(end: number) {
    if (end < currentHeaderEnd + 10 || end > byteLength) throw new Error('Invalid compressed cache gzip footer.');
    const start = Math.floor((end - 8) / 3) * 4, tail = base64Bytes(base64.slice(start, Math.ceil(end / 3) * 4));
    const footer = new DataView(tail.buffer, tail.byteOffset + end - 8 - start / 4 * 3, 8);
    if (footer.getUint32(0, true) !== (crc ^ 0xffffffff) >>> 0 || footer.getUint32(4, true) !== size) throw new Error('Invalid compressed cache gzip checksum.');
  }
  const unzip = new Gunzip(bytes => {
    if (completion) { if (bytes.length) throw new Error('Invalid compressed cache gzip completion.'); return; }
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    size = (size + bytes.length) >>> 0;
    if (bytes.length) { output.enqueue(bytes); enqueued = true; }
  });
  unzip.onmember = end => {
    verifyFooter(end);
    if (end === byteLength) completion = true;
    else currentHeaderEnd = headerEnd(end);
    crc = 0xffffffff; size = 0;
  };
  // Gunzip's public callback reports the *next* member's offset. A known empty
  // member proves the final real boundary equals the exact source byte length;
  // it emits no text and is never added to stored/source data.
  const completionMember = new Uint8Array([31, 139, 8, 0, 0, 0, 0, 0, 0, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      output = controller; enqueued = false;
      // A header spanning input chunks produces no output; continue reading it
      // cooperatively instead of leaving the pending consumer stalled.
      while (!enqueued && !completion) {
        if (performance.now() >= workUntil) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          workUntil = performance.now() + 8;
        }
        if (cancelled) return;
        signal?.throwIfAborted();
        if (offset === base64.length) {
          unzip.push(completionMember, true);
          if (!completion) throw new Error('Incomplete compressed cache gzip member.');
          controller.close();
        } else {
          const end = Math.min(offset + 4096, base64.length);
          unzip.push(base64Bytes(base64.slice(offset, end)), false); offset = end;
        }
      }
    },
    cancel() { cancelled = true; }
  });
}
