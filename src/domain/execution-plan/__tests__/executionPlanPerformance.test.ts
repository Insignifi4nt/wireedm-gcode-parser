import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import * as material from '@/domain/path-intel/positioningMaterial';
import { compileWireEdmExecutionPlan } from '../executionPlan';

function finishedContours(count: number, nested = false) {
  const document = createUpidFromDxfEntities(Array.from({ length: count }, (_, index) => ({
    type: 'circle' as const, layer: 'CUT', center: { x: nested ? 0 : index * 30, y: 0 }, radius: nested ? 5 + index * 10 : 5
  })), { operationOrderStrategy: 'source-order' });
  for (const operation of document.plan.operations) operation.compensationIntent = { mode: 'centerline', source: 'manual' };
  for (const element of document.pathElements) if (element.operationId) element.compensationIntent = { mode: 'centerline', source: 'manual' };
  document.setup = {
    initialWirePosition: { kind: 'manual', point: { ...document.plan.operations[0].startPoint }, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' }
  };
  return document;
}

describe('execution compilation material checks', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['manual', 'automatic'] as const)('avoids repeated full-job material scans for %s separated positioning', mode => {
    const document = finishedContours(100);
    document.setup!.threadingDefault = { mode, wireSeparation: mode === 'manual' ? 'manual-before-positioning' : 'automatic-before-positioning' };
    const classify = vi.spyOn(material, 'classifyPositioningMaterial');
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.plan.requirements.operationCount).toBe(100);
    expect(compiled.plan.events.filter(event => event.kind === 'position')).toHaveLength(99);
    expect(compiled.plan.events.filter(event => event.kind === 'wire-separate')).toHaveLength(99);
    expect(compiled.plan.events.filter(event => event.kind === 'wire-thread')).toHaveLength(99);
    expect(classify.mock.calls.length).toBe(0);
  });

  it('still blocks a continuous threaded route crossing finished material', () => {
    const document = finishedContours(2, true);
    document.setup!.threadingDefault = { mode: 'continuous', wireSeparation: 'already-separated' };
    const classify = vi.spyOn(material, 'classifyPositioningMaterial');
    expect(compileWireEdmExecutionPlan(document)).toMatchObject({ ok: false, diagnostics: [{ code: 'EXECUTION_PLAN_THREADING_INVALID' }] });
    expect(classify).toHaveBeenCalledOnce();
  });

  it('retains legacy integrity-reading behavior without doing an ignored material scan', () => {
    const document = finishedContours(2, true);
    document.setup!.threadingDefault = { mode: 'continuous', wireSeparation: 'already-separated' };
    const classify = vi.spyOn(material, 'classifyPositioningMaterial');
    expect(compileWireEdmExecutionPlan(document, { legacySavedRevision: true }).ok).toBe(true);
    expect(classify.mock.calls.length).toBe(0);
  });
});
