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
  if (!base64.length || base64.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Invalid compressed cache base64.');
  if (typeof DecompressionStream === 'undefined') return readExactUtf8Stream(fflateGzipStream(base64, signal), signal);
  let offset = 0;
  const stream = new ReadableStream<BufferSource>({
    pull(controller) {
      signal?.throwIfAborted();
      if (offset === base64.length) { controller.close(); return; }
      const end = Math.min(offset + chunkBytes, base64.length);
      controller.enqueue(base64Bytes(base64.slice(offset, end))); offset = end;
    }
  });
  return readExactUtf8Stream(stream.pipeThrough(new DecompressionStream('gzip')), signal);
}

function base64Bytes(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  if (btoa(binary) !== encoded) throw new Error('Invalid compressed cache base64 padding.');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** Validate each gzip member's footer: fflate itself does not check CRC/ISIZE. */
function fflateGzipStream(base64: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  let offset = 0, cancelled = false, crc = 0xffffffff, size = 0;
  let output: ReadableStreamDefaultController<Uint8Array>;
  function verifyFooter(end: number) {
    if (end < 8) throw new Error('Invalid compressed cache gzip footer.');
    const start = Math.floor((end - 8) / 3) * 4, tail = base64Bytes(base64.slice(start, Math.ceil(end / 3) * 4));
    const footer = new DataView(tail.buffer, tail.byteOffset + end - 8 - start / 4 * 3, 8);
    if (footer.getUint32(0, true) !== (crc ^ 0xffffffff) >>> 0 || footer.getUint32(4, true) !== size) throw new Error('Invalid compressed cache gzip checksum.');
  }
  const unzip = new Gunzip(bytes => {
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
    size = (size + bytes.length) >>> 0; output.enqueue(bytes);
  });
  unzip.onmember = end => { verifyFooter(end); crc = 0xffffffff; size = 0; };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (cancelled) return;
      signal?.throwIfAborted(); output = controller;
      const end = Math.min(offset + 4096, base64.length), final = end === base64.length;
      unzip.push(base64Bytes(base64.slice(offset, end)), final); offset = end;
      if (final) {
        verifyFooter(base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0));
        controller.close();
      }
    },
    cancel() { cancelled = true; }
  });
}
