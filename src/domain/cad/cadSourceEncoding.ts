/** Exact UTF-8 length without encoding a second source copy; null rejects unpaired surrogates. */
export function cadUtf8SourceLength(text: string): number | null {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return null;
      bytes += 4;
    } else if (code >= 0xdc00 && code <= 0xdfff) return null;
    else bytes += 3;
  }
  return bytes;
}
