import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { applyProjectEdits, projectEdit } from './projectEdits';

function circles() {
  return createUpidFromDxfEntities([
    { type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: 10 },
    { type: 'circle', layer: '0', center: { x: 0, y: 0 }, radius: 3 }
  ]);
}
describe('agent machining batches', () => {
  it('configures a real inner/outer contour plan including generated manual rethread and a separate stop', () => {
    const doc = circles();
    const hole = doc.plan.operations.find(op => op.classification === 'hole')!;
    const outer = doc.plan.operations.find(op => op.classification === 'exterior')!;
    const edited = applyProjectEdits(doc, [
      { kind: 'geometry-basis', basis: 'finished-contour' },
      { kind: 'compensation', operationId: hole.id, selection: 'outside' },
      { kind: 'compensation', operationId: outer.id, selection: 'inside' },
      { kind: 'initial-wire', point: { x: 0, y: 0 } },
      { kind: 'threading-default', transition: { mode: 'manual', wireSeparation: 'automatic-during-positioning' } },
      { kind: 'circle-center-entry', operationId: hole.id },
      { kind: 'exit', operationId: hole.id, to: null },
      { kind: 'entry', operationId: outer.id, from: { x: 12, y: 0 } },
      { kind: 'exit', operationId: outer.id, to: null },
      { kind: 'program-stops', operationId: hole.id, stops: [{ id: 'inspect', enabled: true, placement: { kind: 'after-contour' }, reason: 'operator-check' }] }
    ]);
    expect(edited.schemaVersion).toBe(2);
    const result = compileWireEdmExecutionPlan(edited);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.plan.events.filter(e => e.kind === 'program-stop')).toHaveLength(1);
    expect(result.plan.events.some(e => e.kind === 'wire-thread')).toBe(true);
    expect(doc.setup).toBeUndefined();
  });
  it('rejects a whole batch when a later operation is missing, without changing the original', () => {
    const doc = circles();
    const before = JSON.stringify(doc);
    expect(() => applyProjectEdits(doc, [{ kind: 'translate', delta: { x: 5, y: 2 } }, { kind: 'reverse', operationId: 'missing' }])).toThrow('No edits were applied');
    expect(JSON.stringify(doc)).toBe(before);
  });
  it('rejects nonfinite coordinates, malformed threading, and extra replacement fields at the boundary', () => {
    for (const input of [
      { kind: 'initial-wire', point: { x: Infinity, y: 0 } },
      { kind: 'threading-default', transition: { mode: 'invented', wireSeparation: 'already-separated' } },
      { kind: 'geometry-basis', basis: 'wire-centre', document: {} }
    ]) expect(Value.Check(projectEdit, input)).toBe(false);
    expect(() => applyProjectEdits(circles(), [{ kind: 'threading-default', transition: { mode: 'continuous', wireSeparation: 'automatic-during-positioning' } }])).toThrow('not applicable');
  });
});
