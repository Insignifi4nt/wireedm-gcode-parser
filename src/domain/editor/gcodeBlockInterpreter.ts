export type GCodeMotionCommand = 'G0' | 'G1' | 'G2' | 'G3';

export interface GCodeInterpreterState {
  position: { x: number; y: number };
  xyMode: 'absolute' | 'incremental';
  ijMode: 'absolute' | 'incremental';
  motion: GCodeMotionCommand | null;
}

export interface GCodeInterpretedMotion {
  command: GCodeMotionCommand;
  start: { x: number; y: number };
  end: { x: number; y: number };
  center?: { x: number; y: number };
  clockwise?: boolean;
}

export interface GCodeWord {
  letter: string;
  value: number;
}

export interface GCodeBlockIssue {
  line: number;
  message: string;
  type: 'error' | 'warning';
}

export interface GCodeBlockResult {
  cleanedLine: string;
  words: GCodeWord[];
  motion: GCodeInterpretedMotion | null;
  explicitMotion: GCodeMotionCommand | null;
  positionSet: { x: number; y: number } | null;
  issues: GCodeBlockIssue[];
  hadComment: boolean;
  commentOnly: boolean;
}

const NUMBER_SOURCE = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
const WORD_PATTERN = new RegExp(`([A-Z])\\s*(${NUMBER_SOURCE})`, 'gi');
const POSITION_EPSILON = 1e-12;

export function createGCodeInterpreterState(): GCodeInterpreterState {
  return {
    position: { x: 0, y: 0 },
    xyMode: 'absolute',
    ijMode: 'incremental',
    motion: null
  };
}

export function interpretGCodeBlock(
  state: GCodeInterpreterState,
  rawLine: string,
  lineNumber: number
): GCodeBlockResult {
  const issues: GCodeBlockIssue[] = [];
  const commentScan = stripComments(String(rawLine ?? ''), lineNumber, issues);
  const cleanedLine = stripLeadingBlockNumber(commentScan.text.trim().toUpperCase());
  const wordScan = scanWords(cleanedLine, lineNumber, issues);
  const words = wordScan.words;
  const gWords = words.filter((word) => word.letter === 'G');

  for (const word of gWords) {
    if (word.value === 90) state.xyMode = 'absolute';
    if (word.value === 91) state.xyMode = 'incremental';
    if (word.value === 60 || word.value === 90.1) state.ijMode = 'absolute';
    if (word.value === 91.1) state.ijMode = 'incremental';
  }

  const explicitMotion = findExplicitMotion(gWords);
  const values = collectLastWordValues(words);
  const hasG92 = gWords.some((word) => word.value === 92);
  let positionSet: { x: number; y: number } | null = null;

  if (hasG92) {
    if (!wordScan.hasInvalidPositionWord) {
      const hasX = values.has('X');
      const hasY = values.has('Y');
      positionSet = {
        x: hasX ? normalized(values.get('X')!) : hasY ? state.position.x : 0,
        y: hasY ? normalized(values.get('Y')!) : hasX ? state.position.y : 0
      };
      state.position = { ...positionSet };
    }

    return createResult({
      cleanedLine,
      words,
      explicitMotion,
      positionSet,
      issues,
      commentScan
    });
  }

  if (explicitMotion) state.motion = explicitMotion;

  const hasMotionParameters = ['X', 'Y', 'I', 'J', 'R'].some((letter) => values.has(letter));
  const command = explicitMotion ?? (hasMotionParameters ? state.motion : null);
  if (!command || wordScan.hasInvalidMotionWord) {
    return createResult({
      cleanedLine,
      words,
      explicitMotion,
      positionSet,
      issues,
      commentScan
    });
  }

  const start = { ...state.position };
  const end = resolveEndPosition(state, start, values);
  if (![end.x, end.y].every(Number.isFinite)) {
    issues.push(errorIssue(lineNumber, 'Motion resolves to a non-finite endpoint.'));
    return createResult({
      cleanedLine,
      words,
      explicitMotion,
      positionSet,
      issues,
      commentScan
    });
  }

  if (command === 'G0' || command === 'G1') {
    const motion: GCodeInterpretedMotion = { command, start, end };
    state.position = { ...end };
    return createResult({
      cleanedLine,
      words,
      motion,
      explicitMotion,
      positionSet,
      issues,
      commentScan
    });
  }

  const clockwise = command === 'G2';
  const center = values.has('R')
    ? resolveRadiusCenter(start, end, values.get('R')!, clockwise, lineNumber, issues)
    : resolveIjCenter(state, start, values, lineNumber, issues);

  if (!center || ![center.x, center.y].every(Number.isFinite)) {
    if (center && !issues.some((issue) => issue.type === 'error')) {
      issues.push(errorIssue(lineNumber, 'Arc resolves to a non-finite centre.'));
    }
    return createResult({
      cleanedLine,
      words,
      explicitMotion,
      positionSet,
      issues,
      commentScan
    });
  }

  const motion: GCodeInterpretedMotion = {
    command,
    start,
    end,
    center,
    clockwise
  };
  state.position = { ...end };

  return createResult({
    cleanedLine,
    words,
    motion,
    explicitMotion,
    positionSet,
    issues,
    commentScan
  });
}

