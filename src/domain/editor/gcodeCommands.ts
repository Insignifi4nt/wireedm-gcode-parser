import type { GCodeCommandCoverage } from './gcodeInspectionTypes';

export interface GCodeCommandDefinition {
  readonly meaning: string;
  readonly coverage: GCodeCommandCoverage;
  readonly blocksImplicitMotion?: boolean;
  /** Recognition does not grant geometry support or inherited motion. */
  readonly motionEffect?: 'suspend' | 'invalidate';
  readonly scope?: string;
  /** Shared recognition does not change the legacy editor's prior geometry omission. */
  readonly legacyOmit?: true;
}

const modeled = (meaning: string): GCodeCommandDefinition => ({ meaning, coverage: 'modeled' });
const unmodeled = (meaning: string, blocksImplicitMotion = false): GCodeCommandDefinition =>
  ({ meaning, coverage: 'recognized-not-modeled', blocksImplicitMotion });
const specific = (meaning: string, blocksImplicitMotion = false): GCodeCommandDefinition =>
  ({ meaning, coverage: 'controller-specific', blocksImplicitMotion });
const documented = (meaning: string, scope: string, motionEffect?: GCodeCommandDefinition['motionEffect']): GCodeCommandDefinition =>
  ({ meaning, scope, coverage: 'recognized-not-modeled', legacyOmit: true, ...(motionEffect ? { motionEffect, blocksImplicitMotion: true } : {}) });
const dialect = (meaning: string, scope: string, motionEffect?: GCodeCommandDefinition['motionEffect']): GCodeCommandDefinition =>
  ({ ...documented(meaning, scope, motionEffect), coverage: 'controller-specific' });
const linux = 'LinuxCNC documented dialect; controller implementations may differ';
const haas = 'Haas mill documented dialect; controller implementations may differ';

