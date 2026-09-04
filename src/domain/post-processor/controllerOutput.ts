import type { ControllerProgram } from './controllerProgram';
import type { WireEdmPostPackage } from './postPackageSchema';

export type ControllerOutputError =
  | { readonly code: 'POST_OUTPUT_ENCODING_INVALID'; readonly message: string }
  | { readonly code: 'POST_OUTPUT_NUMBERING_OVERFLOW'; readonly message: string };

export type SerializeControllerOutputResult =
  | { readonly ok: true; readonly text: string; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly error: ControllerOutputError };

export function serializeControllerOutput(
  program: ControllerProgram,
  output: WireEdmPostPackage['manifest']['output']
): SerializeControllerOutputResult {
  const separator = output.lineEnding === 'crlf' ? '\r\n' : '\n';
  const logicalText = program.text.replace(/\r\n|\r/g, '\n').replace(/\n+$/, '');
  const numbered = applyBlockNumbering(logicalText.split('\n'), output.blockNumbering);
  if (!numbered.ok) return numbered;
  const normalized = [
    ...output.programEnvelope.prefix,
    ...numbered.lines,
    ...output.programEnvelope.suffix
  ].join(separator);
  const text = output.finalNewline ? `${normalized}${separator}` : normalized;
  if (output.encoding === 'ascii' && /[^\x00-\x7F]/.test(text)) {
    return {
      ok: false,
      error: {
        code: 'POST_OUTPUT_ENCODING_INVALID',
        message: 'The post produced characters that cannot be encoded as ASCII.'
      }
    };
  }
  return { ok: true, text, bytes: new TextEncoder().encode(text) };
}

function applyBlockNumbering(
  lines: readonly string[],
  rule: WireEdmPostPackage['manifest']['output']['blockNumbering']
):
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly error: Extract<ControllerOutputError, { readonly code: 'POST_OUTPUT_NUMBERING_OVERFLOW' }> } {
  if (rule.mode === 'none') return { ok: true, lines };
  let number = rule.start;
  const numbered: string[] = [];
  for (const line of lines) {
    if (line === '') {
      numbered.push(line);
      continue;
    }
    if (!Number.isSafeInteger(number) || number > 99_999_999) {
      return {
        ok: false,
        error: {
          code: 'POST_OUTPUT_NUMBERING_OVERFLOW',
          message: 'Post block numbering exceeded the supported eight-digit range.'
        }
      };
    }
    numbered.push(`${rule.prefix}${String(number).padStart(rule.minimumWidth, '0')} ${line}`);
    number += rule.increment;
  }
  return { ok: true, lines: numbered };
}
