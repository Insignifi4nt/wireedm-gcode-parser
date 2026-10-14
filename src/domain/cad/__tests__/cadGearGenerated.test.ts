import { describe, expect, it } from 'vitest';
import { DEFAULT_CAD_GEAR, resolveCadGear, type CadGearProfile } from '../cadGear';
import { generatedGearRackTipCoefficient, resolveConfiguredCadGear, resolveGeneratedCadGear } from '../cadGearGenerated';
import type { ResolvedCadPathSegment } from '../cadAnalyticSegments';

type Point = readonly [number, number];
const norm = (p: Point) => Math.hypot(...p);
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const mix = (a: Point, b: Point, u: number): Point => [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u];
function ends(segment: ResolvedCadPathSegment): readonly [Point, Point] {
  if (segment.kind === 'line') return [segment.start, segment.end];
  const at = (degrees: number): Point => [segment.center[0] + segment.radius * Math.cos(degrees * Math.PI / 180), segment.center[1] + segment.radius * Math.sin(degrees * Math.PI / 180)];
  return [at(segment.startAngle), at(segment.startAngle + segment.sweep)];
}

/** Independent source coordinates: Wright, DANotes Appendix B (v), (viii), (x), (xi).
 * Source x,y are rotated -90 degrees into the workbench's tooth-on-positive-X frame.
 */
function sourceCurves(profile: CadGearProfile, cutterTipRadius?: number) {
  if ([profile.module, profile.teeth, profile.pressureAngle, profile.profileShift, profile.backlash].some(value => typeof value !== 'number')) throw new Error('Numeric source fixture required');
  const m = Number(profile.module), R = Number(profile.teeth) / 2, alpha = Number(profile.pressureAngle) * Math.PI / 180;
  const s = Number(profile.profileShift), h = Math.PI / 4 - Number(profile.backlash) / (2 * m), b = 1.25;
  // Clearance caps rounding; a positive 5% rack tip land caps the radius at steep angles.
  const clearanceCap = .25 / (1 - Math.sin(alpha));
  const rackLandCap = .95 * (Math.PI / 2 - h - b * Math.tan(alpha)) / (1 / Math.cos(alpha) - Math.tan(alpha));
  const e = cutterTipRadius === undefined ? Math.min(clearanceCap, rackLandCap) : cutterTipRadius / m;
  const uc = h + e / Math.cos(alpha) + (b - e) * Math.tan(alpha), vc = e - b;
  const gamma = (h + s * Math.tan(alpha)) / R + Math.tan(alpha) - alpha;
  const psiMin = Math.tan(alpha) + (s + e * (1 - Math.sin(alpha)) - b) / (R * Math.cos(alpha) * Math.sin(alpha));
  const psiMax = Math.sqrt(((R + s + 1) / (R * Math.cos(alpha))) ** 2 - 1);
  const phiMax = -uc / R, phiMin = psiMin - alpha - gamma;
  const trochoid = (phi: number): Point => {
    const lambda = 1 + e / Math.sqrt((R * phi + uc) ** 2 + (s + vc) ** 2);
    const sourceX = lambda * (R * phi + uc) * Math.cos(phi) - (R + lambda * (s + vc)) * Math.sin(phi);
    const sourceY = lambda * (R * phi + uc) * Math.sin(phi) + (R + lambda * (s + vc)) * Math.cos(phi);
    return [m * sourceY, -m * sourceX];
  };
  // Cartesian involute avoids repeating production polar implementation.
  const involute = (psi: number): Point => {
    const theta = psi - gamma, rb = m * R * Math.cos(alpha);
    return [rb * (Math.cos(theta) + psi * Math.sin(theta)), rb * (Math.sin(theta) - psi * Math.cos(theta))];
  };
  return { trochoid, involute, phiMax, phiMin, psiMin, psiMax, cutterTipRadius: m * e,
    minimumShift: b - R * Math.sin(alpha) ** 2 - e * (1 - Math.sin(alpha)) };
}
const fixtures: readonly CadGearProfile[] = [
  DEFAULT_CAD_GEAR,
  { ...DEFAULT_CAD_GEAR, teeth: 50 },
  { ...DEFAULT_CAD_GEAR, teeth: 12, profileShift: .4 },
  { ...DEFAULT_CAD_GEAR, teeth: 36, profileShift: -.2, backlash: .15 },
  { ...DEFAULT_CAD_GEAR, teeth: 55, pressureAngle: 14.5, profileShift: .2 },
  { ...DEFAULT_CAD_GEAR, teeth: 55, pressureAngle: 25 },
  { ...DEFAULT_CAD_GEAR, teeth: 18, pressureAngle: 30 },
  { ...DEFAULT_CAD_GEAR, teeth: 300, module: .05, tolerance: .00025 },
  { ...DEFAULT_CAD_GEAR, module: 50, tolerance: .02 },
];