const commands: Readonly<Record<string, GCodeCommandDefinition>> = {
  G0: modeled('Rapid XY positioning'), G1: modeled('Linear XY motion'),
  G2: modeled('Clockwise XY arc'), G3: modeled('Counterclockwise XY arc'),
  G4: unmodeled('Dwell; axis words are not modal movement', true),
  G5: dialect('Spline or advanced interpolation control', linux, 'invalidate'),
  'G5.1': dialect('Spline or advanced interpolation control', linux, 'invalidate'),
  'G5.2': dialect('NURBS interpolation control', linux, 'invalidate'),
  'G5.3': dialect('End NURBS interpolation control', linux, 'invalidate'),
  G7: documented('Lathe diameter-coordinate mode', linux, 'invalidate'),
  G8: documented('Lathe radius-coordinate mode', linux, 'invalidate'),
  G10: unmodeled('Program or coordinate settings', true),
  G17: modeled('XY plane'), G18: unmodeled('XZ plane'), G19: unmodeled('YZ plane'),
  'G17.1': documented('UV auxiliary plane', linux), 'G18.1': documented('WU auxiliary plane', linux),
  'G19.1': documented('VW auxiliary plane', linux),
  G20: modeled('Inch units'), G21: modeled('Millimetre units'),
  G28: unmodeled('Reference-position return', true), G30: unmodeled('Reference-position return', true),
  'G28.1': documented('Store reference position', linux), 'G30.1': documented('Store reference position', linux),
  G33: documented('Spindle-synchronized motion', linux, 'invalidate'),
  'G33.1': documented('Rigid tapping', linux, 'invalidate'),
  G38: specific('Controller-specific probing or EDM compensation control', true),
  'G38.2': documented('Probe toward workpiece; error if contact is not reached', linux, 'invalidate'),
  'G38.3': documented('Probe toward workpiece; no contact error', linux, 'invalidate'),
  'G38.4': documented('Probe away from workpiece; error if contact is not broken', linux, 'invalidate'),
  'G38.5': documented('Probe away from workpiece; no contact error', linux, 'invalidate'),
  G39: specific('Controller-specific control; meaning requires exact source context', true),
  G40: unmodeled('Cancel cutter compensation'), G41: unmodeled('Left cutter compensation'),
  G42: unmodeled('Right cutter compensation'), G43: unmodeled('Tool-length compensation'),
  'G41.1': documented('Dynamic left cutter compensation', linux),
  'G42.1': documented('Dynamic right cutter compensation', linux),
  'G43.1': documented('Dynamic tool-length offset', linux, 'invalidate'),
  'G43.2': documented('Additional tool-length offset', linux, 'invalidate'),
  G44: dialect('Subtract tool-length compensation', haas),
  G49: unmodeled('Cancel tool-length compensation'), G52: unmodeled('Local coordinate offset', true),
  G50: dialect('Cancel scaling or other controller-specific limits', haas, 'invalidate'),
  G51: dialect('Coordinate scaling', haas, 'invalidate'),
  G53: unmodeled('Machine-coordinate positioning', true),
  G54: unmodeled('Work coordinate frame'), G55: unmodeled('Work coordinate frame'),
  G56: unmodeled('Work coordinate frame'), G57: unmodeled('Work coordinate frame'),
  G58: unmodeled('Work coordinate frame'), G59: unmodeled('Work coordinate frame'),
  'G54.1': unmodeled('Extended work coordinate frame'),
  'G59.1': unmodeled('Extended work coordinate frame'), 'G59.2': unmodeled('Extended work coordinate frame'),
  'G59.3': unmodeled('Extended work coordinate frame'),
  G60: specific('Dialect-specific positioning or arc-center control'),
  G61: documented('Exact path or stop control; implementation is controller dependent', 'Common controller convention'),
  'G61.1': documented('Exact stop path control', linux),
  G64: documented('Continuous path or blending control; tolerances are not simulated', 'Common controller convention'),
  G65: dialect('Macro subprogram call', haas, 'invalidate'),
  G68: dialect('Coordinate rotation', haas, 'invalidate'),
  G69: dialect('Cancel coordinate rotation', haas, 'invalidate'),
  G70: dialect('Lathe finishing or mill bolt-hole cycle', `${linux}; ${haas}`, 'invalidate'),
  G71: dialect('Lathe roughing or mill bolt-hole cycle', `${linux}; ${haas}`, 'invalidate'),
  G72: dialect('Lathe roughing or mill bolt-hole cycle', `${linux}; ${haas}`, 'invalidate'),
  G73: dialect('Peck drilling or controller-specific roughing cycle', `${linux}; ${haas}`, 'invalidate'),
  G74: dialect('Tapping or controller-specific cycle', `${linux}; ${haas}`, 'invalidate'),
  G76: dialect('Threading or boring cycle', `${linux}; ${haas}`, 'invalidate'),
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
  G93: documented('Inverse-time feed mode', 'Common controller convention'), G94: unmodeled('Feed per minute'), G95: unmodeled('Feed per revolution'),
  G96: unmodeled('Constant surface speed'), G97: unmodeled('Fixed spindle speed'),
  G98: specific('Controller-specific cycle or feed mode'), G99: specific('Controller-specific cycle or feed mode'),
  M0: unmodeled('Program pause'), M1: unmodeled('Optional program pause'),
  M2: unmodeled('Program end'), M30: unmodeled('Program end/reset'),
  M3: unmodeled('Spindle control'), M4: unmodeled('Spindle control'), M5: unmodeled('Spindle stop'),
  M6: { ...unmodeled('Tool change; configured axes may move'), motionEffect: 'invalidate' },
  M7: unmodeled('Coolant control'), M8: unmodeled('Coolant control'),
  M9: unmodeled('Coolant off'), M19: { ...documented('Spindle orientation', linux), blocksImplicitMotion: true },
  M48: documented('Enable feed and spindle overrides', linux), M49: documented('Disable feed and spindle overrides', linux),
  M50: documented('Feed override control', linux), M51: documented('Spindle override control', linux),
  M52: documented('Adaptive feed control', linux), M53: documented('Feed stop control', linux),
  M60: documented('Pallet change and pause', linux, 'invalidate'),
  M61: documented('Set current tool number', linux),
  M62: documented('Synchronized digital output on', linux), M63: documented('Synchronized digital output off', linux),
  M64: documented('Immediate digital output on', linux), M65: documented('Immediate digital output off', linux),
  M66: documented('Wait/read input signal', linux), M67: documented('Synchronized analog output', linux),
  M68: documented('Immediate analog output', linux),
  M97: dialect('Local subprogram call', haas, 'invalidate'),
  M98: unmodeled('Subprogram call'), M99: unmodeled('Subprogram return')
};

export const canonicalGCodeCommand = (letter: string, value: number) => `${letter.toUpperCase()}${value}`;
export function gcodeCommandDefinition(code: string): GCodeCommandDefinition {
  if (/^M(?:1\d\d)$/.test(code)) return dialect('User-defined command; effects require exact controller context', linux, 'invalidate');
  return commands[code] ?? { meaning: 'Unknown command; controller semantics are not modeled', coverage: 'unknown', blocksImplicitMotion: true };
}

/** Classification is about placement/recognition, not execution support. */
export function isRecognizedGCodeSetup(value: number) {
  const code = canonicalGCodeCommand('G', value);
  const definition = gcodeCommandDefinition(code);
  return !['G0', 'G1', 'G2', 'G3'].includes(code) && definition.coverage !== 'unknown';
}
