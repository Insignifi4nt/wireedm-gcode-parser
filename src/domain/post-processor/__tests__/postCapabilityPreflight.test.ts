import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { minimalPostPackage } from './postPackageFixture';
import { preflightPostCapabilities } from '../postCapabilityPreflight';

describe('post capability preflight', () => {
  it('reports every incompatible required semantic instead of selecting another post', () => {
    const document = createUpidFromDxfEntities([
      ...rectangle(0, 0, 10, 10),
      ...rectangle(20, 0, 30, 10)
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
      },
      threadingDefault: {
        mode: 'manual', wireSeparation: 'manual-before-positioning'
      }
    };
    document.plan.operations[0].programStops = [{
      id: 'inspect',
      enabled: true,
      placement: { kind: 'after-contour' },
      reason: 'operator-check'
    }];
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    expect(preflightPostCapabilities(compiled.plan, minimalPostPackage()))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'POST_CAPABILITY_PROGRAM_STOPS_UNSUPPORTED' }),
        expect.objectContaining({ code: 'POST_CAPABILITY_THREADING_UNSUPPORTED' }),
        expect.objectContaining({ code: 'POST_CAPABILITY_WIRE_SEPARATION_UNSUPPORTED' })
      ]));
  });

  it('accepts a package whose required event classes are all declared', () => {
    const document = createUpidFromDxfEntities(rectangle());
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: -2, y: 0 }, review: 'reviewed'
      }
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    expect(preflightPostCapabilities(compiled.plan, minimalPostPackage())).toEqual([]);
  });
});

function rectangle(minX = 0, minY = 0, maxX = 10, maxY = 10) {
  return [
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: minY }, end: { x: maxX, y: minY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: minY }, end: { x: maxX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: maxX, y: maxY }, end: { x: minX, y: maxY } },
    { type: 'line' as const, layer: 'CUT', start: { x: minX, y: maxY }, end: { x: minX, y: minY } }
  ];
}
