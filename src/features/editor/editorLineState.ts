import type { GCodeStructuredLine, GCodeStructure } from '@/domain/editor/gcodeStructure';

import type { EditorGuideLanguage } from './editorGuideContent';

const GUIDE_LANGUAGE_STORAGE_KEY = 'wireedm.guideLanguage';
const LINE_MODE_STORAGE_KEY = 'gcodeDrawerMode';

export interface EditorLineRow extends GCodeStructuredLine {
  section: 'header' | 'body' | 'footer';
}

export function flattenStructureLines(structure: GCodeStructure): EditorLineRow[] {
  return [
    ...structure.header.lines.map((line) => ({ ...line, section: 'header' as const })),
    ...structure.body.lines.map((line) => ({ ...line, section: 'body' as const })),
    ...structure.footer.lines.map((line) => ({ ...line, section: 'footer' as const }))
  ].sort((a, b) => a.num - b.num);
}

export function toggleLine(lines: number[], lineNumber: number) {
  const next = new Set(lines);
  if (next.has(lineNumber)) {
    next.delete(lineNumber);
  } else {
    next.add(lineNumber);
  }

  return [...next].sort((a, b) => a - b);
}

export function selectLineRange(rows: EditorLineRow[], fromLine: number, toLine: number) {
  const fromIndex = rows.findIndex((row) => row.num === fromLine);
  const toIndex = rows.findIndex((row) => row.num === toLine);
  if (fromIndex < 0 || toIndex < 0) return [toLine];

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return rows.slice(start, end + 1).map((row) => row.num);
}

export function readStoredGroupExpanded(groupId: string) {
  try {
    return globalThis.localStorage.getItem(groupStorageKey(groupId)) !== 'false';
  } catch {
    return true;
  }
}

export function writeStoredGroupExpanded(groupId: string, expanded: boolean) {
  try {
    globalThis.localStorage.setItem(groupStorageKey(groupId), String(expanded));
  } catch {
    // Folder collapse is a convenience preference; editing must keep working without storage.
  }
}

export function readStoredGuideLanguage(): EditorGuideLanguage {
  try {
    const stored = globalThis.localStorage.getItem(GUIDE_LANGUAGE_STORAGE_KEY);
    return stored === 'ro' ? 'ro' : 'en';
  } catch {
    return 'en';
  }
}

export function writeStoredGuideLanguage(language: EditorGuideLanguage) {
  try {
    globalThis.localStorage.setItem(GUIDE_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Local storage can be unavailable in stricter browser contexts.
  }
}

export function readStoredLineMode(): 'select' | 'edit' {
  try {
    return globalThis.localStorage.getItem(LINE_MODE_STORAGE_KEY) === 'edit' ? 'edit' : 'select';
  } catch {
    return 'select';
  }
}

export function writeStoredLineMode(mode: 'select' | 'edit') {
  try {
    globalThis.localStorage.setItem(LINE_MODE_STORAGE_KEY, mode);
  } catch {
    // Select/Edit mode is only a convenience preference.
  }
}

export function confirmBulkLineDelete(count: number) {
  if (typeof globalThis.confirm !== 'function') return true;
  return globalThis.confirm(`Delete ${count} selected lines? Use Ctrl+Z to undo if needed.`);
}

export function confirmGroupDelete(groupId: string, count: number) {
  if (typeof globalThis.confirm !== 'function') return true;
  return globalThis.confirm(`Delete folder '${groupId}' with ${count} lines? Use Ctrl+Z to undo.`);
}

export function sanitizeLineText(text: string) {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trimEnd();
}

export function formatBounds(bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return '-';
  }

  return `X${bounds.minX.toFixed(3)}..${bounds.maxX.toFixed(3)} Y${bounds.minY.toFixed(3)}..${bounds.maxY.toFixed(3)}`;
}

function groupStorageKey(groupId: string) {
  if (groupId === 'header' || groupId === 'footer') {
    return `gcodeDrawer.folder.${groupId}`;
  }

  return `gcodeDrawer.contour.${groupId}`;
}