interface ResultValues {
  cleanedLine: string;
  words: GCodeWord[];
  motion?: GCodeInterpretedMotion;
  explicitMotion: GCodeMotionCommand | null;
  positionSet: { x: number; y: number } | null;
  issues: GCodeBlockIssue[];
  commentScan: CommentScan;
}

function createResult(values: ResultValues): GCodeBlockResult {
  return {
    cleanedLine: values.cleanedLine,
    words: values.words,
    motion: values.motion ?? null,
    explicitMotion: values.explicitMotion,
    positionSet: values.positionSet,
    issues: values.issues,
    hadComment: values.commentScan.hadComment,
    commentOnly:
      values.cleanedLine === '' &&
      values.commentScan.hadComment &&
      values.commentScan.rawTrimmed !== ''
  };
}

interface CommentScan {
  text: string;
  hadComment: boolean;
  rawTrimmed: string;
}

function stripComments(
  rawLine: string,
  lineNumber: number,
  issues: GCodeBlockIssue[]
): CommentScan {
  let depth = 0;
  let text = '';
  let hadComment = false;

  for (const character of rawLine) {
    if (character === ';') {
      hadComment = true;
      break;
    }

    if (character === '(') {
      depth++;
      hadComment = true;
      continue;
    }

    if (character === ')' && depth > 0) {
      depth--;
      continue;
    }

    if (depth === 0) text += character;
  }

  if (depth > 0) {
    issues.push(errorIssue(lineNumber, 'Unclosed parenthesized comment.'));
  }

  return { text, hadComment, rawTrimmed: rawLine.trim() };
}

function scanWords(cleanedLine: string, lineNumber: number, issues: GCodeBlockIssue[]) {
  const words: GCodeWord[] = [];
  let hasInvalidMotionWord = false;
  let hasInvalidPositionWord = false;
  WORD_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(cleanedLine)) !== null) {
    const letter = match[1].toUpperCase();
    const value = Number.parseFloat(match[2]);
    if (!Number.isFinite(value)) {
      issues.push(errorIssue(lineNumber, `Word ${letter} must have a finite value.`));
      if (['X', 'Y', 'I', 'J', 'R'].includes(letter)) hasInvalidMotionWord = true;
      if (letter === 'X' || letter === 'Y') hasInvalidPositionWord = true;
      continue;
    }
    words.push({ letter, value });
  }

  return { words, hasInvalidMotionWord, hasInvalidPositionWord };
}

function collectLastWordValues(words: GCodeWord[]) {
  const values = new Map<string, number>();
  for (const word of words) values.set(word.letter, word.value);
  return values;
}

function findExplicitMotion(gWords: GCodeWord[]): GCodeMotionCommand | null {
  let motion: GCodeMotionCommand | null = null;
  for (const word of gWords) {
    if (word.value === 0 || word.value === 1 || word.value === 2 || word.value === 3) {
      motion = `G${word.value}` as GCodeMotionCommand;
    }
  }
  return motion;
}

