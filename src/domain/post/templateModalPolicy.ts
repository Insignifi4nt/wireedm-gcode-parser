import type { MachineProfile } from '@/domain/workbench/types';

export interface TemplateModalPolicyInput {
  machine: MachineProfile;
  header: string;
  footer: string;
}

export interface TemplateModalPolicyDiagnostic {
  section: 'header' | 'footer';
  lineNumber: number;
  word: string;
  message: string;
}

export interface TemplateModalPolicyResult {
  valid: boolean;
  diagnostics: TemplateModalPolicyDiagnostic[];
}

const ROBOFIL_CONFLICTS = new Set(['G17', 'G21', 'G40', 'G41', 'G42', 'G54', 'M30']);

export function validateTemplateModalPolicy({
  machine,
  header,
  footer
}: TemplateModalPolicyInput): TemplateModalPolicyResult {
  if (machine.controller.family !== 'charmilles-robofil-classic') {
    return { valid: true, diagnostics: [] };
  }

  const diagnostics: TemplateModalPolicyDiagnostic[] = [];
  for (const [section, source] of [
    ['header', header],
    ['footer', footer]
  ] as const) {
    stripParentheticalComments(source)
      .split(/\r?\n/)
      .forEach((rawLine, index) => {
        const line = rawLine.replace(/;.*$/, '').toUpperCase();
        for (const match of line.matchAll(/([GM])0*(\d+)(?![\d.])/g)) {
          const word = `${match[1]}${Number(match[2])}`;
          if (!ROBOFIL_CONFLICTS.has(word)) continue;
          diagnostics.push({
            section,
            lineNumber: index + 1,
            word,
            message: `${word} conflicts with the structured Robofil post policy.`
          });
        }
      });
  }

  return { valid: diagnostics.length === 0, diagnostics };
}

function stripParentheticalComments(source: string) {
  let result = source;
  let previous: string;
  do {
    previous = result;
    result = result.replace(/\([^()]*\)/g, '');
  } while (result !== previous);
  return result;
}
