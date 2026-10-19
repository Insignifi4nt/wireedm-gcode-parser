/**
 * Text shown to people, as opposed to the exact diagnostics kept for logs, tests and agents. Domain errors stay
 * precise; this boundary only rounds raw floating-point values and drops internal identifiers so a message reads
 * like an instruction rather than solver output.
 */

/** A length or ratio rounded for reading: at most four decimals, trailing zeros removed, tiny values bounded. */
export function formatUserNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const magnitude = Math.abs(value);
  if (magnitude < 0.0001) return `${value < 0 ? 'more than -' : 'less than '}0.0001`;
  const digits = magnitude >= 1000 ? 1 : 4;
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits, useGrouping: magnitude >= 100000 }).format(value);
}

// Computed values as JavaScript prints them, scientific notation with a signed exponent or a decimal with five or more
// fraction digits, standing alone: not part of a version, ID, hex colour, file name or path. Unsigned forms such as
// "1e5" are left alone because people write them in names.
const RAW_NUMBER = /(?<![\w.#/\\"'`-])-?(?:\d+(?:\.\d+)?[eE][+-]\d+|\d+\.\d{5,})(?![\w."'`/\\-]|\)\.\w)/g;
// Quoted spans are source text the person typed or imported and stay verbatim.
const VERBATIM = /("[^"\n]*"|\u201c[^\u201d\n]*\u201d|`[^`\n]*`)/;
// Generated identifiers some domain checks prefix to a message, e.g. "3f2a…-…: The line and arc…".
const ID_PREFIX = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z][\w-]*[-_]\d+(?:[-_][\w-]+)?):\s+(?=[A-Z])/;

/** Rewrites raw floats and leading internal identifiers in one message without changing its wording. */
export function readableMessage(text: string): string {
  return text.replace(ID_PREFIX, '').split(VERBATIM)
    .map((part, index) => index % 2 ? part : part.replace(RAW_NUMBER, match => formatUserNumber(Number(match)))).join('');
}

/** The readable message of an unknown failure, or `fallback` when it carries none. */
export function userFacingMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  return readableMessage(message.trim() || fallback);
}
