import type {
  GCodeArcPathPoint,
  GCodeBounds,
  GCodeParseIssue,
  GCodeParseResult,
  GCodeParseStats,
  GCodePathPoint
} from './types';

const COORDINATE_PATTERN = /([XYZ])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)/g;
const ARC_CENTER_PATTERN = /([IJ])\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][-+]?\d+)?)/g;
const LEADING_BLOCK_NUMBER_PATTERN = /^N\d+(?:\s+|$)/i;
const MOTION_COMMAND_PATTERN = /^G([0-3])(?=\D|$)/;
const POSITION_EPSILON = 1e-9;

interface ParserState {
  currentPosition: { x: number; y: number };
  modalMotion: string | null;
  ijAbsolute: boolean;
  path: GCodePathPoint[];
  bounds: GCodeBounds;
  errors: GCodeParseIssue[];
  warnings: GCodeParseIssue[];
  stats: GCodeParseStats;
}

export function parseGCodeProgram(gcodeText: string): GCodeParseResult {
  if (typeof gcodeText !== 'string') {
    throw new Error('G-code input must be a string.');
  }

  const state = createParserState();
  const lines = gcodeText.split(/\r?\n/);
  state.stats.totalLines = lines.length;

  lines.forEach((line, index) => {
    try {
      parseLine(state, line, index + 1);
    } catch (error) {
      state.errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : 'Could not parse G-code line.',
        type: 'error'
      });
      state.stats.errors++;
    }
  });

  if (state.path.length === 0) {
    state.warnings.push({
      line: 0,
      message: 'No valid G-code commands found in input.',
      type: 'warning'
    });
  }

  if (!isFiniteBounds(state.bounds)) {
    state.bounds = createEmptyBounds();
  }

  return {
    path: state.path,
    bounds: state.bounds,
    stats: state.stats,
    errors: state.errors,
    warnings: state.warnings
  };
}

function createParserState(): ParserState {
  return {
    currentPosition: { x: 0, y: 0 },
    modalMotion: null,
    ijAbsolute: false,
    path: [],
    bounds: createEmptyBounds(),
    errors: [],
    warnings: [],
    stats: {
      totalLines: 0,
      processedLines: 0,
      linearMoves: 0,
      arcMoves: 0,
      comments: 0,
      errors: 0
    }
  };
}

function parseLine(state: ParserState, rawLine: string, lineNumber: number) {
  let line = normalizeMotionCodes(rawLine.trim().toUpperCase());
  if (line === '') return;

  if (isComment(line)) {
    state.stats.comments++;
    return;
  }

  line = removeInlineComments(line).replace(LEADING_BLOCK_NUMBER_PATTERN, '').trim();
  if (line === '') return;

  if (/^G92(?=\D|$)/.test(line)) {
    parseG92(state, line, lineNumber);
    return;
  }

  let handledMode = false;
  if (/\bG60\b/.test(line) || /\bG90\.1\b/.test(line)) {
    state.ijAbsolute = true;
    handledMode = true;
  }
  if (/\bG91\.1\b/.test(line)) {
    state.ijAbsolute = false;
    handledMode = true;
  }

  const motionCommand = getMotionCommand(line) ?? getModalMotionCommand(state, line);
  if (motionCommand === 'G0' || motionCommand === 'G1') {
    state.stats.processedLines++;
    state.modalMotion = motionCommand;
    parseLinearMove(state, line, lineNumber, motionCommand);
  } else if (motionCommand === 'G2' || motionCommand === 'G3') {
    state.stats.processedLines++;
    state.modalMotion = motionCommand;
    parseArcMove(state, line, lineNumber, motionCommand);
  } else if (!handledMode && !isKnownNonMotionCommand(line)) {
    state.warnings.push({
      line: lineNumber,
      message: `Unknown G-code command: ${line}`,
      type: 'warning'
    });
  } else if (handledMode || isKnownNonMotionCommand(line)) {
    state.stats.processedLines++;
  }
}