function resolveEndPosition(
  state: GCodeInterpreterState,
  start: { x: number; y: number },
  values: Map<string, number>
) {
  const xWord = values.get('X');
  const yWord = values.get('Y');
  if (state.xyMode === 'absolute') {
    return {
      x: normalized(xWord ?? start.x),
      y: normalized(yWord ?? start.y)
    };
  }

  return {
    x: normalized(start.x + (xWord ?? 0)),
    y: normalized(start.y + (yWord ?? 0))
  };
}

function resolveIjCenter(
  state: GCodeInterpreterState,
  start: { x: number; y: number },
  values: Map<string, number>,
  lineNumber: number,
  issues: GCodeBlockIssue[]
) {
  const hasI = values.has('I');
  const hasJ = values.has('J');
  const i = values.get('I') ?? 0;
  const j = values.get('J') ?? 0;

  if (state.ijMode === 'absolute' && hasI && hasJ) {
    return { x: normalized(i), y: normalized(j) };
  }

  if (state.ijMode === 'absolute' && (!hasI || !hasJ)) {
    issues.push({
      line: lineNumber,
      message: 'Arc center missing I or J in absolute IJ mode; falling back to incremental IJ.',
      type: 'warning'
    });
  }

  return {
    x: normalized(start.x + i),
    y: normalized(start.y + j)
  };
}

function resolveRadiusCenter(
  start: { x: number; y: number },
  end: { x: number; y: number },
  signedRadius: number,
  clockwise: boolean,
  lineNumber: number,
  issues: GCodeBlockIssue[]
) {
  if (!Number.isFinite(signedRadius)) {
    issues.push(errorIssue(lineNumber, 'Arc radius must be finite.'));
    return null;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (!Number.isFinite(chord)) {
    issues.push(errorIssue(lineNumber, 'Arc chord must be finite.'));
    return null;
  }
  if (chord <= POSITION_EPSILON) {
    issues.push(errorIssue(lineNumber, 'R arcs require distinct start and end points.'));
    return null;
  }

  const radius = Math.abs(signedRadius);
  if (radius < chord / 2) {
    issues.push(errorIssue(lineNumber, 'Arc radius is shorter than half the chord.'));
    return null;
  }

  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2
  };
  const heightSquared = radius * radius - (chord * chord) / 4;
  const height = Math.sqrt(Math.max(0, heightSquared));
  if (![midpoint.x, midpoint.y, height].every(Number.isFinite)) {
    issues.push(errorIssue(lineNumber, 'Arc centre calculation is non-finite.'));
    return null;
  }

  const perpendicular = { x: -dy / chord, y: dx / chord };
  const candidates = [1, -1].map((side) => ({
    x: midpoint.x + side * perpendicular.x * height,
    y: midpoint.y + side * perpendicular.y * height
  }));
  const ranked = candidates.map((center) => ({
    center,
    sweep: directedSweep(start, end, center, clockwise)
  }));
  const desired = ranked.reduce((selected, candidate) => {
    if (signedRadius < 0) return candidate.sweep > selected.sweep ? candidate : selected;
    return candidate.sweep < selected.sweep ? candidate : selected;
  });

  if (![desired.center.x, desired.center.y, desired.sweep].every(Number.isFinite)) {
    issues.push(errorIssue(lineNumber, 'Arc centre calculation is non-finite.'));
    return null;
  }

  return {
    x: normalized(desired.center.x),
    y: normalized(desired.center.y)
  };
}

function directedSweep(
  start: { x: number; y: number },
  end: { x: number; y: number },
  center: { x: number; y: number },
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

function stripLeadingBlockNumber(line: string) {
  return line.replace(/^N\d+(?:\s+|(?=[A-Z%])|$)/i, '').trim();
}

function errorIssue(line: number, message: string): GCodeBlockIssue {
  return { line, message, type: 'error' };
}

function normalized(value: number) {
  const rounded = Number(value.toFixed(12));
  return Object.is(rounded, -0) ? 0 : rounded;
}
