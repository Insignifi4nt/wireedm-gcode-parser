import { useMemo } from 'react';
import { inspectCadPluginProfile, type CadPluginProfile } from '@/domain/cad/plugins/cadPlugins';
import { resolveConfiguredCadGear, resolveGeneratedCadGear } from '@/domain/cad/cadGearGenerated';
import { CadPathSegmentGeometry } from './CadPathDraftGeometry';

/** Show the same numeric geometry as the profile, without changing its parameters. */
export function CadGearInspectionOverlay({ profile, parameters, inputName, span, viewCenter = [0, 0] }: {
  profile: CadPluginProfile; parameters: Readonly<Record<string, number>>; inputName: string; span: number; viewCenter?: readonly [number, number];
}) {
  const model = useMemo(() => {
    if (profile.package.generator.kind !== 'builtin' || !['wireedm.spur-gear.v2', 'wireedm.spur-gear.v3'].includes(profile.package.generator.implementation)) return null;
    try {
      const inspection = inspectCadPluginProfile(profile, parameters);
      if (inspection.issues.length) return null;
      const v = inspection.values;
      const numeric = { x: v.x, y: v.y, angle: v.angle, module: v.module, teeth: v.teeth,
        pressureAngle: v.pressureAngle, profileShift: v.effectiveShift, backlash: v.backlash, tolerance: v.effectiveTolerance };
      return { values: v, gear: profile.package.generator.implementation === 'wireedm.spur-gear.v3'
        ? resolveConfiguredCadGear({ ...numeric, cutterTipRadius: v.effectiveCutterTipRadius }, {})
        : resolveGeneratedCadGear(numeric, {}) };
    } catch { return null; }
  }, [profile, parameters]);
  if (!model) return null;
  const { values: v, gear } = model;
  const circles = inputName === 'pressureAngle' || inputName === 'baseDiameter' ? [['Base circle', v.baseDiameter]]
    : ['shiftMode', 'profileShift', 'effectiveShift', 'rootDiameter'].includes(inputName) ? [['Root circle', v.rootDiameter], ['Outside circle', v.tipDiameter]]
      : ['module', 'teeth', 'pitchDiameter', 'circularPitch'].includes(inputName) ? [['Pitch circle', v.pitchDiameter], ['Outside circle', v.tipDiameter]]
        : inputName === 'tipDiameter' ? [['Outside circle', v.tipDiameter]] : [];
  const rootOnly = ['cutterTipRadius', 'cutterTipMode', 'effectiveCutterTipRadius'].includes(inputName);
  const tooth = ['pressureAngle', 'backlash', 'tipThickness', 'tolerance', 'qualityMode', 'effectiveTolerance'].includes(inputName);
  const segments = rootOnly ? gear.segments.slice(0, gear.rootSteps)
    : tooth ? gear.segments.slice(0, 2 * (gear.rootSteps + gear.flankSteps) + 1) : [];
  const placement = ['x', 'y', 'angle'].includes(inputName);
  const origin = [v.x, v.y] as const;
  return <g className="cad-gear-inspection" transform={`translate(${v.x - viewCenter[0]},${v.y - viewCenter[1]})`} data-cad-gear-inspection={inputName} role="img" aria-label={`Geometry affected by ${inputName}`} pointerEvents="none" strokeWidth={span / 320}>
    {circles.map(([label, diameter]) => typeof diameter === 'number' && <circle key={label} aria-label={String(label)} cx={0} cy={0} r={diameter / 2} strokeDasharray={`${span / 70} ${span / 140}`} />)}
    {segments.map((segment, index) => <CadPathSegmentGeometry key={index} segment={segment} origin={origin} />)}
    {['tolerance', 'qualityMode', 'effectiveTolerance'].includes(inputName) && segments.filter(segment => segment.kind === 'line').map((segment, index) => segment.kind === 'line' && <circle key={`sample-${index}`} cx={segment.start[0] - v.x} cy={segment.start[1] - v.y} r={span / 230} className="cad-gear-inspection-sample" />)}
    {placement && <g transform={`rotate(${v.angle})`}><path d={`M ${-span / 50} 0 H ${v.tipDiameter / 2} M 0 ${-span / 50} V ${span / 50}`} /><circle r={span / 100} /></g>}
  </g>;
}
