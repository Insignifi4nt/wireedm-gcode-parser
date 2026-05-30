import { canonicalizeMotionCodes } from './isoNormalizer';

export interface GCodeStructuredLine {
  num: number;
  text: string;
}

export type GCodeContourType = 'loose' | 'toolpath-open' | 'toolpath-closed' | 'contour';

export interface GCodeContourGroup {
  id: string;
  type: GCodeContourType;
  lines: GCodeStructuredLine[];
  startLineNum: number;
  count: number;
  length?: number;
  direction?: 'CW' | 'CCW' | 'UNKNOWN';
  startCoord?: XYPosition;
  endCoord?: XYPosition;
}

export interface GCodeStructureSection {
  lines: GCodeStructuredLine[];
  startLineNum: number;
}

export interface GCodeBodySection extends GCodeStructureSection {
  contours?: GCodeContourGroup[];
}

export interface GCodeStructure {
  header: GCodeStructureSection;
  body: GCodeBodySection;
  footer: GCodeStructureSection;
}

interface XYPosition {
  x: number;
  y: number;
}

interface MotionData {
  command: string;
  x: number | null;
  y: number | null;
  i: number | null;
  j: number | null;
}

interface DetectedToolpath {
  startIndex: number;
  endIndex: number;
  startCoord: XYPosition;
  endCoord: XYPosition;
  length: number;
  direction: 'CW' | 'CCW' | 'UNKNOWN';
  type: 'toolpath-open' | 'toolpath-closed';
  lines: string[];
}

export function isHeaderCommand(raw: string) {
  if (!raw) return false;

  const cleaned = cleanCommand(raw);
  if (cleaned === '') return false;

  if (/^%/.test(cleaned)) return true;
  if (/^(G92|G60|G38|G50|G51|G52|G53|G54|G55|G56|G57|G58|G59)/.test(cleaned)) {
    return true;
  }
  if (/^(G90|G91|G90\.1|G91\.1)/.test(cleaned)) return true;
  if (/^(G40|G41|G42|G43|G44|G45|G46|G47|G48|G49)/.test(cleaned)) return true;
  if (/^(G17|G18|G19)/.test(cleaned)) return true;
  if (/^(G20|G21)/.test(cleaned)) return true;
  if (/^(G94|G95|G96|G97|G98|G99)/.test(cleaned)) return true;
  if (/^(M[0-9]|M1[0-9]|M2[0-9]|M3[0-9]|M[4-9][0-9]|M28|M30)/.test(cleaned)) {
    return !/^M02\b/.test(cleaned);
  }

  return false;
}

export function isMotionCommand(raw: string) {
  if (!raw) return false;

  const cleaned = canonicalizeMotionCodes(cleanCommand(raw));
  return /^(G0|G1|G2|G3)(?=\D|$)/.test(cleaned);
}

export function isFooterCommand(raw: string) {
  if (!raw) return false;

  const cleaned = cleanCommand(raw);
  return /^(M02|M30)\b/.test(cleaned) || /^%$/.test(cleaned);
}

export function organizeGCodeStructure(lines: string[]): GCodeStructure {
  const sections: GCodeStructure = {
    header: { lines: [], startLineNum: 1 },
    body: { lines: [], startLineNum: 1 },
    footer: { lines: [], startLineNum: 1 }
  };

  let inBody = false;
  let foundFirstMotion = false;

  lines.forEach((text, index) => {
    const currentLineNum = index + 1;
    const trimmedLine = (text || '').trim();

    if (trimmedLine === '' || trimmedLine.startsWith(';') || trimmedLine.startsWith('(')) {
      pushContextualLine(sections, { num: currentLineNum, text }, inBody, foundFirstMotion);
      return;
    }

    const isPercent = trimmedLine === '%';
    if (isFooterCommand(text) && (!isPercent || inBody || sections.header.lines.length > 0)) {
      if (sections.footer.lines.length === 0) sections.footer.startLineNum = currentLineNum;
      sections.footer.lines.push({ num: currentLineNum, text });
      return;
    }

    if (isMotionCommand(text)) {
      if (!foundFirstMotion) {
        foundFirstMotion = true;
        inBody = true;
        sections.body.startLineNum = currentLineNum;
      }
      sections.body.lines.push({ num: currentLineNum, text });
      return;
    }

    if (isHeaderCommand(text)) {
      if (inBody && foundFirstMotion) {
        sections.body.lines.push({ num: currentLineNum, text });
      } else {
        if (sections.header.lines.length === 0) sections.header.startLineNum = currentLineNum;
        sections.header.lines.push({ num: currentLineNum, text });
      }
      return;
    }

    pushContextualLine(sections, { num: currentLineNum, text }, inBody, foundFirstMotion);
  });

  if (sections.body.lines.length > 0) {
    sections.body.contours = structureContours(sections.body.lines);
  }

  return sections;
}

