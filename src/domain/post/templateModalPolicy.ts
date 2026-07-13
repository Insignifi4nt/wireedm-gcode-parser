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
        const residue = rawLine.trim();
        if (!residue) return;
        const modalWord = residue.toUpperCase().match(/([GM])0*(\d+(?:\.\d+)?)/);
        const word = modalWord
          ? `${modalWord[1]}${Number(modalWord[2])}`
          : residue.split(/\s+/, 1)[0];
        diagnostics.push({
          section,
          lineNumber: index + 1,
          word,
          message: `Executable template residue ${JSON.stringify(residue)} conflicts with the structured Robofil post policy.`
        });
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
