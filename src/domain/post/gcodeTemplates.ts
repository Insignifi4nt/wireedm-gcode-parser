import type { OutputExtension } from '@/domain/workbench/types';

export interface ComposeGCodeProgramInput {
  header: string;
  body: string;
  footer: string;
  lineEnding?: 'lf' | 'crlf';
}

export type GCodeProgramSectionName = 'header' | 'body' | 'footer';

export interface GCodeProgramLineMap {
  lineNumber: number;
  section: GCodeProgramSectionName;
  sectionLineNumber: number;
  text: string;
}

export interface GCodeProgramSectionMap {
  endLineNumber: number | null;
  lineCount: number;
  lineOffset: number;
  startLineNumber: number | null;
}

export interface GCodeProgramComposition {
  lines: GCodeProgramLineMap[];
  sections: Record<GCodeProgramSectionName, GCodeProgramSectionMap>;
  text: string;
}

export function composeGCodeProgram(input: ComposeGCodeProgramInput) {
  return composeGCodeProgramWithLineMap(input).text;
}

export function composeGCodeProgramWithLineMap({
  header,
  body,
  footer,
  lineEnding = 'crlf'
}: ComposeGCodeProgramInput): GCodeProgramComposition {
  const eol = lineEnding === 'crlf' ? '\r\n' : '\n';
  const lines: GCodeProgramLineMap[] = [];
  const sections = {
    header: mapSection('header', header, lines),
    body: mapSection('body', body, lines),
    footer: mapSection('footer', footer, lines)
  };

  return {
    lines,
    sections,
    text: `${lines.map((line) => line.text).join(eol)}${eol}`
  };
}

export function programLineForBodyLine(bodySection: GCodeProgramSectionMap, bodyLineIndex: number) {
  return bodySection.lineOffset + bodyLineIndex + 1;
}

export function formatProgramLineRangeForBodyRange(
  bodySection: GCodeProgramSectionMap,
  bodyLineStartIndex: number,
  bodyLineEndIndex: number
) {
  const start = programLineForBodyLine(bodySection, bodyLineStartIndex);
  const end = programLineForBodyLine(bodySection, bodyLineEndIndex);
  return start === end ? String(start) : `${start}-${end}`;
}

export function normalizeOutputExtension(
  extension: OutputExtension,
  customExtension?: string
) {
  if (extension !== 'custom') return extension;

  const normalized = (customExtension || '')
    .trim()
    .replace(/^\.+/, '')
    .toLowerCase();

  return normalized || 'gcode';
}

export function buildOutputFilename(
  baseName: string,
  extension: OutputExtension,
  customExtension?: string
) {
  const cleanBase = baseName.trim().replace(/\.[a-z0-9]+$/i, '') || 'wire-edm-output';
  return `${cleanBase}.${normalizeOutputExtension(extension, customExtension)}`;
}

function mapSection(
  section: GCodeProgramSectionName,
  source: string,
  lines: GCodeProgramLineMap[]
): GCodeProgramSectionMap {
  const lineOffset = lines.length;
  const sectionLines = splitComposedSectionLines(source);

  sectionLines.forEach((text, index) => {
    lines.push({
      lineNumber: lines.length + 1,
      section,
      sectionLineNumber: index + 1,
      text
    });
  });

  if (sectionLines.length === 0) {
    return {
      endLineNumber: null,
      lineCount: 0,
      lineOffset,
      startLineNumber: null
    };
  }

  return {
    endLineNumber: lineOffset + sectionLines.length,
    lineCount: sectionLines.length,
    lineOffset,
    startLineNumber: lineOffset + 1
  };
}

function splitComposedSectionLines(section: string) {
  const trimmed = section.trim();
  return trimmed ? trimmed.split(/\r?\n/) : [];
}
