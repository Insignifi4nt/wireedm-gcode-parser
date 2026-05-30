import { isMotionCommand, organizeGCodeStructure, type GCodeContourGroup, type GCodeStructure } from './gcodeStructure';
import { canonicalizeMotionCodes } from './isoNormalizer';

export interface MoveBodyGroupResult {
  text: string;
  movedLineNumbers: number[];
}

export interface DeleteBodyGroupResult {
  text: string;
  deletedLineNumbers: number[];
}

export interface MoveSelectedLinesResult {
  text: string;
  movedLineNumbers: number[];
}

export interface SetStartAtLineResult {
  text: string;
  newStartLine: number;
}

export function moveBodyGroup(
  text: string,
  structure: GCodeStructure,
  groupId: string,
  direction: -1 | 1
): MoveBodyGroupResult | null {
  const groups = structure.body.contours ?? [];
  const groupIndex = groups.findIndex((group) => group.id === groupId);
  const targetIndex = groupIndex + direction;

  if (groupIndex < 0 || targetIndex < 0 || targetIndex >= groups.length) return null;

  const currentGroup = groups[groupIndex];
  const neighborGroup = groups[targetIndex];
  if (currentGroup.lines.length === 0 || neighborGroup.lines.length === 0) return null;

  const allLines = splitProgramLines(text);
  const startIndex = currentGroup.lines[0].num - 1;
  const endIndex = currentGroup.lines.at(-1)!.num - 1;
  const blockLength = endIndex - startIndex + 1;
  const movedLines = allLines.splice(startIndex, blockLength);
  const insertIndex =
    direction < 0
      ? neighborGroup.lines[0].num - 1
      : neighborGroup.lines[0].num - 1 - blockLength + neighborGroup.lines.length;

  allLines.splice(Math.max(insertIndex, 0), 0, ...movedLines);

  const newStartLine =
    direction < 0
      ? neighborGroup.lines[0].num
      : neighborGroup.lines[0].num - blockLength + neighborGroup.lines.length;

  return {
    text: allLines.join('\n'),
    movedLineNumbers: range(newStartLine, newStartLine + blockLength - 1)
  };
}

export function deleteBodyGroup(
  text: string,
  structure: GCodeStructure,
  groupId: string
): DeleteBodyGroupResult | null {
  const groups = structure.body.contours ?? [];
  const group = groups.find((candidate) => candidate.id === groupId);
  if (!group || group.lines.length === 0) return null;

  const deletedLineNumbers = range(group.lines[0].num, group.lines.at(-1)!.num);
  const deletedSet = new Set(deletedLineNumbers);

  return {
    text: splitProgramLines(text)
      .filter((_, index) => !deletedSet.has(index + 1))
      .join('\n'),
    deletedLineNumbers
  };
}

export function moveSelectedLines(
  text: string,
  selectedLineNumbers: number[],
  direction: -1 | 1
): MoveSelectedLinesResult | null {
  const lines = splitProgramLines(text);
  const selected = uniqueSortedLineNumbers(selectedLineNumbers, lines.length);
  if (selected.length === 0) return null;
  if (direction < 0 && selected[0] <= 1) return null;
  if (direction > 0 && selected.at(-1)! >= lines.length) return null;

  const selectedSet = new Set(selected);
  const movedLines = selected.map((lineNumber) => lines[lineNumber - 1]);
  const remainingLines = lines.filter((_, index) => !selectedSet.has(index + 1));
  const firstIndex = selected[0] - 1;
  const lastIndex = selected.at(-1)! - 1;
  const insertIndex =
    direction < 0
      ? Math.max(0, firstIndex - 1)
      : Math.min(remainingLines.length, lastIndex + 2 - selected.length);

  remainingLines.splice(insertIndex, 0, ...movedLines);

  return {
    text: remainingLines.join('\n'),
    movedLineNumbers: selected.map((lineNumber) => lineNumber + direction)
  };
}

