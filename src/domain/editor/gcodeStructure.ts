import {
  createGCodeInterpreterState,
  interpretGCodeBlock,
  type GCodeBlockResult,
  type GCodeInterpretedMotion
} from './gcodeBlockInterpreter';

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

interface ActiveToolpath {
  startIndex: number;
  endIndex: number;
  startCoord: XYPosition;
  endCoord: XYPosition;
  length: number;
  clockwiseArcs: number;
  counterclockwiseArcs: number;
  lines: string[];
}

const POSITION_EPSILON = 1e-9;

export function isHeaderCommand(raw: string) {
  if (!raw) return false;
  return isHeaderBlock(interpretStandalone(raw));
}

export function isMotionCommand(raw: string) {
  if (!raw) return false;
  return interpretStandalone(raw).explicitMotion !== null;
}

export function isFooterCommand(raw: string) {
  if (!raw) return false;
  return isFooterBlock(interpretStandalone(raw));
}

export function organizeGCodeStructure(lines: string[]): GCodeStructure {
  const sections: GCodeStructure = {
    header: { lines: [], startLineNum: 1 },
    body: { lines: [], startLineNum: 1 },
    footer: { lines: [], startLineNum: 1 }
  };
  const interpreterState = createGCodeInterpreterState();
  const blocksByLine = new Map<number, GCodeBlockResult>();
  let inBody = false;
  let foundFirstMotion = false;

  lines.forEach((text, index) => {
    const currentLineNum = index + 1;
    const line = { num: currentLineNum, text };
    const block = interpretGCodeBlock(interpreterState, text, currentLineNum);
    blocksByLine.set(currentLineNum, block);

    if (block.cleanedLine === '') {
      pushContextualLine(sections, line, inBody, foundFirstMotion);
      return;
    }

    const isPercent = block.cleanedLine === '%';
    if (isFooterBlock(block) && (!isPercent || inBody || sections.header.lines.length > 0)) {
      if (sections.footer.lines.length === 0) sections.footer.startLineNum = currentLineNum;
      sections.footer.lines.push(line);
      return;
    }

    if (block.motion || block.explicitMotion) {
      if (!foundFirstMotion) {
        foundFirstMotion = true;
        inBody = true;
        sections.body.startLineNum = currentLineNum;
      }
      sections.body.lines.push(line);
      return;
    }

    if (isHeaderBlock(block)) {
      if (inBody && foundFirstMotion) {
        sections.body.lines.push(line);
      } else {
        if (sections.header.lines.length === 0) sections.header.startLineNum = currentLineNum;
        sections.header.lines.push(line);
      }
      return;
    }

    pushContextualLine(sections, line, inBody, foundFirstMotion);
  });

  if (sections.body.lines.length > 0) {
    const bodyBlocks = sections.body.lines.map((line) => blocksByLine.get(line.num)!);
    sections.body.contours = structureContoursFromBlocks(sections.body.lines, bodyBlocks);
  }

  return sections;
}

export function structureContours(bodyLines: GCodeStructuredLine[]): GCodeContourGroup[] {
  const interpreterState = createGCodeInterpreterState();
  const blocks = bodyLines.map((line) =>
    interpretGCodeBlock(interpreterState, line.text, line.num)
  );
  return structureContoursFromBlocks(bodyLines, blocks);
}