function parseLinearMove(
  state: ParserState,
  line: string,
  lineNumber: number,
  motionCommand: string
) {
  const coordinates = extractCoordinates(line);
  state.currentPosition = {
    x: coordinates.x ?? state.currentPosition.x,
    y: coordinates.y ?? state.currentPosition.y
  };

  state.path.push({
    type: motionCommand === 'G0' ? 'rapid' : 'cut',
    x: state.currentPosition.x,
    y: state.currentPosition.y,
    line: lineNumber
  });
  state.bounds = updateBounds(state.bounds, state.currentPosition.x, state.currentPosition.y);
  state.stats.linearMoves++;
}

function parseArcMove(
  state: ParserState,
  line: string,
  lineNumber: number,
  motionCommand: string
) {
  const coordinates = extractCoordinates(line);
  const arcCenter = extractArcCenter(line);
  const startX = state.currentPosition.x;
  const startY = state.currentPosition.y;
  const endX = coordinates.x ?? startX;
  const endY = coordinates.y ?? startY;
  let centerX: number;
  let centerY: number;

  if (state.ijAbsolute && (arcCenter.i === undefined || arcCenter.j === undefined)) {
    state.warnings.push({
      line: lineNumber,
      message: 'Arc center missing I or J in absolute IJ mode; falling back to incremental IJ.',
      type: 'warning'
    });
    centerX = startX + (arcCenter.i ?? 0);
    centerY = startY + (arcCenter.j ?? 0);
  } else if (state.ijAbsolute) {
    centerX = arcCenter.i ?? startX;
    centerY = arcCenter.j ?? startY;
  } else {
    centerX = startX + (arcCenter.i ?? 0);
    centerY = startY + (arcCenter.j ?? 0);
  }

  const arc: GCodeArcPathPoint = {
    type: 'arc',
    startX,
    startY,
    endX,
    endY,
    centerX,
    centerY,
    clockwise: motionCommand === 'G2',
    line: lineNumber
  };

  state.path.push(arc);
  state.currentPosition = { x: endX, y: endY };
  state.bounds = mergeBounds(state.bounds, calculateArcBounds(arc));
  state.stats.arcMoves++;
}

function parseG92(state: ParserState, line: string, lineNumber: number) {
  const coordinates = extractCoordinates(line);
  const hasX = coordinates.x !== undefined;
  const hasY = coordinates.y !== undefined;
  const x = hasX ? coordinates.x! : hasY ? state.currentPosition.x : 0;
  const y = hasY ? coordinates.y! : hasX ? state.currentPosition.y : 0;
  state.currentPosition = { x, y };

  if (state.path.length === 0) {
    state.path.push({
      type: 'position',
      x,
      y,
      line: lineNumber,
      meta: { source: 'G92' }
    });
    state.bounds = updateBounds(state.bounds, x, y);
  }

  state.stats.processedLines++;
}

function normalizeMotionCodes(line: string) {
  return line.replace(/\bG0+([0-3])(?!\d)/g, 'G$1');
}

function isComment(line: string) {
  return line.startsWith(';') || line.startsWith('(');
}