export function setStartAtLine(
  text: string,
  selectedLineNumber: number,
  options: { ensureClosure?: boolean } = {}
): SetStartAtLineResult | null {
  const ensureClosure = options.ensureClosure ?? true;
  const lines = splitProgramLines(text);
  const structure = organizeGCodeStructure(lines);
  const selectedLine = lines[selectedLineNumber - 1];

  if (!selectedLine || !isMotionCommand(selectedLine)) return null;
  if (!structure.body.lines.some((line) => line.num === selectedLineNumber)) return null;

  const contourGroups = (structure.body.contours ?? []).filter(isToolpathGroup);
  const targetIndex = contourGroups.findIndex((group) =>
    group.lines.some((line) => line.num === selectedLineNumber)
  );

  if (targetIndex < 0) return null;

  const targetGroup = contourGroups[targetIndex];
  const relativeStartIndex = selectedLineNumber - targetGroup.lines[0].num;
  const rotatedTarget = rotateLoop(
    targetGroup.lines.map((line) => line.text),
    relativeStartIndex,
    {
      ensureClosure: targetGroup.type === 'toolpath-closed' || ensureClosure,
      startCoord: targetGroup.startCoord
    }
  );
  const reorderedGroups = [
    ...contourGroups.slice(targetIndex + 1),
    ...contourGroups.slice(0, targetIndex)
  ];
  const newBody = [...rotatedTarget];
  let lastPosition: { x: number | null; y: number | null } = extractXY(rotatedTarget.at(-1) ?? '');

  for (const group of reorderedGroups) {
    const startCoord = group.startCoord;
    if (startCoord && !xyEqual(lastPosition, startCoord)) {
      newBody.push(`G0 X${startCoord.x.toFixed(4)} Y${startCoord.y.toFixed(4)}`);
    }

    newBody.push(...group.lines.map((line) => line.text));
    lastPosition = group.endCoord ?? lastPosition;
  }

  return {
    text: [
      ...structure.header.lines.map((line) => line.text),
      ...newBody,
      ...structure.footer.lines.map((line) => line.text)
    ].join('\n'),
    newStartLine: structure.header.lines.length + 1
  };
}

function splitProgramLines(text: string) {
  return text.split(/\r?\n/);
}

function uniqueSortedLineNumbers(lineNumbers: number[], lineCount: number) {
  return [...new Set(lineNumbers)]
    .filter((lineNumber) => Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= lineCount)
    .sort((a, b) => a - b);
}

function range(start: number, end: number) {
  const items: number[] = [];
  for (let line = start; line <= end; line++) items.push(line);
  return items;
}

function isToolpathGroup(group: GCodeContourGroup) {
  return group.type === 'toolpath-open' || group.type === 'toolpath-closed';
}

function rotateLoop(
  lines: string[],
  startIndex: number,
  options: {
    ensureClosure: boolean;
    startCoord?: { x: number; y: number };
  }
) {
  const startCoord = options.startCoord ?? { x: 0, y: 0 };
  if (lines.length === 0) return [];
  if (startIndex <= 0 || startIndex >= lines.length) return [...lines];

  const chosenLineText = lines[startIndex];
  const chosenXY = extractXY(chosenLineText);
  const originalFirstLine = lines[0];
  const originalStartXY = extractXY(originalFirstLine);
  const arcInfo = collectArcCenters(lines, startCoord);
  const rotatedBody = lines.slice(startIndex).concat(lines.slice(0, startIndex));

  if (arcInfo.length > 0) {
    let currentPosition = { ...startCoord };
    for (let index = 0; index < startIndex; index++) {
      const xy = extractXY(lines[index]);
      if (xy.x !== null) currentPosition.x = xy.x;
      if (xy.y !== null) currentPosition.y = xy.y;
    }

    for (let index = 0; index < rotatedBody.length; index++) {
      const line = rotatedBody[index];
      const xy = extractXY(line);
      const originalIndex =
        index < lines.length - startIndex ? index + startIndex : index - (lines.length - startIndex);

      if (isArcLine(line)) {
        const info = arcInfo.find((arc) => arc.originalIndex === originalIndex);
        if (info) {
          rotatedBody[index] = updateArcCommand(
            line,
            info.centerX - currentPosition.x,
            info.centerY - currentPosition.y
          );
        }
      }

      if (xy.x !== null) currentPosition.x = xy.x;
      if (xy.y !== null) currentPosition.y = xy.y;
    }
  }

  let currentIdxOfOriginalFirst = lines.length - startIndex;
  const prevIdx = currentIdxOfOriginalFirst - 1;
  if (prevIdx >= 0 && prevIdx < rotatedBody.length) {
    const prevXY = extractXY(rotatedBody[prevIdx]);
    if (xyEqual(prevXY, originalStartXY)) {
      rotatedBody.splice(prevIdx, 1);
      currentIdxOfOriginalFirst--;
    }
  }

  if (currentIdxOfOriginalFirst >= 0 && currentIdxOfOriginalFirst < rotatedBody.length) {
    const line = rotatedBody[currentIdxOfOriginalFirst];
    const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(line))).toUpperCase();
    if (/^G0(?=\D|$)/.test(cleaned)) {
      rotatedBody[currentIdxOfOriginalFirst] = convertG0ToG1(line);
    }
  }

  if (options.ensureClosure) {
    let lastIndex = rotatedBody.length - 1;
    while (lastIndex >= 0 && (rotatedBody[lastIndex] || '').trim() === '') lastIndex--;
    const lastXY = extractXY(lastIndex >= 0 ? rotatedBody[lastIndex] : '');
    if (!xyEqual(lastXY, chosenXY)) {
      rotatedBody.push(generateMinimalClose(chosenXY.xText, chosenXY.yText));
    }
  }

  return rotatedBody;
}

