/**
 * Program lines as the G-code parser numbers them. CRLF, LF and a lone CR each
 * end a line, so line numbers agree across parsing, cleanup and line edits.
 */
export function splitGCodeLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}
