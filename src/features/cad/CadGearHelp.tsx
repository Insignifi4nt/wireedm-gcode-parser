import { useId, useMemo } from 'react';
import { resolveCadGear } from '@/domain/cad/cadGear';
import { resolveConfiguredCadGear, resolveGeneratedCadGear } from '@/domain/cad/cadGearGenerated';
import type { ResolvedCadPathSegment } from '@/domain/cad/cadAnalyticSegments';
import type { CadPluginProfile } from '@/domain/cad/plugins/cadPlugins';

const help: Readonly<Record<string, readonly [string, string?]>> = {
  module: ['Module sets tooth size in millimetres. With tooth count fixed, increasing module enlarges the pitch circle and the tooth profile. Mating gears need the same module and pressure angle.', 'Pitch diameter = module × teeth'],
  teeth: ['Teeth is a whole number. More teeth at the same module produce a larger gear. Small counts may need positive profile shift to keep the rack from undercutting the involute.', 'Pitch spacing = 360° / teeth'],
  pressureAngle: ['Pressure angle is the angle between the line of action and the tangent to the pitch circle. It sets the base circle that generates the involute flank. It must match the mating gear.', 'Base diameter = pitch diameter × cos(pressure angle)'],
  shiftMode: ['Automatic shift chooses a nonnegative coefficient just above the undercut threshold when needed. Manual mode lets you set it within the current safe range. Switching modes preserves your stored manual value.'],
  profileShift: ['Profile shift offsets the generating rack by coefficient × module. It changes tooth thickness and the outside and root diameters. Automatic mode controls the applied coefficient; manual values must satisfy the current undercut and tip thickness limits.', 'Rack offset = shift coefficient × module'],
  effectiveShift: ['This is the shift coefficient used to generate this profile. It comes from Automatic mode or your valid manual coefficient. The stored manual input is preserved while Automatic is selected.'],
  backlash: ['Tooth thinning removes this much circular tooth thickness from this gear at its reference pitch circle. It does not change module or pitch diameter. The complete gear pair and its centre distance determine mating backlash.', 'Tooth thickness = module × (π/2 + 2 × shift × tan(angle)) − thinning'],
  qualityMode: ['Curve accuracy is the maximum allowed deviation in millimetres between a mathematical curve and its straight chord approximation. Automatic uses the smaller of 0.005 mm and module / 200; Custom uses your specified accuracy. It is not a fixed segment count. Accuracy is never relaxed automatically to fit a solid.'],
  tolerance: ['Smaller accuracy values make the involute flank and rack-generated root transition follow their mathematical curves more closely, using more straight chords. Root-circle and tip-circle arcs remain exact. Involutes and root transitions are not circles, so a single circular arc would change the tooth geometry.', 'Automatic accuracy = min(0.005 mm, module / 200)'],
  effectiveTolerance: ['This is the curve accuracy applied to the profile. Automatic mode calculates it; Custom mode uses your valid input. Smaller tolerances increase geometry and may exceed the native solid budget.'],
  pitchDiameter: ['The pitch circle describes nominal rolling contact between mating gears. Its diameter is calculated from module and tooth count, so it cannot be edited independently.', 'Pitch diameter = module × teeth'],
  tipDiameter: ['The outside circle passes through the tooth tips. Module, count and applied profile shift determine its diameter. It is calculated, not a second independent size input.', 'Outside diameter = module × (teeth + 2 + 2 × shift)'],
  rootDiameter: ['The root circle joins the generated root transitions at the bottom of the tooth spaces. Its radius is different from the generating cutter tip radius.', 'Root diameter = module × (teeth − 2.5 + 2 × shift)'],
  baseDiameter: ['The involute unwinds from this base circle. It depends on pitch diameter and pressure angle. The rounded root meets the involute at the rack-generated tangent point.', 'Base diameter = pitch diameter × cos(pressure angle)'],
  circularPitch: ['Circular pitch is the spacing between neighbouring teeth measured along the reference pitch circle. Module controls it.', 'Circular pitch = π × module'],
  cutterTipRadius: ['This is the radius on the generating rack tool tip. Rolling that rounded tool produces the gear root with changing curvature; it is not a constant-radius fillet on the gear. Module, pressure angle and tooth thinning determine the tool radius.', 'Clearance cap = 0.25 × module / (1 − sin(angle)). Available rack tip width may reduce it, keeping 5% tip land. It cannot be edited independently.'],
  cutterTipMode: ['Automatic chooses the generating rack tip radius from the clearance and available tool-tip width. Custom uses your specified tool radius within those same geometric limits. Switching modes preserves the stored custom value. This controls the rack-generated root transition, not a constant-radius fillet on the gear.'],
  effectiveCutterTipRadius: ['This is the generating tool-tip radius applied to the current gear. Automatic calculates it from module, pressure angle and tooth thinning; Custom uses a valid specified tool radius. The resulting root transition has changing curvature.'],
  tipThickness: ['Tip thickness is the remaining circular tooth thickness at the outside circle. Generation requires at least 0.2 × module to remain. This geometric limit does not certify tooth strength.'],
  x: ['X moves the profile centre along the sketch plane’s horizontal axis. It changes placement without changing tooth dimensions.'],
  y: ['Y moves the profile centre along the sketch plane’s vertical axis. It changes placement without changing tooth dimensions.'],
  angle: ['Rotation turns the complete profile about its centre in the sketch plane. It changes tooth orientation without changing tooth dimensions.'],
};
const display = (value: number | undefined) => Number.isFinite(value) && value !== undefined ? String(Number(value.toFixed(6))) : 'Unavailable';
function pathOf(segments: readonly ResolvedCadPathSegment[]): string {
  const first = segments[0];
  if (!first) return '';
  const start = first.kind === 'line' ? first.start : [first.center[0] + first.radius * Math.cos(first.startAngle * Math.PI / 180), first.center[1] + first.radius * Math.sin(first.startAngle * Math.PI / 180)];
  return `M ${start[0]} ${start[1]} ` + segments.map(segment => {
    if (segment.kind === 'line') return `L ${segment.end[0]} ${segment.end[1]}`;
    const end = (segment.startAngle + segment.sweep) * Math.PI / 180;
    return `A ${segment.radius} ${segment.radius} 0 ${Math.abs(segment.sweep) > 180 ? 1 : 0} ${segment.sweep > 0 ? 1 : 0} ${segment.center[0] + segment.radius * Math.cos(end)} ${segment.center[1] + segment.radius * Math.sin(end)}`;
  }).join(' ');
}

