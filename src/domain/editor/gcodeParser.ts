import {
  createGCodeInterpreterState,
  interpretGCodeBlock,
  type GCodeBlockResult,
  type GCodeInterpreterState
} from './gcodeBlockInterpreter';
import type {
  GCodeArcPathPoint,
  GCodeBounds,
  GCodeParseIssue,
  GCodeParseResult,
  GCodeParseStats,
  GCodePathPoint
} from './types';

const POSITION_EPSILON = 1e-9;

interface ParserState {
  interpreter: GCodeInterpreterState;
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
    interpreter: createGCodeInterpreterState(),
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
  const block = interpretGCodeBlock(state.interpreter, rawLine, lineNumber);
  recordIssues(state, block);

  if (block.commentOnly) {
    state.stats.comments++;
    return;
  }
  if (block.cleanedLine === '') return;

  if (block.positionSet) {
    if (state.path.length === 0) {
      state.path.push({
        type: 'position',
        x: block.positionSet.x,
        y: block.positionSet.y,
        line: lineNumber,
        meta: { source: 'G92' }
      });
      state.bounds = updateBounds(state.bounds, block.positionSet.x, block.positionSet.y);
    }
    state.stats.processedLines++;
    return;
  }

  const motion = block.motion;
  if (motion?.command === 'G0' || motion?.command === 'G1') {
    state.path.push({
      type: motion.command === 'G0' ? 'rapid' : 'cut',
      x: motion.end.x,
      y: motion.end.y,
      line: lineNumber
    });
    state.bounds = updateBounds(state.bounds, motion.end.x, motion.end.y);
    state.stats.linearMoves++;
    state.stats.processedLines++;
    return;
  }

  if ((motion?.command === 'G2' || motion?.command === 'G3') && motion.center) {
    const arc: GCodeArcPathPoint = {
      type: 'arc',
      startX: motion.start.x,
      startY: motion.start.y,
      endX: motion.end.x,
      endY: motion.end.y,
      centerX: motion.center.x,
      centerY: motion.center.y,
      clockwise: motion.command === 'G2',
      line: lineNumber
    };
    state.path.push(arc);
    state.bounds = mergeBounds(state.bounds, calculateArcBounds(arc));
    state.stats.arcMoves++;
    state.stats.processedLines++;
    return;
  }

  if (block.explicitMotion) {
    state.stats.processedLines++;
    return;
  }

  if (isKnownNonMotionBlock(block)) {
    state.stats.processedLines++;
    return;
  }

  if (!block.issues.some((issue) => issue.type === 'error')) {
    state.warnings.push({
      line: lineNumber,
      message: `Unknown G-code command: ${block.cleanedLine}`,
      type: 'warning'
    });
  }
}

function recordIssues(state: ParserState, block: GCodeBlockResult) {
  for (const issue of block.issues) {
    if (issue.type === 'error') {
      state.errors.push(issue);
      state.stats.errors++;
    } else {
      state.warnings.push(issue);
    }
  }
}

function isKnownNonMotionBlock(block: GCodeBlockResult) {
  if (block.cleanedLine === '%') return true;

  return block.words.some((word) => {
    if (word.letter === 'M') return true;
    if (word.letter !== 'G') return false;
    return (
      [17, 18, 19, 20, 21, 38, 60, 90, 90.1, 91, 91.1, 92].includes(word.value) ||
      (word.value >= 40 && word.value <= 59) ||
      (word.value >= 94 && word.value <= 99)
    );
  });
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
