import { resolveCadGear, resolveCadGearMetrics, type CadGearProfile } from './cadGear';
import type { ResolvedCadPathSegment } from './cadAnalyticSegments';
import { evaluateCadScalar } from './cadExpression';
import { CadError } from './cadError';
import type { CadScalar } from './cadDocument';
import { CAD_PRECISION } from '../precision/cadPrecision';

export const GENERATED_GEAR_NOTE = 'Full-depth rack-generated external spur gear. Cutter tip radius is derived from clearance and available rack tip width. Involute and trochoidal root curves are chorded within the specified tolerance; root and tip circles are exact. Tooth thinning applies to this gear only. This is nominal geometry, not a strength, load or gear-pair clearance certification.';

export function generatedGearRackTipCoefficient(alpha: number, thinningPerModule: number) {
  const h = Math.PI / 4 - thinningPerModule / 2;
  // Keep 5% of the possible rack tip land when the clearance-based rounding would overlap.
  return Math.min(0.25 / (1 - Math.sin(alpha)), 0.95 * (Math.PI / 2 - h - 1.25 * Math.tan(alpha)) / (1 / Math.cos(alpha) - Math.tan(alpha)));
}

/** Rolling-rack envelope, Douglas Wright, DANotes Appendix B equations (i), (v), (viii), (x), (xi).
 * Coefficients use unit module; backlash widens the rack tooth by half the specified thinning.
 * No undercut intersection solver: reject undercut, pointed/thin tips and overlapping roots.
 */
export function resolveGeneratedCadGear(profile: CadGearProfile, parameters: Readonly<Record<string, number>>) {
  return resolveRackGeneratedGear(profile, parameters);
}

export interface CadConfiguredGearProfile extends CadGearProfile { readonly cutterTipRadius: CadScalar }
export const CONFIGURED_GEAR_NOTE = 'Full-depth rack-generated external spur gear with a configurable symmetric generating cutter tip radius. Clearance and positive rack tip land bound the cutter radius; profile shift prevents undercut. Involute and rack-generated root transitions are chorded within the specified maximum geometric deviation; root and tip circles are exact. The root transition has varying curvature, not a constant gear fillet radius. Tooth thinning applies to this gear only. Nominal geometry, not a strength, load or gear-pair clearance certification.';

/** V3 is explicitly pinned separately: V2's package and sampled geometry remain unchanged. */
export function resolveConfiguredCadGear(profile: CadConfiguredGearProfile, parameters: Readonly<Record<string, number>>) {
  return resolveRackGeneratedGear(profile, parameters, profile.cutterTipRadius);
}

