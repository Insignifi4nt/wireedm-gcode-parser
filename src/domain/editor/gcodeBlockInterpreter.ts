import { canonicalGCodeCommand, gcodeCommandDefinition } from './gcodeCommands';
import type { GCodeInspectionOptions } from './gcodeInspectionTypes';

export type GCodeMotionCommand = 'G0' | 'G1' | 'G2' | 'G3';

export interface GCodeInterpreterState {
  /** Explicit source dialect; unknown leaves controller-specific words uninterpreted. */
  profile: 'neutral' | 'legacy-robofil';
  /** Coordinates are millimetres once units are declared; undeclared values retain their legacy scale. */
  position: { x: number; y: number };
  units: 'mm' | 'in' | null;
  xyMode: 'absolute' | 'incremental';
  ijMode: 'absolute' | 'incremental';
  motion: GCodeMotionCommand | null;
  plane: 'XY' | 'XZ' | 'YZ';
  compensation: 'off' | 'left' | 'right' | 'unknown';
  positionKnown: boolean;
}

export interface GCodeInterpretedMotion {
  command: GCodeMotionCommand;
  start: { x: number; y: number };
  end: { x: number; y: number };
  center?: { x: number; y: number };
  clockwise?: boolean;
  breakBefore?: true;
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
  previewOmitted: boolean;
}

const NUMBER_SOURCE = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
const WORD_PATTERN = new RegExp(`([A-Z])\\s*(${NUMBER_SOURCE})`, 'gi');
const POSITION_EPSILON = 1e-12;
const SWEEP_RESOLUTION = Number.EPSILON * Math.PI * 4;

export function createGCodeInterpreterState(profile: GCodeInterpreterState['profile'] = 'neutral', defaults: GCodeInspectionOptions['defaults'] = {}): GCodeInterpreterState {
  if (defaults.initialPosition && ![defaults.initialPosition.x, defaults.initialPosition.y].every(Number.isFinite)) {
    throw new Error('Initial preview position must be finite.');
  }
  return {
    profile,
    position: { ...(defaults.initialPosition ?? { x: 0, y: 0 }) },
    units: defaults.units ?? null,
    xyMode: defaults.xyMode ?? 'absolute',
    ijMode: defaults.ijMode ?? 'incremental',
    motion: null, plane: 'XY', compensation: 'off', positionKnown: true
  };
}

