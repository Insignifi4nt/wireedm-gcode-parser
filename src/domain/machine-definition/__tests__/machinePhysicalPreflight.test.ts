import { describe, expect, it } from 'vitest';

import { compileWireEdmExecutionPlan } from '@/domain/execution-plan/executionPlan';
import { createUpidFromDxfEntities } from '@/domain/upid/upidDocument';

import { parseMachineDefinition } from '../machineDefinition';
import { preflightMachinePhysicalRequirements } from '../machinePhysicalPreflight';
import { machineDefinitionValue } from './machineDefinitionFixture';

describe('physical travel required by the compiled plan', () => {
  it.each(['initial-position', 'entry', 'exit'] as const)('includes %s travel outside the contour', (kind) => {
    const document = createUpidFromDxfEntities([
      { type: 'line', layer: 'CUT', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }
    ]);
    document.setup = {
      initialWirePosition: {
        kind: 'manual', point: { x: kind === 'initial-position' ? -500 : 0, y: 0 }, review: 'reviewed'
      }
    };
    if (kind === 'entry') {
      document.plan.operations[0].transitions = {
        entry: { strategy: 'manual-straight', from: { x: -500, y: 0 }, to: { x: 0, y: 0 }, move: 'cut', review: 'reviewed' }
      };
    } else if (kind === 'exit') {
      document.plan.operations[0].transitions = {
        exit: { strategy: 'manual-straight', from: { x: 10, y: 0 }, to: { x: 510, y: 0 }, move: 'cut', review: 'reviewed' }
      };
    }
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    expect(preflightMachinePhysicalRequirements({ plan: compiled.plan, machine: machine() })).toMatchObject({
      ok: false,
      error: {
        code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_EXCEEDED',
        issues: [{ axis: 'x', actualMm: 510, limitMm: 220 }]
      }
    });
  });

  it.each(['circle', 'arc'] as const)('includes interior extrema of a %s instead of endpoints only', (kind) => {
    const document = createUpidFromDxfEntities([kind === 'circle'
      ? { type: 'circle', layer: 'CUT', center: { x: 0, y: 0 }, radius: 150 }
      : {
          type: 'arc', layer: 'CUT', center: { x: 0, y: 0 }, radius: 150,
          startAngle: 0, endAngle: 180, clockwise: false,
          start: { x: 150, y: 0 }, end: { x: -150, y: 0 }
        }
    ]);
    document.setup = {
      initialWirePosition: { kind: 'manual', point: document.plan.operations[0].startPoint, review: 'reviewed' }
    };
    const compiled = compileWireEdmExecutionPlan(document);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));

    expect(preflightMachinePhysicalRequirements({ plan: compiled.plan, machine: machine(400) })).toMatchObject({
      ok: false,
      error: { code: 'MACHINE_PHYSICAL_PREFLIGHT_TRAVEL_EXCEEDED' }
    });
  });
});

function machine(xTravel = 220) {
  const value = machineDefinitionValue();
  value.limits.xTravel = { status: 'known', millimeters: xTravel };
  value.limits.yTravel = { status: 'known', millimeters: 100 };
  const parsed = parseMachineDefinition(JSON.stringify(value));
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
  return parsed.machine;
}