function resolveRackGeneratedGear(profile: CadGearProfile, parameters: Readonly<Record<string, number>>, cutterTipRadius?: CadScalar) {
  const configured = cutterTipRadius !== undefined;
  const legacy = configured ? resolveCadGearMetrics(profile, parameters) : resolveCadGear(profile, parameters);
  const m = legacy.module, z = legacy.teeth, R = z / 2;
  const a = evaluateCadScalar(profile.pressureAngle, parameters) * Math.PI / 180;
  const shift = evaluateCadScalar(profile.profileShift, parameters), backlash = evaluateCadScalar(profile.backlash, parameters);
  const x = evaluateCadScalar(profile.x, parameters), y = evaluateCadScalar(profile.y, parameters), rotation = evaluateCadScalar(profile.angle, parameters) % 360 * Math.PI / 180;
  const maximumTipCoefficient = generatedGearRackTipCoefficient(a, backlash / m);
  const requestedTipRadius = configured ? evaluateCadScalar(cutterTipRadius, parameters) : m * maximumTipCoefficient;
  const e = configured ? requestedTipRadius / m : maximumTipCoefficient, b = 1.25, h = Math.PI / 4 - backlash / (2 * m);
  if (configured && (requestedTipRadius < 0.001 * m || requestedTipRadius > m * maximumTipCoefficient)) throw new CadError('invalid-gear', 'Cutter tip radius must be between 0.001 × module and the clearance/positive rack-tip-land limit.');
  const rb = R * Math.cos(a), rf = R + shift - b, ra = R + shift + 1;
  const gamma = (h + shift * Math.tan(a)) / R + Math.tan(a) - a;
  const t0 = Math.tan(a) + (shift + e * (1 - Math.sin(a)) - b) / (rb * Math.sin(a));
  const t1 = Math.sqrt((ra / rb) ** 2 - 1), tipHalf = gamma - t1 + Math.atan(t1);
  if (t0 < -CAD_PRECISION.gearParameterSlackRad || t0 >= t1 || 2 * ra * tipHalf < 0.2) throw new CadError('invalid-gear', 'Generated gear needs a non-undercut flank and tip thickness of at least 0.2 × module. Adjust teeth, shift or backlash.');
  const vc = e - b, uc = h + e / Math.cos(a) - vc * Math.tan(a), D = shift + vc;
  const phi0 = -uc / R, phi1 = Math.max(0, t0) - a - gamma;
  if (!(e > 0 && D < -0.05 && phi1 < phi0 && -phi0 < Math.PI / z)) throw new CadError('invalid-gear', 'Rack root transitions overlap or have unsupported cutter clearance. Adjust pressure angle, tooth thinning or profile shift.');
  const root = (phi: number): readonly [number, number] => {
    const A = R * phi + uc, lambda = 1 + e / Math.hypot(A, D);
    return [m * (lambda * A * Math.sin(phi) + (R + lambda * D) * Math.cos(phi)),
      m * (-lambda * A * Math.cos(phi) + (R + lambda * D) * Math.sin(phi))];
  };
  const flank = (t: number): readonly [number, number] => {
    const angle = -gamma + t - Math.atan(t), radius = m * rb * Math.sqrt(1 + t * t);
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  };
  // P = Rot(phi)(A, R+D) + e Rot(phi)(A,D)/hypot(A,D).
  // Local exact normal-derivative bounds retain curvature without oversampling
  // intervals just because dyadic subdivision halves a nearly sufficient chord.
  // Linear interpolation error <= sup|P''| Δphi²/8, independent of sampling.
  const rootPoints: (readonly [number, number])[] = [root(phi0)];
  function rootChordErrorBound(from: number, to: number) {
    const Afrom = R * from + uc, Ato = R * to + uc, Amax = Math.max(Math.abs(Afrom), Math.abs(Ato));
    const Amin = Afrom * Ato <= 0 ? 0 : Math.min(Math.abs(Afrom), Math.abs(Ato));
    const lengthSquared = Amin * Amin + D * D;
    let second = m * (Math.hypot(Amax, R - D) + e * (1 + 2 * R * Math.abs(D) / lengthSquared + R * R * Math.abs(D) * Math.sqrt(4 * Amin * Amin + D * D) / (lengthSquared * lengthSquared)));
    if (configured) {
      // Exact P'' = Rot(phi)(Tx,Ty). Enclose its signed components, retaining
      // cancellation that the V2 triangle bound discards. D<0 throughout.
      const qMin = lengthSquared, qMax = Amax * Amax + D * D;
      const nMin = D * D - 2 * Amax * Amax, nMax = D * D - 2 * Amin * Amin;
      const ratioMin = nMin / (nMin < 0 ? qMin : qMax) ** 2.5;
      const ratioMax = nMax / (nMax > 0 ? qMin : qMax) ** 2.5;
      const positive = (q: number) => 2 * R * D * D / q ** 1.5 - D / Math.sqrt(q);
      const txMin = R - D + e * (positive(qMax) - D * R * R * ratioMin);
      const txMax = R - D + e * (positive(qMin) - D * R * R * ratioMax);
      const tyMax = Amax * (1 + e * (3 * R * R * D * D / qMin ** 2.5 - 2 * D * R / qMin ** 1.5 + 1 / Math.sqrt(qMin)));
      const intervalBound = m * Math.hypot(Math.max(Math.abs(txMin), Math.abs(txMax)), tyMax);
      // Arithmetic reserve includes cancellation in signed interval endpoints.
      second = Math.min(second, intervalBound + CAD_PRECISION.relativeZero * m * (Math.abs(txMin) + Math.abs(txMax) + tyMax + R + 1));
    }
    return second * (to - from) ** 2 / 8;
  }
  let from = phi0;
  while (from > phi1) {
    if (rootPoints.length > 4096) throw new CadError('invalid-gear', 'Root envelope exceeds the curve approximation budget. Increase tolerance.');
    let to = phi1;
    if (rootChordErrorBound(from, to) > legacy.tolerance) {
      // Pick a certified safe span instead of rounding every span down to the
      // next dyadic size. No sample-only error test or tolerance relaxation.
      let unsafe = to, safe = from;
      for (let iteration = 0; iteration < 32; iteration++) {
        const candidate = (unsafe + safe) / 2;
        if (rootChordErrorBound(from, candidate) <= legacy.tolerance) safe = candidate;
        else unsafe = candidate;
      }
      to = safe;
    }
    if (to === from) throw new CadError('invalid-gear', 'Root approximation cannot progress at modeling precision. Increase tolerance.');
    rootPoints.push(root(to)); from = to;
  }
  const rootSteps = rootPoints.length - 1;
  const legacyFlankSteps = Math.max(2, Math.ceil((t1 - t0) * Math.sqrt(m * rb * Math.sqrt(1 + t1 * t1) / (8 * legacy.tolerance))));
  const flankParameters = configured ? certifiedFlankParameters(Math.max(0, t0), t1, m * rb, legacy.tolerance)
    : Array.from({ length: legacyFlankSteps + 1 }, (_, i) => t0 + (t1 - t0) * i / legacyFlankSteps);
  const flankSteps = flankParameters.length - 1;
  const edgeCount = z * (2 * rootSteps + 2 * flankSteps + 2);
  if (edgeCount > 8192) throw new CadError('invalid-gear', `Generated gear needs ${edgeCount} edges, exceeding the 8192-edge budget. Increase curve tolerance or reduce module/tooth count.`);
  const join = root(phi1), start = flank(Math.max(0, t0));
  if (Math.hypot(join[0] - start[0], join[1] - start[1]) > m * CAD_PRECISION.gearJoinPerModule) throw new CadError('invalid-gear', 'Rack envelope and involute do not meet within modeling precision.');
  rootPoints[rootPoints.length - 1] = start;
  const flankPoints = flankParameters.map(flank);
  const segments: ResolvedCadPathSegment[] = [];
  const placed = (point: readonly [number, number], center: number, upper: boolean): readonly [number, number] => {
    const py = upper ? -point[1] : point[1];
    return [x + point[0] * Math.cos(center) - py * Math.sin(center), y + point[0] * Math.sin(center) + py * Math.cos(center)];
  };
  const lines = (points: readonly (readonly [number, number])[], center: number, upper: boolean) => {
    for (let i = 0; i < points.length - 1; i++) segments.push({ kind: 'line', start: placed(points[i], center, upper), end: placed(points[i + 1], center, upper) });
  };
  for (let tooth = 0; tooth < z; tooth++) {
    const center = rotation + tooth * 2 * Math.PI / z;
    lines(rootPoints, center, false); lines(flankPoints, center, false);
    segments.push({ kind: 'arc', center: [x, y], radius: m * ra, startAngle: (center - tipHalf) * 180 / Math.PI, sweep: 2 * tipHalf * 180 / Math.PI });
    lines([...flankPoints].reverse(), center, true); lines([...rootPoints].reverse(), center, true);
    segments.push({ kind: 'arc', center: [x, y], radius: m * rf, startAngle: (center - phi0) * 180 / Math.PI, sweep: (2 * Math.PI / z + 2 * phi0) * 180 / Math.PI });
  }
  return { ...legacy, segments, edgeCount, rootSteps, flankSteps, cutterTipRadius: m * e, minimumShift: b - R * Math.sin(a) ** 2 - e * (1 - Math.sin(a)), tipThickness: 2 * m * ra * tipHalf,
    rootPoint: root, flankPoint: flank, rootInterval: [phi0, phi1] as const, flankInterval: [configured ? Math.max(0, t0) : t0, t1] as const, flankParameters };
}

