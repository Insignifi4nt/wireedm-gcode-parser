import { Type, type Static } from '@sinclair/typebox';
import { MAX_MACHINE_PACKAGE_ARCHIVE_BYTES } from '@/domain/machine-package';
import { object, ToolError } from './siteTools';

export const MAX_MACHINE_PACKAGE_BASE64_CHARACTERS = Math.ceil(MAX_MACHINE_PACKAGE_ARCHIVE_BYTES / 3) * 4;
export const machinePackageSource = object({
  fileName: Type.String({ minLength: 1, maxLength: 200, pattern: /^[^/\\\u0000-\u001f]+$/.source, description: 'A filename ending in .wireedm-package, without a path.' }),
  base64: Type.String({ minLength: 4, maxLength: MAX_MACHINE_PACKAGE_BASE64_CHARACTERS,
    description: 'Complete archive bytes as canonical padded standard base64, without whitespace or a data URL. Maximum decoded size: 32 MiB.' })
});

/** Decode only the supplied archive bytes; no path, URL or persistent upload state. */
export async function machinePackageInputFile(input: Static<typeof machinePackageSource>, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  if (!/\.wireedm-package$/i.test(input.fileName) || /[/\\\u0000-\u001f]/.test(input.fileName)) {
    throw new ToolError('WRONG_FILE', 'Supply a filename ending in .wireedm-package, without a path. Standalone posts cannot be installed.');
  }
  const { base64 } = input;
  if (base64.length > MAX_MACHINE_PACKAGE_BASE64_CHARACTERS) throw tooLarge();
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const byteLength = base64.length / 4 * 3 - padding;
  if (byteLength > MAX_MACHINE_PACKAGE_ARCHIVE_BYTES) throw tooLarge();
  if (!base64.length || base64.length % 4 !== 0) throw invalidEncoding();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lastValue = alphabet.indexOf(base64[base64.length - padding - 1]);
  if (lastValue < 0 || (padding === 2 && (lastValue & 15) !== 0) || (padding === 1 && (lastValue & 3) !== 0)) throw invalidEncoding();
  const bytes = new Uint8Array(byteLength);
  const chunkSize = 65_536;
  let writeOffset = 0;
  for (let offset = 0; offset < base64.length; offset += chunkSize) {
    signal.throwIfAborted();
    const end = Math.min(offset + chunkSize, base64.length);
    const chunk = base64.slice(offset, end);
    if (/[^A-Za-z0-9+/]/.test(base64.slice(offset, Math.min(end, base64.length - padding)))) throw invalidEncoding();
    let decoded: string;
    try { decoded = atob(chunk); } catch { throw invalidEncoding(); }
    for (let index = 0; index < decoded.length; index++) bytes[writeOffset++] = decoded.charCodeAt(index);
    // Let cancellation and visible activity run between bounded decoding batches.
    if (end < base64.length && end % (chunkSize * 16) === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return new File([bytes.buffer], input.fileName, { type: 'application/zip' });
}

function invalidEncoding() {
  return new ToolError('INVALID_ENCODING', 'source.base64 must contain canonical padded standard base64 archive bytes, without whitespace, a URL or a data URL.');
}
function tooLarge() {
  return new ToolError('INPUT_TOO_LARGE', 'Machine package archive bytes must be 32 MiB or smaller.');
}
