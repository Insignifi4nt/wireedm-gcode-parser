import { describe, expect, it } from 'vitest';
import type { CadDocument, CadFeature, CadPlane, CadSketchFeature, CadSketchProfile } from '../cadDocument';
import { CadError } from '../cadError';
import { cadLoftOffsetTolerance, inspectCadLoftSketch, resolveCadLoftSections, type CadLoftFeature } from '../cadLoft';
import { applyCadEdits } from '../cadOperations';
import { cadConsumedBodyIds, cadFeatureDependencies, cadFeatureInputs, cadVisibleBodyIds, createCadDocument, parseCadDocument } from '../cadSchema';

const contour = (id = 'contour', radius: number | string = 5, x = 0, construction = false): CadSketchProfile => ({ id, name: id, construction,
  geometry: { kind: 'circle', x, y: 0, radius } });
function sketch(id: string, offset: number | string, plane: CadPlane = 'XY', profiles: readonly CadSketchProfile[] = [contour()]): CadSketchFeature {
  return { kind: 'sketch', id, name: id, suppressed: false, plane, offset, profiles };
}
const first = sketch('first', 0); const last = sketch('last', 10);
const loft: CadLoftFeature = { kind: 'loft', id: 'loft', name: 'Loft', suppressed: false, sketchIds: ['first', 'last'], ruled: false, operation: 'new', targetId: null };
const pad: CadFeature = { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false, sketchId: 'first', distance: 5, symmetric: false, operation: 'new', targetId: null };
function document(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ ...createCadDocument('Loft part', 'cad_loft'), features, parameters });
}
function inputs(features: readonly CadFeature[]) { return new Map(features.map(feature => [feature.id, feature])); }
function expectCode(operation: () => unknown, code: string) {
  try { operation(); throw new Error('Expected CAD validation failure'); } catch (error) { expect(error).toBeInstanceOf(CadError); expect(error).toMatchObject({ code }); }
}

