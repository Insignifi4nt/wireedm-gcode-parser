const encoder = new TextEncoder();

export function jsonByteLength(value: unknown) {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

/** Bound display prose by its serialized size, including UTF-8 and JSON escapes. IDs are never shortened. */
export function summarizeMessage(message: string) {
  let low = 0;
  let high = Math.min(message.length, 1024);
  while (low < high) {
    const end = Math.ceil((low + high) / 2);
    if (jsonByteLength(message.slice(0, end)) <= 1024) low = end;
    else high = end - 1;
  }
  // Do not leave half of a supplementary Unicode character at the boundary.
  if (low < message.length && /[\uD800-\uDBFF]/.test(message.charAt(low - 1))) low -= 1;
  return { message: message.slice(0, low), ...(low < message.length ? { messageTruncated: true as const } : {}) };
}

export function summarizeDiagnostic<T extends { readonly message: string }>(diagnostic: T) {
  return { ...diagnostic, ...summarizeMessage(diagnostic.message) };
}

/** Leave room for the surrounding result and its durable revision receipt. */
export function summarizeDiagnostics<T extends { readonly message: string }>(diagnostics: readonly T[]) {
  const summaries = diagnostics.slice(0, 20).map(summarizeDiagnostic);
  while (summaries.length && jsonByteLength(summaries) > 24 * 1024) summaries.pop();
  return { diagnostics: summaries, omittedDiagnosticCount: diagnostics.length - summaries.length };
}
