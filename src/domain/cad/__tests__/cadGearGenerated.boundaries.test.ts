import { describe, expect, it } from 'vitest';
import { DEFAULT_CAD_GEAR } from '../cadGear';
import { resolveConfiguredCadGear, type CadConfiguredGearProfile } from '../cadGearGenerated';

/**
 * A 12-tooth, 20° gear cut by a rack whose tip radius is 0.1 × module, so the cutter, not the
 * standard rack limit, sets its undercut limit.
 */
const profile: CadConfiguredGearProfile = { ...DEFAULT_CAD_GEAR, module: 1, teeth: 12, pressureAngle: 20, cutterTipRadius: 0.1 };

/** Profile shift whose generated flank starts at roll parameter `roll`: Wright's ψmin solved for the shift, in unit module. */
function shiftForFlankStart(roll: number) {
  const alpha = 20 * Math.PI / 180, pitchRadius = 6, cutterTip = 0.1, dedendum = 1.25;
  const undercutLimit = dedendum - pitchRadius * Math.sin(alpha) ** 2 - cutterTip * (1 - Math.sin(alpha));
  return undercutLimit + roll * pitchRadius * Math.cos(alpha) * Math.sin(alpha);
}

describe('generated gear parameter slack', () => {
  it('accepts a flank that starts at roll parameter −4e-11 as starting on the base circle', () => {
    const gear = resolveConfiguredCadGear({ ...profile, profileShift: shiftForFlankStart(-4e-11) }, {});
    expect(gear.flankInterval[0]).toBe(0);
    expect(gear.minimumShift).toBeCloseTo(shiftForFlankStart(0), 12);
  });

  it('refuses a flank that starts at roll parameter −3e-10 as undercut', () => {
    expect(() => resolveConfiguredCadGear({ ...profile, profileShift: shiftForFlankStart(-3e-10) }, {})).toThrow(/needs a non-undercut flank/);
  });
});