/** Diagram uses the same resolved geometry as CAD, including its root transition. */
export function CadGearHelp({ name, values, profile, label, unit = '' }: {
  name: string; values: Readonly<Record<string, number>>; profile: CadPluginProfile; label: string; unit?: string;
}) {
  const id = useId();
  const hasCustomRoot = profile.package.inputs.some(input => input.name === 'cutterTipMode');
  const resolved = useMemo(() => {
    const numeric = { x: values.x, y: values.y, angle: values.angle, module: values.module, teeth: values.teeth, pressureAngle: values.pressureAngle,
      profileShift: values.effectiveShift ?? values.profileShift, backlash: values.backlash, tolerance: values.effectiveTolerance ?? values.tolerance };
    if (!Object.values(numeric).every(Number.isFinite)) return null;
    try {
      if (profile.package.version === '1.0.0') return { kind: 'legacy' as const, geometry: resolveCadGear(numeric, {}) };
      if (hasCustomRoot && !Number.isFinite(values.effectiveCutterTipRadius)) return null;
      return { kind: 'generated' as const, geometry: hasCustomRoot ? resolveConfiguredCadGear({ ...numeric, cutterTipRadius: values.effectiveCutterTipRadius }, {}) : resolveGeneratedCadGear(numeric, {}) };
    }
    catch { return null; }
  }, [values, profile.package.version, hasCustomRoot]);
  const gear = resolved?.geometry;
  const description = name === 'cutterTipRadius' && hasCustomRoot
    ? ['Set the radius on the nominal generating rack tool tip. Rolling this tool generates the tooth-root transition with changing curvature; it is not a constant-radius fillet on the gear. A smaller tool radius can require more positive shift to avoid undercut.', 'Automatic controls the applied radius. Custom values must fit the current module, pressure angle and rack tip width; these limits and the required shift are recalculated together.']
    : help[name];
  const radiusName = ['pressureAngle', 'baseDiameter'].includes(name) ? 'Base circle' : ['rootDiameter', 'profileShift', 'effectiveShift', 'shiftMode'].includes(name) ? 'Root circle' : name === 'tipDiameter' || name === 'tipThickness' ? 'Outside circle' : 'Pitch circle';
  const radius = gear && (radiusName === 'Base circle' ? gear.baseDiameter : radiusName === 'Root circle' ? gear.rootDiameter : radiusName === 'Outside circle' ? gear.tipDiameter : gear.pitchDiameter) / 2;
  const rootTerm = ['cutterTipRadius', 'effectiveCutterTipRadius', 'cutterTipMode'].includes(name);
  const highlighted = resolved?.kind === 'generated' && rootTerm ? pathOf(resolved.geometry.segments.slice(0, resolved.geometry.rootSteps)) : '';
  const tooth = resolved?.kind === 'generated' && rootTerm ? resolved.geometry.segments.slice(0, 2 * (resolved.geometry.rootSteps + resolved.geometry.flankSteps) + 1) : [];
  const toothPoints = tooth.flatMap(segment => segment.kind === 'line' ? [segment.start, segment.end] : []);
  const toothBounds = toothPoints.length ? {
    minX: Math.min(...toothPoints.map(point => point[0])) - (gear?.module ?? 1) * .2,
    minY: Math.min(...toothPoints.map(point => point[1])) - (gear?.module ?? 1) * .2,
    maxX: Math.max(...toothPoints.map(point => point[0])) + (gear?.module ?? 1) * .2,
    maxY: Math.max(...toothPoints.map(point => point[1])) + (gear?.module ?? 1) * .2,
  } : null;
  const actualName = name === 'profileShift' || name === 'shiftMode' ? 'effectiveShift' : name === 'tolerance' || name === 'qualityMode' ? 'effectiveTolerance' : hasCustomRoot && ['cutterTipRadius', 'cutterTipMode'].includes(name) ? 'effectiveCutterTipRadius' : name;
  const actualUnit = actualName === 'effectiveCutterTipRadius' ? 'mm' : unit;
  return <>
    {description ? <><p>{description[0]}</p>{description[1] && <p>{name === 'cutterTipRadius' ? description[1] : <code>{description[1]}</code>}</p>}</> : <p>This dimension is calculated from the current gear inputs.</p>}
    {name === 'cutterTipRadius' && hasCustomRoot && <p>The minimum of 0.001 × module excludes a sharp tool tip in this model; it is not a manufacturing-standard minimum. The upper limit keeps this full-depth rack’s 1.25 × module tooth depth, 0.25 × module clearance and at least 5% tip land. Special cutters outside these limits need a different model.</p>}
    {gear && !['x', 'y', 'angle', 'shiftMode', 'qualityMode'].includes(name) && <figure className="cad-gear-help-diagram">
      <svg viewBox={rootTerm && toothBounds ? `${toothBounds.minX} ${toothBounds.minY} ${toothBounds.maxX - toothBounds.minX} ${toothBounds.maxY - toothBounds.minY}` : `${-gear.tipDiameter * .55} ${-gear.tipDiameter * .55} ${gear.tipDiameter * 1.1} ${gear.tipDiameter * 1.1}`} role="img" aria-labelledby={id}>
        <title id={id}>{rootTerm ? 'Actual rack-generated root transition highlighted on the current gear' : `${radiusName} on the current ${gear.teeth}-tooth gear`}</title>
        <g transform={rootTerm ? undefined : `translate(${-values.x} ${-values.y})`}><path d={rootTerm ? pathOf(tooth) : pathOf(gear.segments) + ' Z'} fill={rootTerm ? 'none' : '#203b48'} stroke="#728f9f" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          {highlighted && <path d={highlighted} fill="none" stroke="#f1bf72" strokeWidth="3" vectorEffect="non-scaling-stroke" />}
          {!rootTerm && radius && <circle cx={values.x} cy={values.y} r={radius} fill="none" stroke="#7bcce4" strokeWidth="1.3" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
        </g>
      </svg>
      <figcaption><i className="cad-gear-help-legend" style={rootTerm ? { background: '#f1bf72' } : undefined} />{rootTerm ? 'Rack-generated root transition, not a circular fillet' : `${radiusName} · Ø ${display(radius ? 2 * radius : undefined)} mm`}</figcaption>
    </figure>}
    {values[actualName] !== undefined && <div className="cad-context-help-value"><span>{actualName !== name ? 'Applied value' : label}</span><output>{display(values[actualName])}{actualUnit && ` ${actualUnit}`}</output></div>}
    {profile.package.version === '1.0.0' && ['cutterTipRadius', 'rootDiameter', 'profileShift'].includes(name) && <p>This legacy profile has straight root extensions. Upgrading to rounded roots explicitly rebuilds the profile.</p>}
  </>;
}
