import { canonicalGCodeCommand, gcodeCommandDefinition } from './gcodeCommands';
import { parseGCodeProgramDetailed } from './gcodeParser';
import type { GCodeModalSnapshot, GCodeProgramInspection, GCodeInspectionOptions, GCodeCommandInspection, GCodeLineInspection } from './gcodeInspectionTypes';
import type { GCodeInterpreterState } from './gcodeBlockInterpreter';
import type { GCodeParseIssue } from './types';
import { validateGCodeInspectionSource } from './gcodeInspectionSource';

export type * from './gcodeInspectionTypes';

const snapshot = (state: GCodeInterpreterState): GCodeModalSnapshot => ({
  position: { ...state.position }, positionKnown: state.positionKnown,
  units: state.units, xyMode: state.xyMode, ijMode: state.ijMode, motion: state.motion,
  plane: state.plane, compensation: state.compensation
});

function canonicalDescriptionCode(code: string) {
  const match = /^([GM])\s*(\d+(?:\.\d+)?)$/i.exec(code.trim());
  return match ? canonicalGCodeCommand(match[1], Number(match[2])) : null;
}

/** Read-only nominal XY inspection. Context is ephemeral and never changes source or saved profiles. */
export function inspectGCodeProgram(text: string, options: GCodeInspectionOptions = {}): GCodeProgramInspection {
  if (typeof text !== 'string') throw new Error('G-code input must be a string.');
  const inputError = validateGCodeInspectionSource(text);
  if (inputError && text.trim()) throw new Error(inputError);
  const lines: GCodeLineInspection[] = [];
  const inventory = new Map<string, { count: number; sourceLines: number[]; definitions: Map<string, Omit<GCodeCommandInspection, 'code' | 'count' | 'sourceLines'>> }>();
  const extras: GCodeParseIssue[] = [];
  const descriptions = new Map(options.commandDescriptions?.flatMap(description => {
    const code = canonicalDescriptionCode(description.code);
    return code ? [[code, description] as const] : [];
  }));
  const contexts = new Map(options.lineContexts?.map(context => [context.line, context]));
  let programEndLine: number | null = null;
  const parseResult = parseGCodeProgramDetailed(text, options, (line, sourceText, block, before, after) => {
    const context = contexts.get(line);
    const commandCodes = block.words.filter(word => word.letter === 'G' || word.letter === 'M')
      .map(word => canonicalGCodeCommand(word.letter, word.value));
    for (const code of commandCodes) {
      const base = gcodeCommandDefinition(code);
      const description = context?.commands?.find(item => canonicalDescriptionCode(item.code) === code) ?? descriptions.get(code);
      const definition = {
        meaning: description?.meaning ?? (code === 'G60' && options.profile === 'legacy-robofil'
          ? 'Legacy Robofil absolute IJ arc-center mode' : base.meaning),
        coverage: context?.previewUnsupported && ['G0', 'G1', 'G2', 'G3'].includes(code) ? 'recognized-not-modeled' as const
          : description && base.coverage === 'unknown' ? 'controller-specific' as const : base.coverage,
        scope: description?.scope ?? (code === 'G60' && options.profile === 'legacy-robofil' ? 'legacy-robofil' : 'nominal XY interpreter')
      };
      const row: NonNullable<ReturnType<typeof inventory.get>> = inventory.get(code) ?? { count: 0, sourceLines: [], definitions: new Map() };
      row.count++;
      if (row.sourceLines.at(-1) !== line) row.sourceLines.push(line);
      row.definitions.set(`${definition.scope}:${definition.meaning}`, definition);
      inventory.set(code, row);
      if (definition.coverage === 'controller-specific') extras.push({ line, type: 'warning',
        message: `${code}: ${definition.meaning}. Scope: ${definition.scope}; controller execution is not modeled.` });
      if (code.startsWith('M') && definition.coverage === 'unknown') extras.push({ line, type: 'warning',
        message: `Unknown command ${code}; its machine or control-flow effects are not modeled.` });
    }
    if (commandCodes.includes('G41') || commandCodes.includes('G42')) extras.push({ line, type: 'warning',
      message: 'Controller cutter compensation is not applied to the nominal XY preview.' });
    const nonXy = block.words.filter(word => ['Z', 'A', 'B', 'C', 'U', 'V', 'W'].includes(word.letter));
    if (nonXy.length) extras.push({ line, type: 'warning',
      message: `Axes ${[...new Set(nonXy.map(word => word.letter))].join(', ')} are not modeled by the XY preview.` });
    if (programEndLine !== null && block.motion) extras.push({ line, type: 'warning',
      message: `Motion follows the program-end marker on line ${programEndLine}; this source-order trace does not simulate controller control flow.` });
    if (commandCodes.includes('M2') || commandCodes.includes('M30')) programEndLine = line;
    lines.push({ line, text: sourceText, commands: commandCodes, before: snapshot(before), after: snapshot(after),
      diagnostics: [], previewStatus: block.previewOmitted || block.motion?.breakBefore ? 'omitted'
        : block.motion ? 'motion' : block.positionSet ? 'position' : 'no-motion' });
  }, 'omit');
  // An explicit context anchor supplies a real first-segment start, unlike an assumed origin.
  if (options.defaults?.initialPosition && parseResult.path[0]?.type !== 'position' && parseResult.path.length) {
    parseResult.path.unshift({ type: 'position', ...options.defaults.initialPosition, line: 0, meta: { source: 'inspection-context' } });
    const position = options.defaults.initialPosition;
    parseResult.bounds = { minX: Math.min(parseResult.bounds.minX, position.x), maxX: Math.max(parseResult.bounds.maxX, position.x),
      minY: Math.min(parseResult.bounds.minY, position.y), maxY: Math.max(parseResult.bounds.maxY, position.y) };
  }
  // Finite endpoints can still overflow their extent. Do not hand an invalid view box to the UI.
  const bounds = parseResult.bounds;
  const invalidExtent = parseResult.path.length > 0 && ![
    bounds.minX - 1, bounds.minY - 1,
    bounds.maxX - bounds.minX + 2, bounds.maxY - bounds.minY + 2
  ].every(Number.isFinite);
  if (invalidExtent) {
    parseResult.errors.push({ line: 0, type: 'error',
      message: 'XY preview extent exceeds finite numeric representation; geometry is unavailable. Source and modal trace remain available.' });
    parseResult.stats.errors++;
    parseResult.path = [];
    parseResult.bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    lines.forEach((line, index) => {
      if (line.previewStatus === 'motion' || line.previewStatus === 'position') lines[index] = { ...line, previewStatus: 'omitted' };
    });
  }
  const keys = new Set<string>();
  const diagnostics: GCodeParseIssue[] = [];
  for (const issue of [...parseResult.errors, ...parseResult.warnings, ...extras]) {
    const key = `${issue.line}:${issue.type}:${issue.message}`;
    if (!keys.has(key)) { keys.add(key); diagnostics.push(issue); }
  }
  diagnostics.sort((left, right) => left.line - right.line);
  const byLine = new Map<number, GCodeParseIssue[]>();
  for (const issue of diagnostics) {
    const list = byLine.get(issue.line) ?? []; list.push(issue); byLine.set(issue.line, list);
  }
  const commands: GCodeCommandInspection[] = [...inventory].map(([code, row]) => {
    const definitions = [...row.definitions.values()];
    return { code, count: row.count, sourceLines: row.sourceLines,
      meaning: definitions.map(value => value.meaning).join(' / '), scope: definitions.map(value => value.scope).join(' / '),
      coverage: definitions.find(value => value.coverage !== 'modeled')?.coverage ?? 'modeled' };
  });
  const assumptions = [
    `Source interpreter: ${options.profile ?? 'neutral'}; controller-specific meanings are not inferred from filenames.`,
    `Initial XY mode: ${options.defaults?.xyMode ?? 'absolute'}; initial IJ mode: ${options.defaults?.ijMode ?? 'incremental'}. Source declarations override these defaults.`,
    options.defaults?.units ? `Explicit initial unit assumption: ${options.defaults.units}.` : 'Units are unknown until G20/G21; undeclared coordinate values retain their source scale.',
    options.defaults?.initialPosition ? `Explicit initial logical position: X${options.defaults.initialPosition.x}, Y${options.defaults.initialPosition.y}.`
      : 'Initial logical position assumes X0, Y0; an undeclared physical start is not verified.',
    'The preview shows nominal XY coordinates only, without controller compensation, coordinate-frame offsets, non-XY axes or machine/control-flow execution.'
  ];
  if (contexts.size) assumptions.push(`${contexts.size} source lines have explicit scoped inspection context; it does not authorize unknown motion.`);
  const unavailable = !parseResult.path.some(point => point.type !== 'position' && !('breakBefore' in point && point.breakBefore));
  const limited = diagnostics.length > 0 || commands.some(command => command.coverage !== 'modeled') || parseResult.coordinateUnits === null;
  return { parseResult, commands, lines: lines.map(line => ({ ...line, diagnostics: byLine.get(line.line) ?? [] })),
    diagnostics, assumptions, preview: { status: unavailable ? 'unavailable' : limited ? 'limited' : 'complete',
      summary: invalidExtent ? 'XY preview is unavailable because its numeric extent cannot be represented. Read the source and diagnostics.'
        : unavailable ? 'No supported XY motion is available. Read the source and diagnostics.'
        : limited ? 'Partial nominal XY preview. Unsupported blocks, controller compensation and control flow are not simulated.'
        : 'Supported nominal XY command trace only; this is not a controller execution or machining certification.' } };
}
