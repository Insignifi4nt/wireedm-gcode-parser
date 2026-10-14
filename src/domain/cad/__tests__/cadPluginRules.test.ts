import { describe, expect, it } from 'vitest';
import { CAD_GEAR_PLUGIN, CAD_GEAR_V2_PLUGIN, CAD_GEAR_V3_PLUGIN, CAD_STAR_PLUGIN, createCadPluginProfile, inspectCadPluginProfile, parseCadPluginPackage, resolveCadPluginProfile, type CadPluginPackage, type CadPluginProfile } from '../plugins/cadPlugins';
import { evaluateCadRecipeScalar } from '../cadExpression';
import { CadSession } from '@/features/cad/cadSession';
import { createCadDocument, parseCadDocument } from '../cadSchema';

const linked: CadPluginPackage = { ...CAD_STAR_PLUGIN, id: 'user.linked-star', apiVersion: 2,
  rules: {
    derived: [{ name: 'diameter', label: 'Outer diameter', unit: 'mm', expression: 'outerRadius * 2' }, { name: 'halfDiameter', label: 'Radius from diameter', unit: 'mm', expression: 'diameter / 2' }],
    fields: CAD_STAR_PLUGIN.inputs.map(input => ({ name: input.name, group: 'main', minimum: input.minimum, maximum: input.name === 'innerRadius' ? 'halfDiameter - 0.001' : input.maximum })),
    constraints: [{ left: 'innerRadius', operator: 'lt', right: 'outerRadius', message: 'Inner radius must remain smaller than outer radius.' }]
  }
};
describe('Correlated plugin inputs', () => {
  it('correlates custom cutter radius, clearance limits and automatic/manual undercut shift in a new pinned gear package', () => {
    const profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
    const dormant = inspectCadPluginProfile({ ...profile, inputs: { ...profile.inputs, cutterTipRadius: 50 } }, {});
    expect(dormant.issues).toEqual([]);
    expect(dormant.fields.find(field => field.name === 'cutterTipRadius')?.enabled).toBe(false);
    expect(dormant.values.effectiveCutterTipRadius).toBeCloseTo(3 * .25 / (1 - Math.sin(Math.PI / 9)), 12);
    const custom = { ...profile, inputs: { ...profile.inputs, cutterTipMode: 1, cutterTipRadius: .3 } };
    const inspection = inspectCadPluginProfile(custom, {});
    expect(inspection.issues).toEqual([]);
    expect(inspection.fields.find(field => field.name === 'cutterTipRadius')).toMatchObject({ enabled: true, minimum: .003 });
    const expectedMinimum = 1.25 - 9 * Math.sin(Math.PI / 9) ** 2 - .1 * (1 - Math.sin(Math.PI / 9));
    expect(inspection.values.minimumShift).toBeCloseTo(expectedMinimum, 12);
    expect(inspection.values.effectiveShift).toBeCloseTo(expectedMinimum + 1e-8, 12);
    expect(inspection.values.effectiveCutterTipRadius).toBeCloseTo(.3, 12);
    expect(inspectCadPluginProfile({ ...custom, inputs: { ...custom.inputs, shiftMode: 1, profileShift: 0 } }, {}).issues.length).toBeGreaterThan(0);
    expect(inspectCadPluginProfile({ ...custom, inputs: { ...custom.inputs, cutterTipRadius: .002 } }, {}).issues[0]).toContain('between');
    expect(inspectCadPluginProfile({ ...custom, inputs: { ...custom.inputs, cutterTipRadius: 2 } }, {}).issues[0]).toContain('between');
    const steep = inspectCadPluginProfile({ ...profile, inputs: { ...profile.inputs, pressureAngle: 30 } }, {});
    expect(steep.issues).toEqual([]);
    expect(steep.values.effectiveCutterTipRadius).toBeLessThan(.4);
    expect(() => parseCadPluginPackage({ ...CAD_GEAR_V3_PLUGIN, version: '3.0.1' })).toThrow(/Built-in/);
    expect(createCadPluginProfile(CAD_GEAR_V2_PLUGIN).package).toEqual(CAD_GEAR_V2_PLUGIN);
  });
  it('rejects linked module edits that violate a custom cutter radius without modifying the saved profile or history', () => {
    const profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
    const document = parseCadDocument({ ...createCadDocument(), parameters: { m: 3, tip: .5 }, features: [{ id: 'gear', kind: 'sketch', name: 'Gear', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'profile', name: 'Gear', construction: false, geometry: { ...profile, inputs: { ...profile.inputs, module: 'm', cutterTipMode: 1, cutterTipRadius: 'tip' } } }] }] });
    const session = new CadSession(document), before = session.getSnapshot();
    expect(() => session.edit([{ kind: 'set-parameter', name: 'm', value: 1 }])).toThrow(/between/);
    expect(session.getSnapshot()).toBe(before);
    session.edit([{ kind: 'set-parameter', name: 'tip', value: .6 }]);
    const sketch = session.getSnapshot().document.features[0];
    if (sketch.kind !== 'sketch' || sketch.profiles[0].geometry.kind !== 'plugin') throw new Error('Expected pinned profile');
    expect(sketch.profiles[0].geometry.inputs.cutterTipRadius).toBe('tip');
    expect(inspectCadPluginProfile(sketch.profiles[0].geometry, session.getSnapshot().document.parameters).values.effectiveCutterTipRadius).toBe(.6);
    session.undo(); expect(session.getSnapshot().document).toEqual(before.document);
  });
  it('lets manual shift match a valid automatic shift above 0.6 while retaining the cutter-clearance upper bound', () => {
    const profile = createCadPluginProfile(CAD_GEAR_V3_PLUGIN);
    const custom = { ...profile, inputs: { ...profile.inputs, teeth: 12, pressureAngle: 14.5, cutterTipMode: 1, cutterTipRadius: 1 } };
    const automatic = inspectCadPluginProfile(custom, {});
    expect(automatic.issues).toEqual([]);
    expect(automatic.values.effectiveShift).toBeGreaterThan(.6);
    const manual = inspectCadPluginProfile({ ...custom, inputs: { ...custom.inputs, shiftMode: 1, profileShift: automatic.values.effectiveShift } }, {});
    expect(manual.issues).toEqual([]);
    expect(manual.values.effectiveShift).toBe(automatic.values.effectiveShift);
    const field = manual.fields.find(field => field.name === 'profileShift');
    expect(field?.maximum).toBeCloseTo(1.2 - 1 / 3 - 1e-8, 12);
    const over = inspectCadPluginProfile({ ...custom, inputs: { ...custom.inputs, shiftMode: 1, profileShift: 1.2 - 1 / 3 } }, {});
    expect(over.issues[0]).toContain('between');
    expect(CAD_GEAR_V2_PLUGIN.inputs.find(input => input.name === 'profileShift')?.maximum).toBe(.6);
  });
  it('computes forward/derived relations and dynamic limits without storing duplicate dimensions', () => {
    const profile = createCadPluginProfile(linked);
    const inspection = inspectCadPluginProfile({ ...profile, inputs: { ...profile.inputs, outerRadius: 'size / 2' } }, { size: 80 });
    expect(inspection.issues).toEqual([]);
    expect(inspection.values).toMatchObject({ outerRadius: 40, diameter: 80, halfDiameter: 40 });
    expect(inspection.fields.find(field => field.name === 'innerRadius')?.maximum).toBe(39.999);
    expect(Object.hasOwn(profile.inputs, 'diameter')).toBe(false);
  });
  it('rejects unresolvable graphs, duplicate/unknown fields and false default constraints before installation', () => {
    if (linked.apiVersion !== 2) throw new Error('API 2 fixture required');
    expect(() => parseCadPluginPackage({ ...linked, rules: { ...linked.rules, derived: [{ name: 'a', label: 'A', unit: '', expression: 'b' }, { name: 'b', label: 'B', unit: '', expression: 'a' }] } })).toThrow(/Cyclic/);
    expect(() => parseCadPluginPackage({ ...linked, rules: { ...linked.rules, derived: [{ name: 'bad', label: 'Bad', unit: '', expression: 'unknown' }] } })).toThrow(/Unknown/);
    expect(() => parseCadPluginPackage({ ...linked, rules: { ...linked.rules, fields: linked.rules.fields.slice(1) } })).toThrow(/exactly one/);
    expect(() => parseCadPluginPackage({ ...linked, rules: { ...linked.rules, constraints: [{ left: 1, operator: 'gt', right: 2, message: 'Default rejected' }] } })).toThrow(/Default rejected/);
  });
  it('checks dependent bounds in the domain, including agent edits and named parameter changes', () => {
    const document = parseCadDocument({ ...createCadDocument(), parameters: { radius: 30 }, features: [{ id: 'star', kind: 'sketch', name: 'Star', suppressed: false, plane: 'XY', offset: 0,
      profiles: [{ id: 'profile', name: 'Star', construction: false, geometry: { ...createCadPluginProfile(linked), inputs: { lobes: 8, outerRadius: 'radius', innerRadius: 20 } } }] }] });
    const session = new CadSession(document);
    expect(() => session.edit([{ kind: 'set-parameter', name: 'radius', value: 19 }])).toThrow(/between|Inner radius/);
    expect(session.getSnapshot().document).toBe(document);
    const readonly = { ...createCadPluginProfile(linked), inputs: { ...createCadPluginProfile(linked).inputs, diameter: 120 } };
    expect(() => resolveCadPluginProfile(readonly, {})).toThrow(/match/);
  });
  it('evaluates bounded min/max and scientific notation without expanding ordinary CAD expressions', () => {
    expect(evaluateCadRecipeScalar('max(1e-5, min(3, 4))', {})).toBe(3);
    expect(() => evaluateCadRecipeScalar('max(1, 2, 3)', {})).toThrow();
    expect(() => evaluateCadRecipeScalar('Math.max(1, 2)', {})).toThrow();
  });
  it('distinguishes forward variables named after math functions from actual function calls', () => {
    if (linked.apiVersion !== 2) throw new Error('API 2 fixture required');
    const plugin = { ...linked, rules: { ...linked.rules, derived: [
      { name: 'diameter', label: 'Diameter', unit: 'mm', expression: 'max * 2 + sin(0) + min(0, 1)' },
      { name: 'halfDiameter', label: 'Half diameter', unit: 'mm', expression: 'diameter / 2' },
      { name: 'max', label: 'Radius', unit: 'mm', expression: 'outerRadius' },
    ] } };
    const inspection = inspectCadPluginProfile(createCadPluginProfile(plugin), {});
    expect(inspection.issues).toEqual([]);
    expect(inspection.values).toMatchObject({ max: 30, diameter: 60, halfDiameter: 30 });
    expect(() => parseCadPluginPackage({ ...plugin, rules: { ...plugin.rules, derived: [
      { name: 'max', label: 'Max', unit: '', expression: 'sin' }, { name: 'sin', label: 'Sin', unit: '', expression: 'max' },
    ] } })).toThrow(/Cyclic/);
  });
  it('does not impose an inactive range but still validates every inactive relation', () => {
    if (linked.apiVersion !== 2) throw new Error('API 2 fixture required');
    const inactive = { ...linked, rules: { ...linked.rules, fields: linked.rules.fields.map(field => field.name === 'innerRadius'
      ? { ...field, minimum: 1, maximum: 0, enabledWhen: { left: 'lobes', operator: 'eq' as const, right: 0 } } : field) } };
    const profile = createCadPluginProfile(inactive);
    expect(inspectCadPluginProfile(profile, {}).fields.find(field => field.name === 'innerRadius')).toMatchObject({ enabled: false, minimum: 1, maximum: 0 });
    expect(resolveCadPluginProfile(profile, {}).kind).toBe('polygon');
    expect(() => parseCadPluginPackage({ ...inactive, rules: { ...inactive.rules, fields: inactive.rules.fields.map(field => field.name === 'innerRadius'
      ? { ...field, maximum: 'unknown' } : field) } })).toThrow(/Unknown/);
    expect(() => parseCadPluginPackage({ ...inactive, rules: { ...inactive.rules, fields: inactive.rules.fields.map(field => field.name === 'innerRadius'
      ? { ...field, enabledWhen: { left: 'lobes', operator: 'eq', right: 8 } } : field) } })).toThrow(/No valid range/);
  });
  it('returns detached field metadata so inspection cannot mutate a pinned package', () => {
    if (linked.apiVersion !== 2) throw new Error('API 2 fixture required');
    const plugin = { ...linked, rules: { ...linked.rules, fields: linked.rules.fields.map(field => field.name === 'lobes'
      ? { ...field, choices: [{ value: 8, label: 'Eight' }, { value: 9, label: 'Nine' }], enabledWhen: { left: 'lobes', operator: 'gt' as const, right: 0 } } : field) } };
    const profile = createCadPluginProfile(plugin), original = structuredClone(profile);
    const inspected = inspectCadPluginProfile(profile, {}), field = inspected.fields.find(field => field.name === 'lobes');
    if (!field?.choices || !field.enabledWhen) throw new Error('Missing metadata fixture');
    field.choices[0].label = 'Changed'; field.enabledWhen.left = 'unknown';
    expect(profile).toEqual(original);
    expect(inspectCadPluginProfile(profile, {}).issues).toEqual([]);
  });
  it('intersects dependent limits with static input limits instead of offering rejected values', () => {
    if (linked.apiVersion !== 2) throw new Error('API 2 fixture required');
    const plugin = { ...linked, rules: { ...linked.rules, fields: linked.rules.fields.map(field => field.name === 'lobes'
      ? { ...field, minimum: -10, maximum: 'outerRadius * 100' } : field) } };
    const profile = createCadPluginProfile(plugin), inspection = inspectCadPluginProfile(profile, {});
    expect(inspection.fields.find(field => field.name === 'lobes')).toMatchObject({ minimum: 3, maximum: 100 });
    expect(() => resolveCadPluginProfile({ ...profile, inputs: { ...profile.inputs, lobes: 2 } }, {})).toThrow(/between/);
    expect(profile.inputs.lobes).toBe(8);
  });
  it.each([2, 101, 8.5])('rejects a declared choice %s that contradicts the static range or integer type', value => {
    if (linked.apiVersion !== 2) throw new Error('API 2 fixture required');
    const plugin = { ...linked, rules: { ...linked.rules, fields: linked.rules.fields.map(field => field.name === 'lobes'
      ? { ...field, choices: [{ value: 8, label: 'Default' }, { value, label: 'Invalid' }] } : field) } };
    expect(() => parseCadPluginPackage(plugin)).toThrow(/Choices/);
  });
  it('keeps v1 parts pinned and offers generated roots as a distinct explicit version', () => {
    const legacy = createCadPluginProfile(CAD_GEAR_PLUGIN), current = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    expect(parseCadPluginPackage(legacy.package)).toEqual(CAD_GEAR_PLUGIN);
    expect(current.package).toMatchObject({ apiVersion: 2, version: '2.0.0' });
    expect(resolveCadPluginProfile(legacy, {})).not.toEqual(resolveCadPluginProfile(current, {}));
    expect(() => parseCadPluginPackage({ ...CAD_GEAR_V2_PLUGIN, version: '2.0.1' })).toThrow(/cannot be replaced/);
  });
  it.each([12, 18, 36, 100, 300])('automatically correlates shift, tip and root dimensions for %s teeth', teeth => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    const inspection = inspectCadPluginProfile({ ...profile, inputs: { ...profile.inputs, module: 1, teeth } }, {});
    expect(inspection.issues).toEqual([]);
    expect(inspection.values.pitchDiameter).toBe(teeth);
    expect(inspection.values.effectiveShift).toBeGreaterThanOrEqual(inspection.values.minimumShift);
    expect(inspection.values.tipDiameter - inspection.values.rootDiameter).toBeCloseTo(4.5, 12);
    expect(inspection.fields.find(field => field.name === 'profileShift')?.enabled).toBe(false);
    expect(inspection.fields.find(field => field.name === 'tolerance')?.enabled).toBe(false);
  });
  it.each([14.5, 20, 25, 30])('uses a valid rack tip envelope for %s°', pressureAngle => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    const inspection = inspectCadPluginProfile({ ...profile, inputs: { ...profile.inputs, pressureAngle } }, {});
    expect(inspection.issues).toEqual([]);
    expect(inspection.values.cutterTipRadius).toBeGreaterThan(0);
    expect(inspection.values.tipThickness).toBeGreaterThanOrEqual(0.6);
  });
  it('rejects unsafe manual shift, thinning, tolerance and mode values without modifying stored inputs', () => {
    const profile = createCadPluginProfile(CAD_GEAR_V2_PLUGIN);
    const updates: CadPluginProfile['inputs'][] = [{ shiftMode: 1, teeth: 12, profileShift: 0 }, { backlash: 4.7 }, { qualityMode: 1, module: 0.05, tolerance: 0.1 }, { shiftMode: 0.5 }];
    for (const update of updates) {
      const unsafe = { ...profile, inputs: { ...profile.inputs, ...update } };
      expect(inspectCadPluginProfile(unsafe, {}).issues.length).toBeGreaterThan(0);
      expect(() => resolveCadPluginProfile(unsafe, {})).toThrow();
    }
    expect(profile.inputs).toEqual(createCadPluginProfile(CAD_GEAR_V2_PLUGIN).inputs);
  });
});