describe('loft section eligibility and order', () => {
  it('retains the complete resolved boundary and ignores only explicit construction references', () => {
    const section = sketch('section', 'height', 'XZ', [contour('material', 'radius'), contour('guide', 1, 30, true)]);
    expect(inspectCadLoftSketch(section, { height: 12, radius: 7 })).toMatchObject({ eligible: true, section: {
      sketchId: 'section', sketch: section, plane: 'XZ', offset: 12, geometry: { kind: 'circle', radius: 7 }
    } });
    expect(section.profiles[0].geometry).toMatchObject({ radius: 'radius' });
    expect(section.offset).toBe('height');
  });
  it('accepts exact rounded rectangles, rotated slots and imported line/arc paths as complete sections', () => {
    const profiles: readonly CadSketchProfile[] = [
      { ...contour(), geometry: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 8, cornerRadius: 2 } },
      { ...contour(), geometry: { kind: 'slot', x: 0, y: 0, length: 10, width: 4, angle: 37 } },
      { ...contour(), geometry: { kind: 'path', segments: [{ kind: 'line', start: [-5, 0], end: [5, 0] }, { kind: 'arc', center: [0, 0], radius: 5, startAngle: 0, sweep: 180 }] } }
    ];
    for (const profile of profiles) expect(inspectCadLoftSketch(sketch('section', 0, 'XY', [profile]), {})).toMatchObject({ eligible: true, section: { geometry: profile.geometry } });
  });
  it('rejects empty, suppressed, holed, disjoint-material and island sections rather than selecting a subset', () => {
    expect(inspectCadLoftSketch(sketch('empty', 0, 'XY', []), {})).toMatchObject({ eligible: false, code: 'empty-sketch' });
    expect(inspectCadLoftSketch(sketch('construction', 0, 'XY', [contour('guide', 5, 0, true)]), {})).toMatchObject({ eligible: false, code: 'empty-sketch' });
    expect(inspectCadLoftSketch({ ...first, suppressed: true }, {})).toMatchObject({ eligible: false, code: 'suppressed-sketch' });
    for (const profiles of [[contour('outer', 10), contour('hole', 5)], [contour('a', 2), contour('b', 2, 10)], [contour('outer', 10), contour('hole', 5), contour('island', 1)]]) {
      expect(inspectCadLoftSketch(sketch('section', 0, 'XY', profiles), {})).toMatchObject({ eligible: false, code: 'unsupported-loft-section' });
    }
    expect(inspectCadLoftSketch(sketch('bad-expression', 'missing'), {})).toMatchObject({ eligible: false, code: 'unknown-parameter' });
  });
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('preserves ascending and descending section order on %s', plane => {
    const source = [sketch('a', -10, plane), sketch('b', 0, plane), sketch('c', 15, plane)];
    for (const sketchIds of [['a', 'b', 'c'], ['c', 'b', 'a']]) {
      const resolved = resolveCadLoftSections({ ...loft, sketchIds }, inputs(source), {});
      expect(resolved.sections.map(section => section.sketchId)).toEqual(sketchIds);
      expect(resolved.sections.map(section => section.offset)).toEqual(sketchIds[0] === 'a' ? [-10, 0, 15] : [15, 0, -10]);
      expect(resolved.offsetTolerance).toBe(1e-7); expect(Object.isFrozen(resolved.sections)).toBe(true);
    }
  });
  it('rejects duplicates, invalid reference types, mixed planes, coplanar sections and folded ordering', () => {
    expectCode(() => resolveCadLoftSections({ ...loft, sketchIds: ['first', 'first'] }, inputs([first]), {}), 'duplicate-loft-section');
    expectCode(() => resolveCadLoftSections(loft, inputs([first, { ...pad, id: 'last' }]), {}), 'invalid-reference');
    expectCode(() => resolveCadLoftSections(loft, inputs([first]), {}), 'invalid-reference');
    expectCode(() => resolveCadLoftSections(loft, inputs([first, { ...last, plane: 'YZ' }]), {}), 'unsupported-loft-planes');
    expectCode(() => resolveCadLoftSections(loft, inputs([first, { ...last, offset: 0 }]), {}), 'invalid-loft-order');
    expectCode(() => resolveCadLoftSections({ ...loft, sketchIds: ['first', 'last', 'middle'] }, inputs([first, last, sketch('middle', 5)]), {}), 'invalid-loft-order');
  });
  it('requires separations beyond native precision and bounded floating-point subtraction at far offsets', () => {
    for (const offset of [1e-8, 1e-7]) expectCode(() => resolveCadLoftSections(loft, inputs([first, { ...last, offset }]), {}), 'invalid-loft-order');
    expect(resolveCadLoftSections(loft, inputs([first, { ...last, offset: 1.1e-7 }]), {}).sections).toHaveLength(2);
    const origin = 999999990;
    expect(cadLoftOffsetTolerance([origin, origin + 1])).toBeGreaterThan(1e-7);
    expectCode(() => resolveCadLoftSections(loft, inputs([{ ...first, offset: origin }, { ...last, offset: origin + 1e-6 }]), {}), 'invalid-loft-order');
    expect(resolveCadLoftSections(loft, inputs([{ ...first, offset: origin }, { ...last, offset: origin + 0.01 }]), {}).sections).toHaveLength(2);
    expectCode(() => cadLoftOffsetTolerance([Infinity]), 'invalid-scalar');
  });
  it('allows 16 ordered sections and rejects fewer than 2 or more than 16 before native construction', () => {
    const sections = Array.from({ length: 16 }, (_, index) => sketch(`section_${index}`, index));
    const feature = { ...loft, sketchIds: sections.map(section => section.id) };
    expect(document([...sections, feature]).features).toHaveLength(17);
    expect(resolveCadLoftSections(feature, inputs(sections), {}).sections).toHaveLength(16);
    expectCode(() => resolveCadLoftSections({ ...loft, sketchIds: ['first'] }, inputs([first]), {}), 'loft-section-limit');
    const extra = sketch('extra', 16);
    expectCode(() => resolveCadLoftSections({ ...feature, sketchIds: [...feature.sketchIds, extra.id] }, inputs([...sections, extra]), {}), 'loft-section-limit');
    expect(() => document([...sections, extra, { ...feature, sketchIds: [...feature.sketchIds, extra.id] }])).toThrow(CadError);
  });
});