function structureContoursFromBlocks(
  bodyLines: GCodeStructuredLine[],
  blocks: GCodeBlockResult[]
): GCodeContourGroup[] {
  const contours = detectContours(bodyLines, blocks);
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

function detectContours(bodyLines: GCodeStructuredLine[], blocks: GCodeBlockResult[]) {
  const toolpaths: DetectedToolpath[] = [];
  let currentToolpath: ActiveToolpath | null = null;

  bodyLines.forEach((line, index) => {
    const block = blocks[index];
    const motion = block.motion;

    if (
      motion &&
      (motion.command === 'G1' || motion.command === 'G2' || motion.command === 'G3')
    ) {
      if (!currentToolpath) {
        currentToolpath = {
          startIndex: index,
          endIndex: index,
          startCoord: { ...motion.start },
          endCoord: { ...motion.end },
          length: 0,
          clockwiseArcs: 0,
          counterclockwiseArcs: 0,
          lines: []
        };
      }

      currentToolpath.endIndex = index;
      currentToolpath.endCoord = { ...motion.end };
      currentToolpath.length += calculateMotionLength(motion);
      if (motion.command === 'G2') currentToolpath.clockwiseArcs++;
      if (motion.command === 'G3') currentToolpath.counterclockwiseArcs++;
      currentToolpath.lines.push(line.text);
      return;
    }

    if (motion?.command === 'G0' || isProgramControlBlock(block)) {
      if (currentToolpath) {
        toolpaths.push(finalizeToolpath(currentToolpath));
        currentToolpath = null;
      }
      return;
    }

    if (currentToolpath) {
      currentToolpath.endIndex = index;
      currentToolpath.lines.push(line.text);
    }
  });

  if (currentToolpath) toolpaths.push(finalizeToolpath(currentToolpath));
  return toolpaths;
}

function finalizeToolpath(toolpath: ActiveToolpath): DetectedToolpath {
  return {
    startIndex: toolpath.startIndex,
    endIndex: toolpath.endIndex,
    startCoord: toolpath.startCoord,
    endCoord: toolpath.endCoord,
    length: toolpath.length,
    direction: determineDirection(toolpath),
    type: coordinatesEqual(toolpath.startCoord, toolpath.endCoord)
      ? 'toolpath-closed'
      : 'toolpath-open',
    lines: toolpath.lines
  };
}

function determineDirection(toolpath: ActiveToolpath): 'CW' | 'CCW' | 'UNKNOWN' {
  if (toolpath.clockwiseArcs > toolpath.counterclockwiseArcs) return 'CW';
  if (toolpath.counterclockwiseArcs > toolpath.clockwiseArcs) return 'CCW';
  return 'UNKNOWN';
}

function calculateMotionLength(motion: GCodeInterpretedMotion) {
  if (motion.command === 'G0' || motion.command === 'G1') {
    return distance(motion.start, motion.end);
  }
  if (!motion.center) return 0;

  const radius = distance(motion.center, motion.start);
  if (!Number.isFinite(radius) || radius <= POSITION_EPSILON) return 0;

  const sweep = coordinatesEqual(motion.start, motion.end, POSITION_EPSILON)
    ? Math.PI * 2
    : directedSweep(motion.start, motion.end, motion.center, motion.command === 'G2');
  return radius * sweep;
}

function directedSweep(
  start: XYPosition,
  end: XYPosition,
  center: XYPosition,
  clockwise: boolean
) {
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
  return normalizeAngle(clockwise ? startAngle - endAngle : endAngle - startAngle);
}

function normalizeAngle(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function distance(a: XYPosition, b: XYPosition) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function coordinatesEqual(a: XYPosition, b: XYPosition, tolerance = 1e-4) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function interpretStandalone(raw: string) {
  return interpretGCodeBlock(createGCodeInterpreterState(), raw, 1);
}

function isHeaderBlock(block: GCodeBlockResult) {
  if (block.cleanedLine === '') return false;
  if (block.cleanedLine.startsWith('%')) return true;
  const firstWord = block.words[0];
  if (firstWord?.letter === 'M') return firstWord.value !== 2;

  return block.words.some((word) => {
    if (word.letter !== 'G') return false;
    return (
      [17, 18, 19, 20, 21, 38, 60, 90, 90.1, 91, 91.1, 92].includes(word.value) ||
      (word.value >= 40 && word.value <= 59) ||
      (word.value >= 94 && word.value <= 99)
    );
  });
}

function isFooterBlock(block: GCodeBlockResult) {
  const firstWord = block.words[0];
  return (
    block.cleanedLine === '%' ||
    (firstWord?.letter === 'M' && (firstWord.value === 2 || firstWord.value === 30))
  );
}

function isProgramControlBlock(block: GCodeBlockResult) {
  return block.words[0]?.letter === 'M';
}
