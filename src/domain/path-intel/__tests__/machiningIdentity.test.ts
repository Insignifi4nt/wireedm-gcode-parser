import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';

import { deriveActiveMachiningOperations, setMachiningSpanParticipation, setPartialContourEntryReview } from '../machiningParticipation';
import type { PathPlanningDocument } from '../types';

function twoLines() {
  const source = createUpidFromDxfEntities([
    { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
    { type: 'line', layer: 'CUT', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
  ]);
  source.geometryBasis = 'wire-centre';
  source.setup = {
    initialWirePosition: { kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  return source;
}

describe('derived machining identity isolation', () => {
  it('does not overwrite an unrelated source segment whose ID matches the normal clipped-segment ID', () => {
    const source = twoLines();
    const collidingId = `mach_span_${source.segments[0].id}_0_0p5`;
    const renamed = JSON.parse(JSON.stringify(source, (_key, value) =>
      value === source.segments[1].id ? collidingId : value)) as PathPlanningDocument;
    const document = setMachiningSpanParticipation(renamed, {
      sourceSegmentId: renamed.segments[0].id, range: { start: 0.5, end: 1 }, participation: 'inactive-reference'
    })!;
    expect(validateUpidDocument(document).valid).toBe(true);
    const before = structuredClone(document);
    const derived = deriveActiveMachiningOperations(document);
    expect(derived.status).toBe('ready');
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.plan.events.filter((event) => event.kind === 'motion').map(({ start, end }) => ({ start, end })))
      .toEqual([
        { start: { x: 0, y: 0 }, end: { x: 5, y: 0 } },
        { start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
      ]);
    expect(new Set(derived.segments.map(({ id }) => id)).size).toBe(derived.segments.length);
    expect(deriveActiveMachiningOperations(document)).toEqual(derived);
    expect(document).toEqual(before);
  });

  it('does not overwrite explicit active-span attribution with an implicit span ID', () => {
    const document = twoLines();
    const [first, second] = document.segments;
    document.machiningParticipation = { spans: [
      { id: `span_${second.id}_0_1`, sourceSegmentId: first.id, range: { start: 0, end: 0.5 }, participation: 'active-cut' },
      { id: 'remaining-first', sourceSegmentId: first.id, range: { start: 0.5, end: 1 }, participation: 'inactive-reference' }
    ] };
    expect(validateUpidDocument(document).valid).toBe(true);
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    const cut = compiled.plan.events.find((event) => event.kind === 'motion');
    expect(cut).toMatchObject({ sourceSegmentId: first.id, sourceRange: { start: 0, end: 0.5 } });
  });

  it('keeps separately authored exclusions distinct when their coordinates differ below nine decimal places', () => {
    const source = twoLines();
    const segmentId = source.segments[0].id;
    const first = setMachiningSpanParticipation(source, { sourceSegmentId: segmentId,
      range: { start: 0.5, end: 0.5000000001 }, participation: 'inactive-reference' })!;
    const second = setMachiningSpanParticipation(first, { sourceSegmentId: segmentId,
      range: { start: 0.5000000001, end: 0.5000000002 }, participation: 'inactive-reference' })!;
    expect(validateUpidDocument(second).structurallyValid).toBe(true);
    const ids = second.machiningParticipation!.spans.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.machiningParticipation!.spans.map(({ range }) => range)).toEqual([
      { start: 0.5, end: 0.5000000001 }, { start: 0.5000000001, end: 0.5000000002 }
    ]);
  });

  it('preserves an existing authored span ID when the same exclusion is set again', () => {
    const source = twoLines();
    source.machiningParticipation = { spans: [{ id: 'reviewed-exclusion', sourceSegmentId: source.segments[0].id,
      range: { start: 0.5, end: 1 }, participation: 'inactive-reference' }] };
    const updated = setMachiningSpanParticipation(source, { sourceSegmentId: source.segments[0].id,
      range: { start: 0.5, end: 1 }, participation: 'inactive-reference' })!;
    expect(updated.machiningParticipation!.spans[0].id).toBe('reviewed-exclusion');
  });

  it('keeps an unchanged partial entry review when the same participation edit is repeated', () => {
    const source = twoLines();
    const operation = source.plan.operations[0];
    operation.transitions = { entry: { strategy: 'none', review: 'reviewed' } };
    const edit = { sourceSegmentId: source.segments[0].id, range: { start: 0.5, end: 1 }, participation: 'inactive-reference' as const };
    const partial = setMachiningSpanParticipation(source, edit)!;
    const reviewed = setPartialContourEntryReview(partial, operation.id, true)!;
    expect(deriveActiveMachiningOperations(reviewed).operations[0].transitions?.entry).toMatchObject({ review: 'reviewed' });
    const repeated = setMachiningSpanParticipation(reviewed, edit)!;
    expect(repeated).toEqual(reviewed);
    expect(repeated).not.toBe(reviewed);
  });
});