export function interpretGCodeBlock(
  state: GCodeInterpreterState,
  rawLine: string,
  lineNumber: number,
  context?: NonNullable<GCodeInspectionOptions['lineContexts']>[number]
): GCodeBlockResult {
  const issues: GCodeBlockIssue[] = [];
  const commentScan = stripComments(String(rawLine ?? ''), lineNumber, issues);
  const cleanedLine = stripLeadingBlockNumber(commentScan.text.trim().toUpperCase());
  const wordScan = scanWords(cleanedLine, lineNumber, issues);
  const words = wordScan.words;
  const gWords = words.filter((word) => word.letter === 'G');
  const modalGroups = [[0, 1, 2, 3], [17, 18, 19], [20, 21], [90, 91], [90.1, 91.1], [40, 41, 42]];
  if (modalGroups.some(group => new Set(gWords.filter(word => group.includes(word.value)).map(word => word.value)).size > 1)) {
    state.motion = null; state.positionKnown = false;
    issues.push(errorIssue(lineNumber, 'Conflicting commands in the same modal group; this block is omitted from preview.'));
    return { ...createResult({ cleanedLine, words, explicitMotion: findExplicitMotion(gWords), positionSet: null, issues, commentScan }), previewOmitted: true };
  }
  if (context?.ijMode) state.ijMode = context.ijMode;

  for (const word of gWords) {
    if (word.value === 17) state.plane = 'XY';
    if (word.value === 18) state.plane = 'XZ';
    if (word.value === 19) state.plane = 'YZ';
    if (word.value === 40) state.compensation = 'off';
    if (word.value === 41) state.compensation = 'left';
    if (word.value === 42) state.compensation = 'right';
    if (word.value === 39) state.compensation = 'unknown';
    if (word.value === 18 || word.value === 19) {
      issues.push({ line: lineNumber, type: 'warning',
        message: `G${word.value} selects a plane unsupported by the XY preview. The physical toolpath preview cannot be relied on for this program.` });
    }
    if ((word.value >= 52 && word.value < 60) || (word.value > 92 && word.value < 93)) {
      state.positionKnown = false;
      issues.push({ line: lineNumber, type: 'warning',
        message: `G${word.value} coordinate-frame offsets are not modeled. The physical toolpath preview cannot be relied on for this program.` });
    }
    if (word.value === 20) state.units = 'in';
    if (word.value === 21) state.units = 'mm';
    if (word.value === 90) state.xyMode = 'absolute';
    if (word.value === 91) state.xyMode = 'incremental';
    if (word.value === 60 && state.profile === 'neutral') {
      issues.push({ line: lineNumber, type: 'warning',
        message: 'G60 is dialect-specific. Select a source interpreter profile before relying on the arc preview.' });
    }
    if ((word.value === 60 && state.profile === 'legacy-robofil') || word.value === 90.1) state.ijMode = 'absolute';
    if (word.value === 91.1) state.ijMode = 'incremental';
    if (gcodeCommandDefinition(canonicalGCodeCommand('G', word.value)).coverage === 'unknown') {
      issues.push({ line: lineNumber, type: 'warning', message: `Unknown G-code command G${word.value}; its motion and coordinate effects are not modeled.` });
    }
  }
  for (const annotation of context?.commands ?? []) {
    if (annotation.compensation && words.some(word => canonicalGCodeCommand(word.letter, word.value) === annotation.code)) state.compensation = annotation.compensation;
  }

  const explicitMotion = findExplicitMotion(gWords);
  const values = collectLastWordValues(words);
  if (state.units === 'in') {
    for (const letter of ['X', 'Y', 'I', 'J', 'R']) {
      const value = values.get(letter);
      if (value === undefined) continue;
      const scaled = value * 25.4;
      values.set(letter, scaled);
      if (!Number.isFinite(scaled)) {
        issues.push(errorIssue(lineNumber, `Word ${letter} overflows after inch-to-millimetre conversion.`));
        wordScan.hasInvalidMotionWord = true;
        if (letter === 'X' || letter === 'Y') wordScan.hasInvalidPositionWord = true;
      }
    }
  }
  const hasG92 = gWords.some((word) => word.value === 92);
  let positionSet: { x: number; y: number } | null = null;
  const hasCoordinates = ['X', 'Y', 'I', 'J', 'R', 'Z', 'A', 'B', 'C', 'U', 'V', 'W'].some(letter => values.has(letter));
  const unknownG = gWords.some(word => gcodeCommandDefinition(canonicalGCodeCommand('G', word.value)).coverage === 'unknown');
  const cycle = gWords.some(word => word.value >= 80 && word.value <= 89);
  const subprogram = words.some(word => word.letter === 'M' && (word.value === 98 || word.value === 99));
  const referenceReturn = gWords.some(word => word.value === 28 || word.value === 30);
  if (unknownG || cycle || subprogram || referenceReturn) state.motion = null;
  if (unknownG || subprogram || referenceReturn) state.positionKnown = false;
  const ownsCoordinates = gWords.some(word => gcodeCommandDefinition(canonicalGCodeCommand('G', word.value)).blocksImplicitMotion);
  const unsupportedSyntax = wordScan.hasUnparsedText || /^\//.test(cleanedLine);
  if (unsupportedSyntax) state.motion = null;
  const suppressMotion = Boolean(context?.previewUnsupported || unsupportedSyntax || unknownG || subprogram || referenceReturn ||
    (ownsCoordinates && hasCoordinates) || (state.plane !== 'XY' && hasCoordinates));
  if (suppressMotion) {
    if ((hasCoordinates && !gWords.every(word => word.value === 4)) || explicitMotion || unsupportedSyntax || context?.previewUnsupported) state.positionKnown = false;
    if (!unknownG && !wordScan.hasUnparsedText) issues.push({ line: lineNumber, type: 'warning',
      message: context?.previewUnsupported ?? 'Unsupported or conditional coordinate block omitted from the XY preview; its endpoint is not assumed.' });
    return { ...createResult({ cleanedLine, words, explicitMotion, positionSet, issues, commentScan }), previewOmitted: true };
  }

  if (hasG92) {
    if (!wordScan.hasInvalidPositionWord) {
      const hasX = values.has('X');
      const hasY = values.has('Y');
      if (!state.positionKnown && hasX !== hasY) {
        issues.push({ line: lineNumber, type: 'warning', message: 'Partial G92 cannot recover the unknown omitted axis after an unsupported block.' });
        return { ...createResult({ cleanedLine, words, explicitMotion, positionSet, issues, commentScan }), previewOmitted: true };
      }
      positionSet = {
        x: hasX ? normalized(values.get('X')!) : hasY ? state.position.x : 0,
        y: hasY ? normalized(values.get('Y')!) : hasX ? state.position.y : 0
      };
      state.position = { ...positionSet };
      state.positionKnown = true;
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
  if (!command && hasMotionParameters) {
    state.positionKnown = false;
    issues.push({ line: lineNumber, type: 'warning', message: 'Coordinate words have no supported active motion mode; this block is omitted from preview.' });
    return { ...createResult({ cleanedLine, words, explicitMotion, positionSet, issues, commentScan }), previewOmitted: true };
  }
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
  const recoveringPosition = !state.positionKnown;
  if (recoveringPosition && (state.xyMode !== 'absolute' || !values.has('X') || !values.has('Y') || command === 'G2' || command === 'G3')) {
    issues.push({ line: lineNumber, type: 'warning', message: 'Motion start is unknown after an omitted block. Supply complete absolute X/Y positioning before preview can resume.' });
    return { ...createResult({ cleanedLine, words, explicitMotion, positionSet, issues, commentScan }), previewOmitted: true };
  }
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
    const motion: GCodeInterpretedMotion = { command, start, end, ...(recoveringPosition ? { breakBefore: true as const } : {}) };
    state.position = { ...end };
    state.positionKnown = true;
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
      values.commentScan.rawTrimmed !== '',
    previewOmitted: false
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
    if (character === ';' && depth === 0) {
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
  let matchedEnd = 0;
  let remainder = '';
  while ((match = WORD_PATTERN.exec(cleanedLine)) !== null) {
    remainder += cleanedLine.slice(matchedEnd, match.index);
    matchedEnd = WORD_PATTERN.lastIndex;
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

  remainder += cleanedLine.slice(matchedEnd);
  const hasUnparsedText = remainder.trim() !== '' && cleanedLine !== '%';
  if (hasUnparsedText) {
    issues.push(errorIssue(lineNumber, 'Unrecognized block syntax or malformed word; this block is not used for preview.'));
    // Keep the legacy source-bearing warning alongside the conservative preview error.
    issues.push({ line: lineNumber, type: 'warning', message: `Unknown G-code command: ${cleanedLine}` });
  }
  return { words, hasInvalidMotionWord, hasInvalidPositionWord, hasUnparsedText };
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
  const resolvedCandidates = candidates.map((center) => ({
    x: normalized(center.x),
    y: normalized(center.y)
  }));
  const candidatesCoincide =
    resolvedCandidates[0].x === resolvedCandidates[1].x &&
    resolvedCandidates[0].y === resolvedCandidates[1].y;
  const sweepsAreIndistinguishable =
    ranked.some((candidate) => candidate.sweep <= SWEEP_RESOLUTION) ||
    Math.abs(ranked[0].sweep - ranked[1].sweep) <= SWEEP_RESOLUTION;

  if (height > 0 && (candidatesCoincide || sweepsAreIndistinguishable)) {
    issues.push(
      errorIssue(lineNumber, 'Arc minor and major sweeps cannot be distinguished at this scale.')
    );
    return null;
  }

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
