import { describe, expect, it } from 'vitest';

import { setManualCompensationIntent } from '@/domain/compensation/intent';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { compileWireEdmExecutionPlan } from '../executionPlan';

describe('controller-neutral Wire EDM execution plans', () => {
  it('compiles reviewed geometry and compensation intent without controller vocabulary', () => {
    const source = rectangleDocument();
    source.geometryBasis = 'finished-contour';
    const operation = source.plan.operations[0];
    const document = setManualCompensationIntent(source, operation.id, 'outside');
    if (!document) throw new Error('Expected a closed contour fixture.');

    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    expect(result.plan.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'program-start', initialWirePosition: { x: -2, y: 0 } }),
      expect.objectContaining({ kind: 'compensation-start', wireSide: 'left' }),
      expect.objectContaining({ kind: 'motion', role: 'contour', sourceSegmentId: expect.any(String) }),
      expect.objectContaining({ kind: 'compensation-end' })
    ]));
    expect(result.plan.requirements).toMatchObject({
      controllerCompensation: true,
      operationCount: 1,
      programStops: false,
      threading: []
    });
    expect(JSON.stringify(result.plan)).not.toMatch(/\b[GMT]\d+/);
  });

  it('requires a reviewed initial wire position instead of assuming an origin', () => {
    const document = createUpidFromDxfEntities(rectangle());

    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'EXECUTION_PLAN_INITIAL_WIRE_REQUIRED', operationId: null }]
    });
  });

  it('requires explicit threading intent between operations', () => {
    const document = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 10),
      ...rectangle(20, 0, 30, 10)
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
      }
    };

    expect(compileWireEdmExecutionPlan(document)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'EXECUTION_PLAN_THREADING_REQUIRED' }]
    });

    document.setup.threadingDefault = {
      mode: 'manual',
      wireSeparation: 'manual-before-positioning'
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
    expect(compiled.plan.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'wire-separate',
        method: 'manual'
      }),
      expect.objectContaining({ kind: 'wire-thread', method: 'manual' })
    ]));
    expect(compiled.plan.requirements).toMatchObject({
      threading: ['manual'],
      wireSeparation: true
    });
  });

  it('represents an explicit continuous transition between disconnected closed contours', () => {
    const document = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 10),
      ...rectangle(20, 0, 30, 10)
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: 0, y: 0 }, review: 'reviewed'
      }
    };
    document.plan.operations[1].threadingTransition = {
      mode: 'continuous',
      wireSeparation: 'already-separated',
      source: 'operation-override'
    };

    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    expect(compiled.plan.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'wire-continue' }),
      expect.objectContaining({
        kind: 'position',
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 }
      })
    ]));
    expect(compiled.plan.requirements).toMatchObject({
      threading: [],
      wireSeparation: false
    });
  });

  it('splits contour motion around an exact remaining-distance program stop', () => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
      }
    };
    document.plan.operations[0].programStops = [{
      id: 'retain-part',
      enabled: true,
      placement: { kind: 'before-operation-end', remainingCutLengthMm: 2 },
      reason: 'part-retention'
    }];

    const result = compileWireEdmExecutionPlan(document);
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
    const ordered = result.plan.events.filter(({ kind }) => kind === 'motion' || kind === 'program-stop');
    expect(ordered).toEqual([
      expect.objectContaining({ kind: 'motion', start: { x: 0, y: 0 }, end: { x: 8, y: 0 } }),
      expect.objectContaining({ kind: 'program-stop', stopId: 'retain-part', point: { x: 8, y: 0 } }),
      expect.objectContaining({ kind: 'motion', start: { x: 8, y: 0 }, end: { x: 10, y: 0 } })
    ]);
  });
});

function rectangleDocument() {
  const document = createUpidFromDxfEntities(rectangle());
  document.setup = {
    initialWirePosition: {
      kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
    }
  };
  return document;
}

function rectangle(minX = 0, minY = 0, maxX = 10, maxY = 10) {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
  ];
}
