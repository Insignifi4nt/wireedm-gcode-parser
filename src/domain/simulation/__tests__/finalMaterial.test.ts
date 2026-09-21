import { describe, expect, it } from 'vitest';
import type { DxfEntity } from '@/domain/dxf/types';
import { setMachiningSpanParticipation } from '@/domain/path-intel/machiningParticipation';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';
import { validateUpidDocument } from '@/domain/upid/validateUpidDocument';
import { compileSimulation } from '../simulation';
import type { SimulationSettings } from '../types';

const settings: SimulationSettings = {
  stock: { originX: -20, originY: -20, width: 60, depth: 60, thickness: 10, bottomZ: 0 },
  wireDiameter: 0.25, cutSpeedMmPerSecond: 10, rapidSpeedMmPerSecond: 20, retention: 'retain'
};

function source(entities: DxfEntity[]) {
  const document = createUpidFromDxfEntities(entities, { operationOrderStrategy: 'source-order' });
  document.geometryBasis = 'wire-centre';
  document.setup = { initialWirePosition: { kind: 'manual', point: document.plan.operations[0].startPoint, review: 'reviewed' },
    threadingDefault: { mode: 'manual', wireSeparation: 'manual-before-positioning' } };
  for (const operation of document.plan.operations) operation.transitions = {
    entry: { strategy: 'none', review: 'reviewed' }, exit: { strategy: 'none', review: 'reviewed' }
  };
  return document;
}

function exclude(document: PathPlanningDocument, operationId: string) {
  let next = document;
  for (const reference of document.plan.operations.find(operation => operation.id === operationId)!.segmentRefs) {
    next = setMachiningSpanParticipation(next, { sourceSegmentId: reference.segmentId,
      range: { start: 0, end: 1 }, participation: 'inactive-reference' })!;
  }
  return next;
}

function compile(document: PathPlanningDocument) {
  const result = compileSimulation(document, settings);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.plan;
}

describe('final material participation accuracy', () => {
  it.each(['open', 'closed'] as const)('does not count a fully excluded %s reference operation as an unfinished cut', kind => {
    const document = source([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      kind === 'open'
        ? { type: 'line', layer: 'REFERENCE', start: { x: 20, y: 0 }, end: { x: 30, y: 0 } }
        : { type: 'circle', layer: 'REFERENCE', center: { x: 100, y: 0 }, radius: 3 }
    ]);
    const reference = document.plan.operations.find(operation => operation.provenance.layers.includes('REFERENCE'))!;
    const edited = exclude(document, reference.id);
    const plan = compile(edited);
    expect(plan.executionPlan.source.operationIds).not.toContain(reference.id);
    expect(plan.finalMaterial.status).toBe('ready');
    expect(plan.finalMaterial.solids).toHaveLength(1);
    expect(plan.finalMaterial.diagnostics).toEqual([]);
    expect(plan.diagnostics.filter(diagnostic => diagnostic.operationId === reference.id)).toEqual([]);
  });

  it('keeps the hole-only plate when its surrounding outline is intentionally reference-only', () => {
    const document = source([
      { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 },
      { type: 'circle', layer: 'REFERENCE', center: { x: 0, y: 0 }, radius: 10 }
    ]);
    const reference = document.plan.operations.find(operation => operation.classification === 'exterior')!;
    const edited = exclude(document, reference.id);
    const plan = compile(edited);
    expect(plan.pieces).toHaveLength(1);
    expect(plan.pieces[0].role).toBe('waste');
    expect(plan.remainingStockRole).toBe('part');
    expect(plan.finalMaterial).toMatchObject({ status: 'ready', solids: [
      { kind: 'remaining-stock', holes: [plan.pieces[0].polygon] }
    ] });
  });

  it('rejects multiple operation owners of one boundary before predicting final material', () => {
    const document = source([{ type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 5 }]);
    document.plan.operations.push({ ...structuredClone(document.plan.operations[0]), id: 'duplicate-boundary-owner', orderIndex: 1 });
    const validation = validateUpidDocument(document);
    expect(validation.blockingDiagnostics.some(diagnostic => diagnostic.message.includes('owned by multiple operations'))).toBe(true);
    expect(compileSimulation(document, settings)).toMatchObject({ ok: false,
      diagnostics: [{ code: 'EXECUTION_PLAN_INVALID_UPID' }] });
  });
});
