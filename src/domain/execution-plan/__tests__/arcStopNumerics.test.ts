import { describe, expect, it } from 'vitest';

import { reviewCenterline } from '@/__tests__/reviewedUpid';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { compileWireEdmExecutionPlan } from '../executionPlan';

function tinyStoppedArc(angle: number, sweep: number) {
  const start = { x: Math.cos(angle), y: Math.sin(angle) };
  const end = { x: Math.cos(angle + sweep), y: Math.sin(angle + sweep) };
  const document = createPathPlanningDocumentFromDxfEntities([{
    type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 1,
    start, end, startAngle: angle * 180 / Math.PI,
    endAngle: (angle + sweep) * 180 / Math.PI, sweepRadians: sweep, clockwise: false
  }], { coincidenceEpsilon: 0, endpointTolerance: 0 });
  document.setup = { initialWirePosition: { kind: 'manual', point: start, review: 'reviewed' } };
  reviewCenterline(document);
  document.plan.operations[0].programStops = [{
    id: 'half', enabled: true, reason: 'operator-check',
    placement: { kind: 'before-operation-end', remainingCutLengthMm: sweep / 2 }
  }];
  return document;
}

describe('source-based arc stop distances', () => {
  it.each([
    { center: 1e9, remaining: 1e-8 },
    { center: 1e14, remaining: 0.001 }
  ])('rejects a circle stop whose coordinates round onto the closure, center=$center remaining=$remaining', ({ center, remaining }) => {
    const document = createPathPlanningDocumentFromDxfEntities([{
      type: 'circle', layer: 'CUT', center: { x: center, y: center }, radius: 5
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: center + 5, y: center }, review: 'reviewed' } };
    reviewCenterline(document);
    document.plan.operations[0].programStops = [{ id: 'near-closure', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: remaining } }];
    const before = structuredClone(document);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({ code: 'EXECUTION_PLAN_PROGRAM_STOP_INVALID' })]
    });
    expect(document).toEqual(before);
  });

  it('rejects a remaining cut that rounds to the circle end instead of losing the complete turn', () => {
    const document = createPathPlanningDocumentFromDxfEntities([{
      type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5
    }]);
    document.setup = { initialWirePosition: { kind: 'manual', point: { x: 5, y: 0 }, review: 'reviewed' } };
    reviewCenterline(document);
    document.plan.operations[0].programStops = [{ id: 'near-end', enabled: true, reason: 'operator-check',
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 1e-16 } }];
    const before = structuredClone(document);
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false, diagnostics: [expect.objectContaining({ code: 'EXECUTION_PLAN_PROGRAM_STOP_INVALID' })]
    });
    expect(document).toEqual(before);
  });

  it.each([
    { angle: 0.1, sweep: 1e-16, legacySavedRevision: false },
    { angle: 0.1, sweep: 1e-16, legacySavedRevision: true },
    { angle: Math.PI, sweep: 1e-15, legacySavedRevision: false },
    { angle: Math.PI, sweep: 1e-15, legacySavedRevision: true }
  ])('splits an accepted arc halfway, angle=$angle sweep=$sweep legacy=$legacySavedRevision', ({ angle, sweep, legacySavedRevision }) => {
    const document = tinyStoppedArc(angle, sweep);
    const original = structuredClone(document);
    expect(validateUpidDocument(document).valid).toBe(true);
    const compiled = compileWireEdmExecutionPlan(document, { legacySavedRevision });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const motions = compiled.plan.events.flatMap(event => event.kind === 'motion' && event.role === 'contour' ? [event] : []);
    expect(motions).toHaveLength(2);
    expect(motions[0].sourceRange).toEqual({ start: 0, end: 0.5 });
    expect(motions[1].sourceRange).toEqual({ start: 0.5, end: 1 });
    expect(document).toEqual(original);
  });
});