function removeInlineComments(line: string) {
  return line.replace(/[;(].*$/, '').trim();
}

function getMotionCommand(line: string) {
  const motion = line.match(MOTION_COMMAND_PATTERN);
  return motion ? `G${motion[1]}` : null;
}

function getModalMotionCommand(state: ParserState, line: string) {
  if (!state.modalMotion) return null;
  return hasCoordinateOrArcParameter(line) ? state.modalMotion : null;
}

function hasCoordinateOrArcParameter(line: string) {
  COORDINATE_PATTERN.lastIndex = 0;
  ARC_CENTER_PATTERN.lastIndex = 0;
  return COORDINATE_PATTERN.test(line) || ARC_CENTER_PATTERN.test(line);
}

function isKnownNonMotionCommand(line: string) {
  return [
    /^%$/,
    /^G17(?=\D|$)/,
    /^G18(?=\D|$)/,
    /^G19(?=\D|$)/,
    /^G20(?=\D|$)/,
    /^G21(?=\D|$)/,
    /^G38(?=\D|$)/,
    /^G4[0-9](?=\D|$)/,
    /^G5[0-9](?=\D|$)/,
    /^G90(?=\D|$)/,
    /^G91(?=\D|$)/,
    /^G9[4-9](?=\D|$)/,
    /^M\d+(?=\D|$)/
  ].some((pattern) => pattern.test(line));
}

function extractCoordinates(line: string) {
  const coordinates: Partial<Record<'x' | 'y' | 'z', number>> = {};
  COORDINATE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = COORDINATE_PATTERN.exec(line)) !== null) {
    const axis = match[1].toLowerCase() as 'x' | 'y' | 'z';
    coordinates[axis] = round(Number.parseFloat(match[2]));
  }

  return coordinates;
}

function extractArcCenter(line: string) {
  const center: Partial<Record<'i' | 'j', number>> = {};
  ARC_CENTER_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ARC_CENTER_PATTERN.exec(line)) !== null) {
    const axis = match[1].toLowerCase() as 'i' | 'j';
    center[axis] = round(Number.parseFloat(match[2]));
  }

  return center;
}

function createEmptyBounds(): GCodeBounds {
  return {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity
  };
}

function updateBounds(bounds: GCodeBounds, x: number, y: number): GCodeBounds {
  return {
    minX: Math.min(bounds.minX, x),
    maxX: Math.max(bounds.maxX, x),
    minY: Math.min(bounds.minY, y),
    maxY: Math.max(bounds.maxY, y)
  };
}

function mergeBounds(a: GCodeBounds, b: GCodeBounds): GCodeBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function isFiniteBounds(bounds: GCodeBounds) {
  return [bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite);
}

function calculateArcBounds(arc: GCodeArcPathPoint): GCodeBounds {
  const radius = Math.hypot(arc.startX - arc.centerX, arc.startY - arc.centerY);
  let bounds = updateBounds(createEmptyBounds(), arc.startX, arc.startY);
  bounds = updateBounds(bounds, arc.endX, arc.endY);

  if (radius <= POSITION_EPSILON) return bounds;

  if (pointsEqual({ x: arc.startX, y: arc.startY }, { x: arc.endX, y: arc.endY })) {
    return {
      minX: arc.centerX - radius,
      maxX: arc.centerX + radius,
      minY: arc.centerY - radius,
      maxY: arc.centerY + radius
    };
  }

  const startAngle = normalizeAngle(Math.atan2(arc.startY - arc.centerY, arc.startX - arc.centerX));
  const endAngle = normalizeAngle(Math.atan2(arc.endY - arc.centerY, arc.endX - arc.centerX));
  const cardinalAngles = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

  for (const angle of cardinalAngles) {
    if (angleIsOnArc(angle, startAngle, endAngle, arc.clockwise)) {
      bounds = updateBounds(
        bounds,
        arc.centerX + radius * Math.cos(angle),
        arc.centerY + radius * Math.sin(angle)
      );
    }
  }

  return bounds;
}

function angleIsOnArc(angle: number, start: number, end: number, clockwise: boolean) {
  if (clockwise) {
    if (start < end) start += Math.PI * 2;
    if (angle > start) angle -= Math.PI * 2;
    return angle <= start + POSITION_EPSILON && angle >= end - POSITION_EPSILON;
  }

  if (end < start) end += Math.PI * 2;
  if (angle < start) angle += Math.PI * 2;
  return angle >= start - POSITION_EPSILON && angle <= end + POSITION_EPSILON;
}

function normalizeAngle(angle: number) {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
}

function pointsEqual(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) <= POSITION_EPSILON && Math.abs(a.y - b.y) <= POSITION_EPSILON;
}

function round(value: number) {
  return Number(value.toFixed(12));
}
