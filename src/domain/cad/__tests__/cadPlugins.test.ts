import { describe, expect, it, vi } from 'vitest';
import { CAD_GEAR_PLUGIN, CAD_GEAR_V3_PLUGIN, CAD_STAR_PLUGIN, createCadPluginProfile, parseCadPluginPackage, resolveCadPluginProfile } from '../plugins/cadPlugins';
import * as generatedGear from '../cadGearGenerated';
import { createCadDocument, parseCadDocument } from '../cadSchema';
import { measureCadSketch } from '../cadMeasurements';
import { cadSketchToCam } from '../cadCam';
import { parsePortableUpid } from '@/domain/upid/portableUpidProject';
import { CadSession } from '@/features/cad/cadSession';
import { resolveCadGear, DEFAULT_CAD_GEAR } from '../cadGear';
import { evaluateCadRecipeScalar, evaluateCadScalar } from '../cadExpression';

function part() {
  return parseCadDocument({ ...createCadDocument('Module 3 gear', 'gear_plugin_test'), parameters: { module: 3, teeth: 18, bore: 12, thickness: 10 }, features: [
    { id: 'gear_sketch', name: 'Gear', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [
      { id: 'gear', name: 'Spur gear', construction: false, geometry: { ...createCadPluginProfile(CAD_GEAR_PLUGIN), inputs: { ...createCadPluginProfile(CAD_GEAR_PLUGIN).inputs, module: 'module', teeth: 'teeth' } } },
      { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 'bore / 2' } }
    ] }, { id: 'gear_pad', name: 'Gear body', kind: 'extrude', suppressed: false, sketchId: 'gear_sketch', distance: 'thickness', symmetric: false, operation: 'new', targetId: null }
  ] });
}
describe('CAD plugin profiles', () => {
  it('builds expensive generated geometry once per resolution and keeps geometry-budget failures atomic', () => {
    const profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
    const generate = vi.spyOn(generatedGear, 'resolveConfiguredCadGear');
    try {
      const resolved = resolveCadPluginProfile(profile, {});
      if (resolved.kind !== 'path') throw new Error('Expected generated gear path');
      expect(resolved.segments).toHaveLength(864);
      expect(generate).toHaveBeenCalledTimes(1);
      generate.mockClear();
      const invalid = { ...profile, inputs: { ...profile.inputs, teeth: 300 } };
      const before = JSON.stringify(invalid);
      expect(() => resolveCadPluginProfile(invalid, {})).toThrow(/budget/);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(invalid)).toBe(before);
    } finally { generate.mockRestore(); }
  });
  it('generates module-3 dimensions and exactly one root/tip arc per tooth', () => {
    const result = resolveCadGear(DEFAULT_CAD_GEAR, {});
    expect(result).toMatchObject({ pitchDiameter: 54, tipDiameter: 60, rootDiameter: 46.5, teeth: 18 });
    expect(result.toothThickness).toBeCloseTo(3 * Math.PI / 2, 12);
    expect(result.segments.filter(segment => segment.kind === 'arc')).toHaveLength(36);
    expect(result.edgeCount).toBe(result.segments.length);
  });
  it('rebuilds topology from named parameters, retains the package and supports undo', () => {
    const doc = part(), session = new CadSession(doc);
    const before = measureCadSketch(doc, 'gear_sketch');
    session.edit([{ kind: 'set-parameter', name: 'module', value: 4 }, { kind: 'set-parameter', name: 'teeth', value: 36 }]);
    const after = measureCadSketch(session.getSnapshot().document, 'gear_sketch');
    expect(after.materialAreaMm2).toBeGreaterThan(before.materialAreaMm2 * 4);
    expect(after.cutContourCount).toBe(2);
    session.undo(); expect(session.getSnapshot().document).toEqual(doc);
    const cam = cadSketchToCam(doc, 'gear_sketch');
    expect(cam.contours).toHaveLength(2); expect(cam.contours.every(contour => contour.closed)).toBe(true);
    expect(cam.diagnostics).toContainEqual(expect.objectContaining({ severity: 'warning', message: expect.stringContaining('trochoids') }));
    expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: cam.schemaVersion, document: cam }))).toMatchObject({ ok: true });
  });
  it.each([12, 16, 18.5, 301])('rejects unsupported or undercut tooth counts %s', teeth => {
    expect(() => resolveCadGear({ ...DEFAULT_CAD_GEAR, teeth }, {})).toThrow();
  });
  it('allows a 12-tooth shifted gear and rejects pointed tips or an excessive budget', () => {
    expect(resolveCadGear({ ...DEFAULT_CAD_GEAR, teeth: 12, profileShift: 0.4 }, {}).teeth).toBe(12);
    expect(() => resolveCadGear({ ...DEFAULT_CAD_GEAR, teeth: 12, profileShift: 1 }, {})).toThrow();
    expect(() => resolveCadGear({ ...DEFAULT_CAD_GEAR, teeth: 300, module: 50, tolerance: 0.00001 }, {})).toThrow(/budget/);
  });
  it('bounds each involute chord against a dense independent exact-curve sample', () => {
    const gear = resolveCadGear(DEFAULT_CAD_GEAR, {}), rb = 27 * Math.cos(Math.PI / 9);
    const half = Math.PI / 36 + Math.tan(Math.PI / 9) - Math.PI / 9;
    const lines = gear.segments.slice(1, gear.segments.findIndex(segment => segment.kind === 'arc'));
    const endT = Math.sqrt((30 / rb) ** 2 - 1);
    lines.forEach((line, i) => {
      if (line.kind !== 'line') throw new Error('Expected flank line');
      for (let sample = 0; sample <= 20; sample++) {
        const u = sample / 20, t = endT * (i + u) / lines.length;
        const a = -half + t - Math.atan(t), r = rb * Math.sqrt(1 + t * t);
        const px = line.start[0] * (1 - u) + line.end[0] * u, py = line.start[1] * (1 - u) + line.end[1] * u;
        expect(Math.hypot(r * Math.cos(a) - px, r * Math.sin(a) - py)).toBeLessThanOrEqual(0.005);
      }
    });
  });
  it('loads a second recipe without adding a native CAD kind or executing code', () => {
    const result = resolveCadPluginProfile(createCadPluginProfile(CAD_STAR_PLUGIN), {});
    expect(result.kind === 'polygon' && result.points.length).toBe(16);
    expect(parseCadPluginPackage({ ...CAD_STAR_PLUGIN, version: '2.0.0' }).version).toBe('2.0.0');
    expect(() => evaluateCadRecipeScalar('fetch(1)', {})).toThrow();
    expect(() => evaluateCadRecipeScalar('constructor.constructor(1)', {})).toThrow();
    expect(() => evaluateCadScalar('sin(1)', {})).toThrow();
    expect(evaluateCadRecipeScalar('sqrt(4) + cos(pi)', { pi: Math.PI })).toBe(1);
  });
  it('rejects changed built-in definitions, reserved names and invalid saved input sets', () => {
    expect(() => parseCadPluginPackage({ ...CAD_GEAR_PLUGIN, version: '2.0.0' })).toThrow();
    expect(() => parseCadPluginPackage({ ...CAD_STAR_PLUGIN, id: 'con' })).toThrow(/portable/);
    expect(() => parseCadPluginPackage({ ...CAD_STAR_PLUGIN, inputs: [...CAD_STAR_PLUGIN.inputs, CAD_STAR_PLUGIN.inputs[0]] })).toThrow();
    expect(() => resolveCadPluginProfile({ ...createCadPluginProfile(CAD_GEAR_PLUGIN), inputs: {} }, {})).toThrow();
    expect(() => parseCadDocument({ ...part(), parameters: { module: 3, teeth: 12, bore: 12, thickness: 10 } })).toThrow(/undercut/);
  });
});
