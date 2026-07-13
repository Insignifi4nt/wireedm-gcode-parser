import {
  createGCodeInterpreterState,
  interpretGCodeBlock,
  type GCodeWord
} from '@/domain/editor/gcodeBlockInterpreter';
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

export interface ExecutableGCodeWord extends GCodeWord {
  lineNumber: number;
}

export function validateTemplateModalPolicy({
  machine,
  header,
  footer
}: TemplateModalPolicyInput): TemplateModalPolicyResult {
  const diagnostics: TemplateModalPolicyDiagnostic[] = [];
  for (const [section, source] of [
    ['header', header],
    ['footer', footer]
  ] as const) {
    if (machine.controller.family !== 'charmilles-robofil-classic') {
      for (const match of scanExecutableGCodeWords(source)) {
        if (
          match.letter !== 'G' ||
          (match.value !== 20 && match.value !== 41 && match.value !== 42)
        ) {
          continue;
        }
        const word = `G${match.value}`;
        diagnostics.push({
          section,
          lineNumber: match.lineNumber,
          word,
          message: `${word} conflicts with structured millimetre controller compensation.`
        });
      }
      continue;
    }

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

export function scanExecutableGCodeWords(source: string): ExecutableGCodeWord[] {
  const state = createGCodeInterpreterState();
  return source.split(/\r?\n/).flatMap((line, index) =>
    interpretGCodeBlock(state, line, index + 1).words.map((word) => ({
      ...word,
      lineNumber: index + 1
    }))
  );
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

export function inferTemplateArcCenterMode(header: string): 'absolute' | 'incremental' {
  return inspectTemplateModalState(header).ijMode;
}

export function inspectTemplateModalState(header: string) {
  const state = createGCodeInterpreterState();
  let hasExplicitXyMode = false;
  header.split(/\r?\n/).forEach((line, index) => {
    const result = interpretGCodeBlock(state, line, index + 1);
    if (
      result.words.some(
        (word) => word.letter === 'G' && (word.value === 90 || word.value === 91)
      )
    ) {
      hasExplicitXyMode = true;
    }
  });
  return {
    xyMode: state.xyMode,
    ijMode: state.ijMode,
    hasExplicitXyMode
  };
}
