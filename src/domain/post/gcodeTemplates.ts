import type { OutputExtension } from '@/domain/workbench/types';

export interface ComposeGCodeProgramInput {
  header: string;
  body: string;
  footer: string;
  lineEnding?: 'lf' | 'crlf';
}

export function composeGCodeProgram({
  header,
  body,
  footer,
  lineEnding = 'crlf'
}: ComposeGCodeProgramInput) {
  const eol = lineEnding === 'crlf' ? '\r\n' : '\n';
  const sections = [header, body, footer]
    .map((section) => section.trim())
    .filter(Boolean);

  return `${sections.join(eol)}${eol}`;
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