export function structureContours(bodyLines: GCodeStructuredLine[]): GCodeContourGroup[] {
  const contours = detectContours(bodyLines.map((line) => line.text));
  const processedContours: GCodeContourGroup[] = [];
  let lastEndIndex = -1;

  contours.forEach((contour, index) => {
    if (contour.startIndex > lastEndIndex + 1) {
      const looseLines = bodyLines.slice(lastEndIndex + 1, contour.startIndex);
      if (looseLines.length > 0) {
        processedContours.push({
          id: `loose-${processedContours.length}`,
          type: 'loose',
          lines: looseLines,
          startLineNum: looseLines[0].num,
          count: looseLines.length
        });
      }
    }

    const contourLines = bodyLines.slice(contour.startIndex, contour.endIndex + 1);
    processedContours.push({
      id: `contour-${index + 1}`,
      type: contour.type,
      lines: contourLines,
      startLineNum: contourLines[0].num,
      count: contourLines.length,
      length: contour.length,
      direction: contour.direction,
      startCoord: contour.startCoord,
      endCoord: contour.endCoord
    });

    lastEndIndex = contour.endIndex;
  });

  if (lastEndIndex < bodyLines.length - 1) {
    const remainingLines = bodyLines.slice(lastEndIndex + 1);
    if (remainingLines.length > 0) {
      processedContours.push({
        id: `loose-${processedContours.length}`,
        type: 'loose',
        lines: remainingLines,
        startLineNum: remainingLines[0].num,
        count: remainingLines.length
      });
    }
  }

  if (processedContours.length === 0 && bodyLines.length > 0) {
    processedContours.push({
      id: 'loose-0',
      type: 'loose',
      lines: bodyLines,
      startLineNum: bodyLines[0].num,
      count: bodyLines.length
    });
  }

  return processedContours;
}

function pushContextualLine(
  sections: GCodeStructure,
  line: GCodeStructuredLine,
  inBody: boolean,
  foundFirstMotion: boolean
) {
  if (inBody && foundFirstMotion) {
    sections.body.lines.push(line);
  } else if (sections.footer.lines.length > 0) {
    sections.footer.lines.push(line);
  } else {
    if (sections.header.lines.length === 0) sections.header.startLineNum = line.num;
    sections.header.lines.push(line);
  }
}