describe('typed loft inputs and atomic saved-history compatibility', () => {
  it('partitions section inputs from solid targets and consumes only an active target', () => {
    const joined: CadLoftFeature = { ...loft, operation: 'join', targetId: 'pad' }, unparameterized = { parameters: {} };
    expect(cadFeatureInputs(joined)).toEqual({ datumIds: [], sketchIds: ['first', 'last'], curveIds: [], bodyIds: ['pad'] });
    expect(cadFeatureDependencies(joined)).toEqual(['first', 'last', 'pad']);
    expect(cadConsumedBodyIds(joined, unparameterized)).toEqual(['pad']); expect(cadConsumedBodyIds(loft, unparameterized)).toEqual([]);
    expect(cadConsumedBodyIds({ ...joined, suppressed: true }, unparameterized)).toEqual([]);
    expect(cadVisibleBodyIds(document([first, last, pad, joined]).features, unparameterized)).toEqual(['loft']);
    expect(cadConsumedBodyIds({ kind: 'mirror', id: 'mirror', name: 'Mirror', suppressed: false, sourceId: 'pad', plane: 'XY' }, unparameterized)).toEqual([]);
    expect(cadFeatureInputs(pad)).toEqual({ datumIds: [], sketchIds: ['first'], curveIds: [], bodyIds: [] });
  });
  it('rejects malformed complete features, invalid targets, later references and active suppressed sections', () => {
    const blank = createCadDocument('Part', 'cad_loft');
    for (const malformed of [{ ...loft, sketchIds: ['first', 'first'] }, { ...loft, sketchIds: ['first'] }, { ...loft, ruled: 'false' }, { ...loft, angle: 360 }]) {
      expectCode(() => parseCadDocument({ ...blank, features: [first, last, malformed] }), 'invalid-document');
    }
    expectCode(() => document([first, loft, last]), 'invalid-reference');
    expectCode(() => document([first, last, { ...loft, operation: 'cut' }]), 'invalid-operation');
    expectCode(() => document([first, last, pad, { ...loft, targetId: 'pad' }]), 'invalid-operation');
    expectCode(() => document([first, last, pad, { ...loft, operation: 'join', targetId: 'first' }]), 'invalid-reference');
    expectCode(() => document([first, { ...last, suppressed: true }, loft]), 'suppressed-sketch');
    expectCode(() => document([first, last, { ...pad, suppressed: true }, { ...loft, operation: 'cut', targetId: 'pad' }]), 'unavailable-body');
  });
  it('applies parameter-driven radius and plane changes atomically without rewriting source expressions', () => {
    const variableLast = sketch('last', 'height', 'XY', [contour('contour', 'radius')]);
    const original = document([first, variableLast, loft], { height: 10, radius: 3 });
    const updated = applyCadEdits(original, [{ kind: 'set-parameter', name: 'height', value: 20 }, { kind: 'set-parameter', name: 'radius', value: 7 }]);
    expect(resolveCadLoftSections(loft, inputs(updated.features), updated.parameters).sections[1]).toMatchObject({ offset: 20, geometry: { radius: 7 } });
    expect(updated.features[1]).toEqual(variableLast); expect(original.parameters).toEqual({ height: 10, radius: 3 });
    expectCode(() => applyCadEdits(updated, [{ kind: 'rename-document', name: 'Changed' }, { kind: 'set-parameter', name: 'height', value: 0 }]), 'invalid-loft-order');
    expect(updated.name).toBe('Loft part'); expect(updated.parameters.height).toBe(20);
    const three = document([first, sketch('middle', 'mid'), last, { ...loft, sketchIds: ['first', 'middle', 'last'] }], { mid: 5 });
    expectCode(() => applyCadEdits(three, [{ kind: 'set-parameter', name: 'mid', value: 15 }]), 'invalid-loft-order');
  });
  it('retains suppressed loft structure while upstream geometry changes, requiring explicit valid repair to unsuppress', () => {
    const original = document([first, last, { ...loft, suppressed: true }]);
    const holed = { ...last, offset: 0, profiles: [contour('outer', 10), contour('hole', 3)] };
    const changed = applyCadEdits(original, [{ kind: 'update-feature', feature: holed }]);
    expect(changed.features[1]).toEqual(holed); expect(cadVisibleBodyIds(changed.features, changed)).toEqual([]);
    expectCode(() => applyCadEdits(changed, [{ kind: 'update-feature', feature: loft }]), 'unsupported-loft-section');
    expect(changed.features[2].suppressed).toBe(true);
    const coplanar = applyCadEdits(changed, [{ kind: 'update-feature', feature: { ...last, offset: 0 } }]);
    expectCode(() => applyCadEdits(coplanar, [{ kind: 'update-feature', feature: loft }]), 'invalid-loft-order');
    expect(applyCadEdits(coplanar, [{ kind: 'update-feature', feature: last }, { kind: 'update-feature', feature: loft }]).features[2]).toEqual(loft);
    expect(document([{ ...first, suppressed: true }, last, { ...loft, suppressed: true }]).features).toHaveLength(3);
    expectCode(() => document([first, { ...loft, suppressed: true }]), 'invalid-reference');
    expectCode(() => document([first, last, pad, { ...loft, sketchIds: ['first', 'pad'], suppressed: true }]), 'invalid-reference');
  });
  it('guards section deletion/reordering and explicitly cascades through loft descendants', () => {
    const descendant: CadFeature = { kind: 'linear-pattern', id: 'pattern', name: 'Pattern', suppressed: false, sourceId: 'loft', count: 2, spacing: [20, 0, 0] };
    const original = document([first, last, loft, descendant]);
    expectCode(() => applyCadEdits(original, [{ kind: 'delete-feature', featureId: 'last', cascade: false }]), 'dependent-feature');
    expectCode(() => applyCadEdits(original, [{ kind: 'move-feature', featureId: 'loft', beforeId: 'last' }]), 'invalid-reference');
    expect(applyCadEdits(original, [{ kind: 'delete-feature', featureId: 'last', cascade: true }]).features).toEqual([first]);
    expect(original.features).toHaveLength(4);
  });
  it('counts a loft as one generated body regardless of section count and preserves legacy operand-budget semantics', () => {
    const sections = Array.from({ length: 16 }, (_, index) => sketch(`s_${index}`, index));
    const generated: CadLoftFeature = { ...loft, sketchIds: sections.map(section => section.id) };
    const firstPattern: CadFeature = { kind: 'linear-pattern', id: 'hundred', name: 'Hundred', suppressed: false, sourceId: 'loft', count: 100, spacing: [30, 0, 0] };
    const secondPattern: CadFeature = { ...firstPattern, id: 'thousand', sourceId: 'hundred', count: 10 };
    expect(document([...sections, generated, firstPattern, secondPattern]).features).toHaveLength(19);
    expectCode(() => document([...sections, generated, firstPattern, { ...secondPattern, count: 11 }]), 'feature-limit');
    // Pad/Revolve historically preserve target operand counts in domain preflight;
    // native construction still counts generated operands before actual operations.
    const oldFirst: CadFeature = { ...firstPattern, sourceId: 'pad' };
    const old = document([first, pad, oldFirst, secondPattern, { ...pad, id: 'joined', operation: 'join', targetId: 'thousand' }]);
    expect(parseCadDocument(JSON.parse(JSON.stringify(old)))).toEqual(old);
    const suppressedPad = { ...pad, suppressed: true };
    expect(document([sketch('first', 0, 'XY', []), suppressedPad]).features).toEqual([sketch('first', 0, 'XY', []), suppressedPad]);
    const revolve: CadFeature = { kind: 'revolve', id: 'revolve', name: 'Revolve', suppressed: true, sketchId: 'first', axis: 'x', angle: 180, operation: 'new', targetId: null };
    expect(document([{ ...first, suppressed: true }, revolve]).features).toEqual([{ ...first, suppressed: true }, revolve]);
  });
  it('includes the new loft operand with target instances before Boolean and downstream pattern allocation', () => {
    const hundred: CadFeature = { kind: 'linear-pattern', id: 'hundred', name: 'Hundred', suppressed: false, sourceId: 'pad', count: 100, spacing: [30, 0, 0] };
    const five: CadFeature = { ...hundred, id: 'five', sourceId: 'hundred', count: 5 };
    const two: CadFeature = { ...hundred, id: 'two', sourceId: 'loft', count: 2 };
    expect(document([first, last, pad, hundred, five, { ...loft, operation: 'join', targetId: 'five' }]).features).toHaveLength(6);
    expectCode(() => document([first, last, pad, hundred, five, { ...loft, operation: 'join', targetId: 'five' }, two]), 'feature-limit');
    const thousand: CadFeature = { ...five, id: 'thousand', count: 10 };
    for (const operation of ['join', 'cut'] as const) {
      expectCode(() => document([first, last, pad, hundred, thousand, { ...loft, operation, targetId: 'thousand' }]), 'feature-limit');
    }
    // 497 + 2 operands form a conservative target budget of 499. Adding the
    // loft makes 500, so precisely two downstream copies remain within 1000.
    const seven: CadFeature = { ...hundred, id: 'seven', count: 7 };
    const fourNinetySeven: CadFeature = { ...hundred, id: 'four_ninety_seven', sourceId: 'seven', count: 71 };
    const other: CadFeature = { ...pad, id: 'other' };
    const otherTwo: CadFeature = { ...hundred, id: 'other_two', sourceId: 'other', count: 2 };
    const combined: CadFeature = { kind: 'boolean', id: 'combined', name: 'Combined', suppressed: false, operation: 'union', targetId: 'four_ninety_seven', toolId: 'other_two' };
    expect(document([first, last, pad, seven, fourNinetySeven, other, otherTwo, combined,
      { ...loft, operation: 'join', targetId: 'combined' }, two]).features).toHaveLength(10);
  });
});
