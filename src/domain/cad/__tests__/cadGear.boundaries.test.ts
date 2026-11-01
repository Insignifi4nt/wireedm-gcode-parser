import { describe, expect, it } from 'vitest';
import { DEFAULT_CAD_GEAR, resolveCadGear, type CadGearProfile } from '../cadGear';

const radians = (degrees: number) => degrees * Math.PI / 180;
const involute = (t: number) => t - Math.atan(t);

/** Standard rack undercut limit for `teeth` at `pressureAngle` degrees: 1 − z·sin²α / 2. */
function undercutLimit(teeth: number, pressureAngle: number) {
  return 1 - teeth * Math.sin(radians(pressureAngle)) ** 2 / 2;
}

/** Backlash, in millimetres, that leaves each tooth tip `tipHalfAngle` radians wide on either side of its centre line. */
function backlashForTipHalfAngle(profile: CadGearProfile, tipHalfAngle: number) {
  const m = Number(profile.module), z = Number(profile.teeth), shift = Number(profile.profileShift), alpha = radians(Number(profile.pressureAngle));
  const baseRadius = m * z / 2 * Math.cos(alpha), tipRadius = m * (z / 2 + 1 + shift);
  const tipRoll = Math.sqrt((tipRadius / baseRadius) ** 2 - 1);
  // Tip half-angle = (π/2 + 2·x·tan α − backlash/m) / z + inv α − inv(tip roll), solved for the backlash.
  return m * (Math.PI / 2 + 2 * shift * Math.tan(alpha) + z * (involute(Math.tan(alpha)) - involute(tipRoll) - tipHalfAngle));
}

describe('gear undercut shift slack', () => {
  const profile: CadGearProfile = { ...DEFAULT_CAD_GEAR, teeth: 12, pressureAngle: 20 };
  const limit = undercutLimit(12, 20);

  it('accepts a profile shift 4e-13 below the undercut limit as roundoff at the limit', () => {
    const gear = resolveCadGear({ ...profile, profileShift: limit - 4e-13 }, {});
    expect(gear.teeth).toBe(12);
    expect(gear.segments.length).toBeGreaterThan(0);
  });

  it('refuses a profile shift 3e-12 below the undercut limit as undercut', () => {
    expect(() => resolveCadGear({ ...profile, profileShift: limit - 3e-12 }, {})).toThrow(/needs profile shift at least 0\.2981 to avoid standard rack undercut/);
  });
});

describe('gear angle margin', () => {
  const profile: CadGearProfile = { ...DEFAULT_CAD_GEAR, teeth: 12, profileShift: 0.4 };

  it('accepts teeth whose tips are 3e-6 rad wide on either side', () => {
    const gear = resolveCadGear({ ...profile, backlash: backlashForTipHalfAngle(profile, 3e-6) }, {});
    const tipSweeps = gear.segments.flatMap(segment => segment.kind === 'arc' && segment.radius === gear.tipDiameter / 2 ? [segment.sweep * Math.PI / 180] : []);
    expect(tipSweeps).toHaveLength(12);
    for (const sweep of tipSweeps) expect(sweep).toBeCloseTo(6e-6, 12);
  });

  it('refuses teeth whose tips are only 4e-7 rad wide on either side as pointed', () => {
    expect(() => resolveCadGear({ ...profile, backlash: backlashForTipHalfAngle(profile, 4e-7) }, {})).toThrow(/overlap or have pointed tips/);
  });
});