/** Involute P'=rb*t*Rot(t-gamma)(1,0). Its tangent turns monotonically by Δt.
 * If Δt<π/2, projection onto the chord is monotone and stays inside its endpoints.
 * Thus distance to the finite chord is its normal component. For the chord normal n,
 * |n·P''| <= rb*(sin(Δt)+t_max), giving max distance <= this bound*Δt²/8.
 * This is a continuous analytic certificate, not a midpoint/sample acceptance test.
 */
function certifiedFlankParameters(start: number, end: number, baseRadius: number, tolerance: number): number[] {
  const parameters = [start];
  const bound = (from: number, to: number) => {
    const delta = to - from;
    const vectorBound = Math.sqrt(1 + to * to);
    const normalBound = delta < Math.PI / 2 ? Math.sin(delta) + to : vectorBound;
    return baseRadius * Math.min(vectorBound, normalBound) * delta * delta / 8 * (1 + CAD_PRECISION.relativeZero);
  };
  let from = start;
  while (from < end) {
    if (parameters.length > 4096) throw new CadError('invalid-gear', 'Involute exceeds the curve approximation budget. Increase tolerance.');
    let to = end;
    if (bound(from, to) > tolerance) {
      let unsafe = to, safe = from;
      for (let iteration = 0; iteration < 32; iteration++) {
        const candidate = (unsafe + safe) / 2;
        if (bound(from, candidate) <= tolerance) safe = candidate; else unsafe = candidate;
      }
      to = safe;
    }
    if (to === from) throw new CadError('invalid-gear', 'Involute approximation cannot progress at modeling precision. Increase tolerance.');
    parameters.push(to); from = to;
  }
  return parameters;
}
