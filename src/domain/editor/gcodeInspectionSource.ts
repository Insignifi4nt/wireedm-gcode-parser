/** Interactive inspection limits are independent of editable project imports. */
export const GCODE_INSPECTION_MAX_BYTES = 2 * 1024 * 1024;
export const GCODE_INSPECTION_MAX_LINES = 50_000;

/** Decode without silently replacing bytes or dropping a UTF-8 byte-order mark. */
export async function readGCodeInspectionFile(file: Pick<Blob, 'size' | 'arrayBuffer'>): Promise<string> {
  if (file.size > GCODE_INSPECTION_MAX_BYTES) {
    throw new Error('Inspection supports files up to 2 MiB. Choose a smaller program or paste a section.');
  }
  const bytes = await file.arrayBuffer();
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new Error('This file is not valid UTF-8 or ASCII text. Convert its encoding explicitly before inspecting it.'); }
  const problem = validateGCodeInspectionSource(text);
  if (problem) throw new Error(problem);
  return text;
}

export function validateGCodeInspectionSource(text: string): string | null {
  if (!text.trim()) return 'Choose a program file or paste G-code to inspect.';
  if (new TextEncoder().encode(text).byteLength > GCODE_INSPECTION_MAX_BYTES) {
    return 'Inspection supports up to 2 MiB of program text. Open a smaller program or paste the section to inspect.';
  }
  if (text.includes('\0')) return 'This file contains binary or unsupported text encoding. Choose a plain-text program.';
  if (text.split(/\r\n|\r|\n/).length > GCODE_INSPECTION_MAX_LINES) {
    return 'Inspection supports up to 50,000 source lines. Paste the section to inspect.';
  }
  return null;
}