function cleanCommand(raw: string) {
  return raw.replace(/^N\d+\s+/i, '').replace(/[;(].*$/g, '').trim().toUpperCase();
}

function detectContours(lines: string[]) {
  const toolpaths: DetectedToolpath[] = [];
  const tracker = new CoordinateTracker();
  let currentToolpath: {
    startIndex: number;
    endIndex: number;
    startCoord: XYPosition;
    endCoord: XYPosition;
    lines: string[];
  } | null = null;
  let modalMotion: string | null = null;

  lines.forEach((line, index) => {
    const motionData = parseMotion(line, modalMotion);
    if (motionData && ['G0', 'G1', 'G2', 'G3'].includes(motionData.command)) {
      modalMotion = motionData.command;
    }

    const previousPosition = { ...tracker.currentPosition };
    if (motionData) tracker.processMotion(motionData);

    if (motionData && ['G1', 'G2', 'G3'].includes(motionData.command)) {
      if (!currentToolpath) {
        currentToolpath = {
          startIndex: index,
          endIndex: index,
          startCoord: previousPosition,
          endCoord: { ...tracker.currentPosition },
          lines: [line]
        };
      } else {
        currentToolpath.endIndex = index;
        currentToolpath.endCoord = { ...tracker.currentPosition };
        currentToolpath.lines.push(line);
      }
      return;
    }

    if ((motionData && motionData.command === 'G0') || isProgramControlCommand(line)) {
      if (currentToolpath) {
        toolpaths.push(finalizeToolpath(currentToolpath, lines));
        currentToolpath = null;
      }
      return;
    }

    if (currentToolpath) {
      currentToolpath.endIndex = index;
      currentToolpath.lines.push(line);
    }
  });

  if (currentToolpath) toolpaths.push(finalizeToolpath(currentToolpath, lines));

  return toolpaths;
}

function finalizeToolpath(
  toolpath: {
    startIndex: number;
    endIndex: number;
    startCoord: XYPosition;
    endCoord: XYPosition;
    lines: string[];
  },
  allLines: string[]
): DetectedToolpath {
  const slice = allLines.slice(toolpath.startIndex, toolpath.endIndex + 1);

  return {
    startIndex: toolpath.startIndex,
    endIndex: toolpath.endIndex,
    startCoord: toolpath.startCoord,
    endCoord: toolpath.endCoord,
    length: calculateContourLength(slice),
    direction: determineDirection(slice),
    type: coordinatesEqual(toolpath.startCoord, toolpath.endCoord)
      ? 'toolpath-closed'
      : 'toolpath-open',
    lines: toolpath.lines
  };
}

function parseMotion(line: string, modalMotion: string | null = null): MotionData | null {
  if (!line || typeof line !== 'string') return null;

  const normalized = canonicalizeMotionCodes(
    line.replace(/^N\d+(?:\s+|$)/i, '').trim().toUpperCase()
  );
  const motionMatch = normalized.match(/^(G(?:0|1|2|3|90(?:\.1)?|91(?:\.1)?))(?=\D|$)/);
  if (!motionMatch && (!modalMotion || !hasMotionParameters(normalized))) return null;
  const command = motionMatch ? motionMatch[1] : modalMotion;
  if (!command) return null;

  return {
    command,
    x: parseParam(normalized, 'X'),
    y: parseParam(normalized, 'Y'),
    i: parseParam(normalized, 'I'),
    j: parseParam(normalized, 'J')
  };
}

function parseParam(line: string, axis: 'X' | 'Y' | 'I' | 'J') {
  const num = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
  const match = line.match(new RegExp(`${axis}\\s*(${num})`));
  return match ? Number.parseFloat(match[1]) : null;
}

function hasMotionParameters(line: string) {
  return (['X', 'Y', 'I', 'J'] as const).some((axis) => parseParam(line, axis) !== null);
}

function isProgramControlCommand(line: string) {
  if (!line || typeof line !== 'string') return false;
  const normalized = line.replace(/^N\d+(?:\s+|$)/i, '').trim().toUpperCase();
  return /^M\d+(?=\D|$)/.test(normalized);
}

function coordinatesEqual(a: XYPosition, b: XYPosition, tolerance = 1e-4) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function calculateContourLength(contourLines: string[]) {
  const tracker = new CoordinateTracker();
  let totalLength = 0;

  contourLines.forEach((line) => {
    const motionData = parseMotion(line);
    if (!motionData) return;

    const previousPosition = { ...tracker.currentPosition };
    tracker.processMotion(motionData);

    if (motionData.command === 'G0' || motionData.command === 'G1') {
      totalLength += distance(previousPosition, tracker.currentPosition);
    } else if (motionData.command === 'G2' || motionData.command === 'G3') {
      totalLength += distance(previousPosition, tracker.currentPosition) * 1.2;
    }
  });

  return totalLength;
}

function determineDirection(contourLines: string[]): 'CW' | 'CCW' | 'UNKNOWN' {
  let cwCount = 0;
  let ccwCount = 0;

  contourLines.forEach((line) => {
    const motionData = parseMotion(line);
    if (!motionData) return;
    if (motionData.command === 'G2') cwCount++;
    if (motionData.command === 'G3') ccwCount++;
  });

  if (cwCount > ccwCount) return 'CW';
  if (ccwCount > cwCount) return 'CCW';
  return 'UNKNOWN';
}

function distance(a: XYPosition, b: XYPosition) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

class CoordinateTracker {
  currentPosition: XYPosition = { x: 0, y: 0 };
  absoluteMode = true;

  processMotion(motionData: MotionData) {
    if (motionData.command === 'G90') this.absoluteMode = true;
    if (motionData.command === 'G91') this.absoluteMode = false;

    if (motionData.command === 'G0' || motionData.command === 'G1') {
      this.processLinearMove(motionData);
    } else if (motionData.command === 'G2' || motionData.command === 'G3') {
      this.processArcMove(motionData);
    }

    return this.currentPosition;
  }

  private processLinearMove(motionData: MotionData) {
    if (this.absoluteMode) {
      if (motionData.x !== null) this.currentPosition.x = motionData.x;
      if (motionData.y !== null) this.currentPosition.y = motionData.y;
      return;
    }

    if (motionData.x !== null) this.currentPosition.x += motionData.x;
    if (motionData.y !== null) this.currentPosition.y += motionData.y;
  }

  private processArcMove(motionData: MotionData) {
    this.processLinearMove(motionData);
  }
}
