import type { GCodeCommandCoverage } from './gcodeInspectionTypes';

export interface GCodeCommandDefinition {
  readonly meaning: string;
  readonly coverage: GCodeCommandCoverage;
  readonly blocksImplicitMotion?: boolean;
}

const modeled = (meaning: string): GCodeCommandDefinition => ({ meaning, coverage: 'modeled' });
const unmodeled = (meaning: string, blocksImplicitMotion = false): GCodeCommandDefinition =>
  ({ meaning, coverage: 'recognized-not-modeled', blocksImplicitMotion });
const specific = (meaning: string, blocksImplicitMotion = false): GCodeCommandDefinition =>
  ({ meaning, coverage: 'controller-specific', blocksImplicitMotion });

const commands: Readonly<Record<string, GCodeCommandDefinition>> = {
  G0: modeled('Rapid XY positioning'), G1: modeled('Linear XY motion'),
  G2: modeled('Clockwise XY arc'), G3: modeled('Counterclockwise XY arc'),
  G4: unmodeled('Dwell; axis words are not modal movement', true),
  G10: unmodeled('Program or coordinate settings', true),
  G17: modeled('XY plane'), G18: unmodeled('XZ plane'), G19: unmodeled('YZ plane'),
  G20: modeled('Inch units'), G21: modeled('Millimetre units'),
  G28: unmodeled('Reference-position return', true), G30: unmodeled('Reference-position return', true),
  G38: specific('Controller-specific probing or EDM compensation control', true),
  G39: specific('Controller-specific control; meaning requires exact source context', true),
  G40: unmodeled('Cancel cutter compensation'), G41: unmodeled('Left cutter compensation'),
  G42: unmodeled('Right cutter compensation'), G43: unmodeled('Tool-length compensation'),
  G49: unmodeled('Cancel tool-length compensation'), G52: unmodeled('Local coordinate offset', true),
  G53: unmodeled('Machine-coordinate positioning', true),
  G54: unmodeled('Work coordinate frame'), G55: unmodeled('Work coordinate frame'),
  G56: unmodeled('Work coordinate frame'), G57: unmodeled('Work coordinate frame'),
  G58: unmodeled('Work coordinate frame'), G59: unmodeled('Work coordinate frame'),
  'G54.1': unmodeled('Extended work coordinate frame'),
  'G59.1': unmodeled('Extended work coordinate frame'), 'G59.2': unmodeled('Extended work coordinate frame'),
  'G59.3': unmodeled('Extended work coordinate frame'),
  G60: specific('Dialect-specific positioning or arc-center control'),
  G80: unmodeled('Cancel canned cycle', true),
  G81: unmodeled('Canned cycle', true), G82: unmodeled('Canned cycle', true),
  G83: unmodeled('Canned cycle', true), G84: unmodeled('Canned cycle', true),
  G85: unmodeled('Canned cycle', true), G86: unmodeled('Canned cycle', true),
  G87: unmodeled('Canned cycle', true), G88: unmodeled('Canned cycle', true), G89: unmodeled('Canned cycle', true),
  G90: modeled('Absolute XY coordinates'), G91: modeled('Incremental XY coordinates'),
  'G90.1': modeled('Absolute IJ arc centers'), 'G91.1': modeled('Incremental IJ arc centers'),
  G92: modeled('Set logical XY coordinates'),
  'G92.1': unmodeled('Coordinate-offset control', true), 'G92.2': unmodeled('Coordinate-offset control', true),
  'G92.3': unmodeled('Coordinate-offset control', true),
  G94: unmodeled('Feed per minute'), G95: unmodeled('Feed per revolution'),
  G96: unmodeled('Constant surface speed'), G97: unmodeled('Fixed spindle speed'),
  G98: specific('Controller-specific cycle or feed mode'), G99: specific('Controller-specific cycle or feed mode'),
  M0: unmodeled('Program pause'), M1: unmodeled('Optional program pause'),
  M2: unmodeled('Program end'), M30: unmodeled('Program end/reset'),
  M3: unmodeled('Spindle control'), M4: unmodeled('Spindle control'), M5: unmodeled('Spindle stop'),
  M6: unmodeled('Tool change'), M7: unmodeled('Coolant control'), M8: unmodeled('Coolant control'),
  M9: unmodeled('Coolant off'), M98: unmodeled('Subprogram call'), M99: unmodeled('Subprogram return')
};

export const canonicalGCodeCommand = (letter: string, value: number) => `${letter.toUpperCase()}${value}`;
export function gcodeCommandDefinition(code: string): GCodeCommandDefinition {
  return commands[code] ?? { meaning: 'Unknown command; controller semantics are not modeled', coverage: 'unknown', blocksImplicitMotion: true };
}

/** Classification is about placement/recognition, not execution support. */
export function isRecognizedGCodeSetup(value: number) {
  const code = canonicalGCodeCommand('G', value);
  return !['G0', 'G1', 'G2', 'G3'].includes(code) && gcodeCommandDefinition(code).coverage !== 'unknown';
}