function collectArcCenters(lines: string[], startCoord: { x: number; y: number }) {
  const arcInfo: Array<{ originalIndex: number; centerX: number; centerY: number }> = [];
  const currentPosition = { ...startCoord };

  lines.forEach((line, index) => {
    const xy = extractXY(line);

    if (isArcLine(line)) {
      const ij = extractIJ(line);
      if (ij.i !== null && ij.j !== null) {
        arcInfo.push({
          originalIndex: index,
          centerX: currentPosition.x + ij.i,
          centerY: currentPosition.y + ij.j
        });
      }
    }

    if (xy.x !== null) currentPosition.x = xy.x;
    if (xy.y !== null) currentPosition.y = xy.y;
  });

  return arcInfo;
}

function stripInlineComments(line: string) {
  return line.replace(/[;(].*$/g, '').trim();
}

function dropLeadingBlockNumber(line: string) {
  return (line || '').replace(/^N\d+(?:\s+|(?=[A-Z%]))/i, '');
}

function isArcLine(line: string) {
  const cleaned = canonicalizeMotionCodes(dropLeadingBlockNumber(stripInlineComments(line))).toUpperCase();
  return /^(G2|G3)(?=\D|$)/.test(cleaned);
}

function extractXY(line: string | { x: number; y: number }) {
  if (typeof line !== 'string') {
    return {
      x: line.x,
      y: line.y,
      xText: String(line.x),
      yText: String(line.y)
    };
  }

  const noComment = stripInlineComments(line);
  const numberPattern = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  const xMatch = noComment.match(new RegExp(`X\\s*(${numberPattern})`, 'i'));
  const yMatch = noComment.match(new RegExp(`Y\\s*(${numberPattern})`, 'i'));
  const xText = xMatch ? xMatch[1] : null;
  const yText = yMatch ? yMatch[1] : null;

  return {
    x: xText !== null ? Number.parseFloat(xText) : null,
    y: yText !== null ? Number.parseFloat(yText) : null,
    xText,
    yText
  };
}

function extractIJ(line: string) {
  const noComment = stripInlineComments(line);
  const numberPattern = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  const iMatch = noComment.match(new RegExp(`I\\s*(${numberPattern})`, 'i'));
  const jMatch = noComment.match(new RegExp(`J\\s*(${numberPattern})`, 'i'));

  return {
    i: iMatch ? Number.parseFloat(iMatch[1]) : null,
    j: jMatch ? Number.parseFloat(jMatch[1]) : null
  };
}

function xyEqual(
  a: { x: number | null; y: number | null },
  b: { x: number | null; y: number | null } | { x: number; y: number } | undefined,
  epsilon = 1e-6
) {
  if (!b || a.x === null || a.y === null || b.x === null || b.y === null) return false;
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon;
}

function convertG0ToG1(line: string) {
  const commentMatch = line.match(/[;(].*$/);
  const comment = commentMatch ? line.slice(commentMatch.index) : '';
  const command = commentMatch ? line.slice(0, commentMatch.index) : line;
  const canonical = canonicalizeMotionCodes(command);
  return (
    canonical.replace(/^(\s*(?:N\d+(?:\s+|(?=[A-Z%])))?)(G0)(?=\D|$)/i, '$1G1') +
    comment
  );
}

function generateMinimalClose(xText: string | null, yText: string | null) {
  const parts = ['G1'];
  if (xText !== null) parts.push(`X${xText}`);
  if (yText !== null) parts.push(`Y${yText}`);
  return parts.join(' ');
}

function updateArcCommand(originalLine: string, newI: number, newJ: number) {
  const commentMatch = originalLine.match(/[;(].*$/);
  const comment = commentMatch ? originalLine.slice(commentMatch.index) : '';
  let command = commentMatch ? originalLine.slice(0, commentMatch.index) : originalLine;

  command = replaceOrAppendArcWord(command, 'I', newI);
  command = replaceOrAppendArcWord(command, 'J', newJ);

  return command + comment;
}

function replaceOrAppendArcWord(command: string, word: 'I' | 'J', value: number) {
  const pattern = new RegExp(`${word}\\s*[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?`, 'i');
  const replacement = `${word}${formatNumber(value)}`;
  return pattern.test(command) ? command.replace(pattern, replacement) : `${command} ${replacement}`;
}

function formatNumber(value: number) {
  return Number(value.toFixed(6)).toString();
}