describe('rack-generated involute gear geometry', () => {
  it('applies the V3 edge budget to its certified boundary while preserving V1/V2 budget checks', () => {
    const profile = { ...DEFAULT_CAD_GEAR, module: 1, teeth: 36, tolerance: .00005 };
    const cutterTipRadius = generatedGearRackTipCoefficient(20 * Math.PI / 180, 0);
    expect(() => resolveCadGear(profile, {})).toThrow(/8192-edge modeling budget/);
    expect(() => resolveGeneratedCadGear(profile, {})).toThrow(/8192-edge modeling budget/);
    const configured = resolveConfiguredCadGear({ ...profile, cutterTipRadius }, {});
    expect(configured).toMatchObject({ edgeCount: 6984, rootSteps: 56, flankSteps: 40, tolerance: .00005 });
    expect(configured.segments).toHaveLength(configured.edgeCount);
    expect(() => resolveConfiguredCadGear({ ...profile, cutterTipRadius, tolerance: .00001 }, {})).toThrow(/Generated gear needs .*8192-edge budget/);
    expect(() => resolveConfiguredCadGear({ ...profile, cutterTipRadius, tolerance: .000001 }, {})).toThrow(/at least 0.00001/);
  });
  it('keeps the pinned V2 sampling while V3 removes conservative tangential interpolation error', () => {
    const previous = resolveGeneratedCadGear(DEFAULT_CAD_GEAR, {});
    expect(previous).toMatchObject({ rootSteps: 14, flankSteps: 17, edgeCount: 1152, tolerance: .005 });
    const upgraded = resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, cutterTipRadius: previous.cutterTipRadius }, {});
    expect(upgraded).toMatchObject({ rootSteps: 13, flankSteps: 10, edgeCount: 864, tolerance: .005 });
    expect(upgraded.pitchDiameter).toBe(previous.pitchDiameter);
    expect(upgraded.tipDiameter).toBe(previous.tipDiameter);
    expect(upgraded.rootDiameter).toBe(previous.rootDiameter);
    for (let i = 0; i <= 50; i++) {
      const t = previous.flankInterval[0] + (previous.flankInterval[1] - previous.flankInterval[0]) * i / 50;
      expect(distance(upgraded.flankPoint(t), previous.flankPoint(t))).toBeLessThan(1e-12);
    }
  });
  it.each(fixtures)('certifies geometric deviation, closure and independent generating equations for configured radii (m=$module,z=$teeth)', original => {
    const m = Number(original.module), alpha = Number(original.pressureAngle) * Math.PI / 180;
    for (const fraction of [.2, .5, 1]) {
      const radius = m * generatedGearRackTipCoefficient(alpha, Number(original.backlash) / m) * fraction;
      const minimumShift = 1.25 - Number(original.teeth) / 2 * Math.sin(alpha) ** 2 - radius / m * (1 - Math.sin(alpha));
      const profile = { ...original, profileShift: Math.max(Number(original.profileShift), minimumShift + 1e-8), cutterTipRadius: radius };
      const geometry = resolveConfiguredCadGear(profile, {}), source = sourceCurves(profile, radius);
      expect(geometry.cutterTipRadius).toBeCloseTo(radius, 12);
      const lineDistance = (point: Point, a: Point, b: Point) => {
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const projection = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
        return distance(point, mix(a, b, projection));
      };
      const flankLines = geometry.segments.slice(geometry.rootSteps, geometry.rootSteps + geometry.flankSteps);
      flankLines.forEach((line, index) => {
        if (line.kind !== 'line') throw new Error('Expected chord');
        const from = geometry.flankParameters[index], to = geometry.flankParameters[index + 1];
        expect(distance(line.start, source.involute(from))).toBeLessThan(1e-8);
        expect(distance(line.end, source.involute(to))).toBeLessThan(1e-8);
        for (let i = 0; i <= 80; i++) expect(lineDistance(source.involute(from + (to - from) * i / 80), line.start, line.end))
          .toBeLessThanOrEqual(geometry.tolerance * (1 + 1e-8));
      });
      const rootParameters: number[] = [source.phiMax];
      const rootLines = geometry.segments.slice(0, geometry.rootSteps);
      rootLines.forEach((line, index) => {
        if (line.kind !== 'line') throw new Error('Expected root chord');
        let low = 0, high = 1;
        for (let iteration = 0; iteration < 60; iteration++) {
          const u = (low + high) / 2, t = source.phiMax + (source.phiMin - source.phiMax) * u;
          if (norm(source.trochoid(t)) < norm(line.end)) low = u; else high = u;
        }
        const from = rootParameters[index], to = index === rootLines.length - 1 ? source.phiMin : source.phiMax + (source.phiMin - source.phiMax) * (low + high) / 2;
        rootParameters.push(to);
        expect(distance(line.start, source.trochoid(from))).toBeLessThan(1e-8);
        expect(distance(line.end, source.trochoid(to))).toBeLessThan(1e-8);
        for (let i = 0; i <= 80; i++) expect(distance(source.trochoid(from + (to - from) * i / 80), mix(line.start, line.end, i / 80)))
          .toBeLessThanOrEqual(geometry.tolerance * (1 + 1e-8));
      });
      for (let i = 0; i < geometry.segments.length; i++) {
        const [start, end] = ends(geometry.segments[i]), next = ends(geometry.segments[(i + 1) % geometry.segments.length])[0];
        expect(distance(end, next)).toBeLessThan(1e-8);
        expect(start[0] * end[1] - start[1] * end[0]).toBeGreaterThan(0);
      }
      expect(distance(source.trochoid(source.phiMin), source.involute(source.psiMin))).toBeLessThan(1e-8);
      expect(geometry.edgeCount).toBeLessThanOrEqual(8192);
    }
  });
  it('bounds configurable cutter geometry and makes smaller tips require their true undercut threshold', () => {
    const maximum = resolveGeneratedCadGear(DEFAULT_CAD_GEAR, {}).cutterTipRadius;
    expect(() => resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, cutterTipRadius: maximum * 1.0001 }, {})).toThrow(/tip radius/);
    expect(() => resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, cutterTipRadius: .0029 }, {})).toThrow(/tip radius/);
    expect(() => resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, cutterTipRadius: .3 }, {})).toThrow(/non-undercut/);
    const small = resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, cutterTipRadius: .3, profileShift: .14 }, {});
    expect(small.minimumShift).toBeGreaterThan(.1);
    expect(small.cutterTipRadius).toBe(.3);
  });
  it('clamps an accepted numerical undercut-threshold residue to the nonnegative involute branch', () => {
    const alpha = Math.PI / 9, R = 9, coefficient = .1;
    const shift = 1.25 - R * Math.sin(alpha) ** 2 - coefficient * (1 - Math.sin(alpha)) - 1e-11 * R * Math.cos(alpha) * Math.sin(alpha);
    const geometry = resolveConfiguredCadGear({ ...DEFAULT_CAD_GEAR, cutterTipRadius: .3, profileShift: shift }, {});
    expect(geometry.flankParameters[0]).toBe(0);
    expect(geometry.flankInterval[0]).toBe(0);
    const firstFlank = geometry.segments[geometry.rootSteps];
    if (firstFlank.kind !== 'line') throw new Error('Expected flank chord');
    expect(firstFlank.start).toEqual(geometry.flankPoint(0));
    expect(distance(ends(geometry.segments[geometry.rootSteps - 1])[1], firstFlank.start)).toBe(0);
  });
  it('fits the 50-tooth module-3 extrusion by using certified chord spans without relaxing accuracy', () => {
    const gear = resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, teeth: 50 }, {});
    expect(gear.tolerance).toBe(.005);
    expect(gear.edgeCount).toBeLessThanOrEqual(2497); // Bore and cap topology reserve.
    expect(gear.rootSteps).toBeLessThan(14); // Earlier dyadic spans exceeded the body cap.
  });
  it.each(fixtures)('bounds both curves against independent source samples (m=$module, z=$teeth, shift=$profileShift)', profile => {
    const result = resolveGeneratedCadGear(profile, {}), source = sourceCurves(profile);
    expect(result.cutterTipRadius).toBeCloseTo(source.cutterTipRadius, 12);
    const rootParameter = (point: Point) => {
      // Adaptive chord parameters recovered independently from monotone exact curve radius.
      const target = norm(point);
      let low = 0, high = 1;
      for (let i = 0; i < 60; i++) {
        const u = (low + high) / 2, radius = norm(source.trochoid(source.phiMax + u * (source.phiMin - source.phiMax)));
        if (radius < target) low = u; else high = u;
      }
      return source.phiMax + (low + high) / 2 * (source.phiMin - source.phiMax);
    };
    const curves = [
      { lines: result.segments.slice(0, result.rootSteps), start: source.phiMax, end: source.phiMin, at: source.trochoid },
      { lines: result.segments.slice(result.rootSteps, result.rootSteps + result.flankSteps), start: source.psiMin, end: source.psiMax, at: source.involute },
    ];
    for (const curve of curves) curve.lines.forEach((segment, index) => {
      if (segment.kind !== 'line') throw new Error('Expected curve chord');
      const from = curve.at === source.trochoid ? (index === 0 ? source.phiMax : rootParameter(segment.start)) : curve.start + (curve.end - curve.start) * index / curve.lines.length;
      const to = curve.at === source.trochoid ? (index === curve.lines.length - 1 ? source.phiMin : rootParameter(segment.end)) : curve.start + (curve.end - curve.start) * (index + 1) / curve.lines.length;
      expect(distance(segment.start, curve.at(from))).toBeLessThan(1e-8);
      expect(distance(segment.end, curve.at(to))).toBeLessThan(1e-8);
      for (let sample = 0; sample <= 25; sample++) {
        const u = sample / 25, t = from + (to - from) * u;
        expect(distance(curve.at(t), mix(segment.start, segment.end, u))).toBeLessThanOrEqual(result.tolerance * (1 + 1e-8));
      }
    });
  });

  it.each(fixtures)('has a closed positively traversed boundary without folds or tooth overlap (m=$module, z=$teeth)', profile => {
    const result = resolveGeneratedCadGear(profile, {});
    expect(result.edgeCount).toBe(result.segments.length);
    expect(result.edgeCount).toBeLessThanOrEqual(8192);
    const arcs = result.segments.filter(segment => segment.kind === 'arc');
    expect(arcs).toHaveLength(2 * Number(profile.teeth));
    for (let i = 0; i < result.segments.length; i++) {
      const [start, end] = ends(result.segments[i]), next = ends(result.segments[(i + 1) % result.segments.length])[0];
      expect(distance(end, next)).toBeLessThan(1e-8);
      // Every curve stays within one tooth wedge; increasing polar angle prevents crossings.
      expect(start[0] * end[1] - start[1] * end[0]).toBeGreaterThan(0);
      expect(norm(start)).toBeGreaterThanOrEqual(result.rootDiameter / 2 - 1e-8);
      expect(norm(start)).toBeLessThanOrEqual(result.tipDiameter / 2 + 1e-8);
    }
  });

  it('joins the continuous trochoid tangentially to root circle and involute', () => {
    for (const profile of fixtures.slice(0, -2)) {
      const source = sourceCurves(profile), delta = 1e-6;
      const root = source.trochoid(source.phiMax), join = source.trochoid(source.phiMin);
      expect(distance(join, source.involute(source.psiMin))).toBeLessThan(1e-10);
      const tangent = (at: (t: number) => Point, t: number, direction: number): Point => {
        const a = at(t - delta), b = at(t + delta), n = distance(a, b);
        return [direction * (b[0] - a[0]) / n, direction * (b[1] - a[1]) / n];
      };
      const rt = tangent(source.trochoid, source.phiMax, -1), jt = tangent(source.trochoid, source.phiMin, -1), it = tangent(source.involute, source.psiMin, 1);
      expect(Math.abs((root[0] * rt[0] + root[1] * rt[1]) / norm(root))).toBeLessThan(1e-8);
      expect(jt[0] * it[0] + jt[1] * it[1]).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('reduces pitch-circle tooth thickness by precisely the requested per-gear thinning', () => {
    for (const shift of [0, .3]) {
      const profile = { ...DEFAULT_CAD_GEAR, profileShift: shift, backlash: .2 }, result = resolveGeneratedCadGear(profile, {}), source = sourceCurves(profile);
      const point = source.involute(Math.tan(Math.PI / 9));
      const pitchThickness = -2 * 27 * Math.atan2(point[1], point[0]);
      expect(pitchThickness).toBeCloseTo(3 * (Math.PI / 2 + 2 * shift * Math.tan(Math.PI / 9)) - .2, 12);
      expect(result.toothThickness).toBeCloseTo(pitchThickness, 12);
    }
  });

  it('preserves every boundary point under module scaling, translation and rotation', () => {
    const original = resolveGeneratedCadGear(DEFAULT_CAD_GEAR, {});
    const scaled = resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, module: 6, tolerance: .01, x: 17, y: -8, angle: 37 }, {});
    expect(scaled.segments).toHaveLength(original.segments.length);
    const a = 37 * Math.PI / 180;
    original.segments.forEach((segment, index) => ends(segment).forEach((point, end) => {
      const expected: Point = [17 + 2 * (point[0] * Math.cos(a) - point[1] * Math.sin(a)), -8 + 2 * (point[0] * Math.sin(a) + point[1] * Math.cos(a))];
      expect(distance(expected, ends(scaled.segments[index])[end])).toBeLessThan(1e-10);
    }));
  });

  it.each([{ teeth: 18, pressureAngle: 14.5 }, { teeth: 12, pressureAngle: 25 }, { teeth: 12, pressureAngle: 30 }])('uses the actual capped cutter radius for the undercut threshold ($pressureAngle degrees)', settings => {
    const profile = { ...DEFAULT_CAD_GEAR, ...settings }, minShift = sourceCurves(profile).minimumShift;
    expect(() => resolveGeneratedCadGear({ ...profile, profileShift: minShift - 1e-8 }, {})).toThrow(/undercut/);
    expect(resolveGeneratedCadGear({ ...profile, profileShift: minShift + 1e-8 }, {}).minimumShift).toBeCloseTo(minShift, 12);
  });

  it('rejects undercut, insufficient tip material, unsupported root overlap and unbounded chord budgets', () => {
    const minShift = 1 - 6 * Math.sin(Math.PI / 9) ** 2;
    expect(() => resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, teeth: 12, profileShift: minShift - 1e-8 }, {})).toThrow(/undercut/);
    expect(resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, teeth: 12, profileShift: minShift + 1e-8 }, {}).minimumShift).toBeCloseTo(minShift, 12);
    expect(() => resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, backlash: 2 }, {})).toThrow(/tips|thickness/);
    expect(() => resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, teeth: 300, module: 50, tolerance: .00001 }, {})).toThrow(/budget/);
    expect(() => resolveGeneratedCadGear({ ...DEFAULT_CAD_GEAR, teeth: 55, profileShift: .9 }, {})).toThrow(/root|clearance|overlap/);
  });
});
