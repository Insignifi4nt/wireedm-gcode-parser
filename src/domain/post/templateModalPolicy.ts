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

const ROBOFIL_CONFLICTS = new Set([
  'G0',
  'G1',
  'G2',
  'G3',
  'G17',
  'G20',
  'G21',
  'G38',
  'G39',
  'G40',
  'G41',
  'G42',
  'G54',
  'G60',
  'G90',
  'G90.1',
  'G91',
  'G91.1',
  'G92',
  'M2',
  'M30'
]);

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
    stripGcodeComments(source)
      .split(/\r?\n/)
      .forEach((rawLine, index) => {
        const line = rawLine.toUpperCase();
        for (const match of line.matchAll(/([GM])0*(\d+(?:\.\d+)?)/g)) {
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

export function stripGcodeComments(source: string) {
  let result = source;
  let previous: string;
  do {
    previous = result;
    result = result.replace(/\([^()]*\)/g, '');
  } while (result !== previous);
  return result.replace(/;.*$/gm, '');
}
