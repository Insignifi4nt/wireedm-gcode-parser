import { describe, expect, it } from 'vitest';

import type { DxfEntity } from '@/domain/dxf/types';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';

import { evaluatePhysicalMachineFit } from '../machineFit';
import { machineDefinitionFixture, machineDefinitionValue } from './machineDefinitionFixture';
import { parseMachineDefinition } from '../machineDefinition';

describe('physical machine fit', () => {
  it('keeps a missing planning-machine selection explicit', () => {
    expect(evaluatePhysicalMachineFit({ document: rectangle(20, 10), machine: null })).toEqual({
      ok: true,
      fit: {
        status: 'not-evaluated',
        reason: 'no-machine-selected',
        bounds: { xSpanMm: 20, ySpanMm: 10 }
      }
    });
  });

  it('reports an indeterminate result when a physical travel limit is unknown', () => {
    expect(evaluatePhysicalMachineFit({
      document: rectangle(20, 10),
      machine: machineDefinitionFixture()
    })).toEqual({
      ok: true,
      fit: {
        status: 'indeterminate',
        bounds: { xSpanMm: 20, ySpanMm: 10 },
        unknownAxes: ['y']
      }
    });
  });

  it('returns a definitive failure when a known axis is exceeded even if another is unknown', () => {
    expect(evaluatePhysicalMachineFit({
      document: rectangle(240, 10),
      machine: machineDefinitionFixture()
    })).toEqual({
      ok: true,
      fit: {
        status: 'too-large',
        bounds: { xSpanMm: 240, ySpanMm: 10 },
        issues: [{ axis: 'x', actualMm: 240, limitMm: 220 }]
      }
    });
  });

  it('reports fit only when every physical axis limit is known and satisfied', () => {
    const value = machineDefinitionValue();
    value.limits.yTravel = { status: 'known', millimeters: 120 };
    const parsed = parseMachineDefinition(JSON.stringify(value));
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));

    expect(evaluatePhysicalMachineFit({ document: rectangle(20, 10), machine: parsed.machine })).toEqual({
      ok: true,
      fit: { status: 'fits', bounds: { xSpanMm: 20, ySpanMm: 10 } }
    });
  });

  it('returns a diagnostic instead of treating empty geometry as unchecked', () => {
    const empty = createPathPlanningDocumentFromDxfEntities([]);
    expect(evaluatePhysicalMachineFit({ document: empty, machine: null })).toEqual({
      ok: false,
      error: {
        code: 'MACHINE_FIT_GEOMETRY_EMPTY',
        message: 'Machine fit cannot be evaluated because the UPID contains no geometry.'
      }
    });
  });
});

function rectangle(width: number, height: number) {
  return createPathPlanningDocumentFromDxfEntities([
    line(0, 0, width, 0),
    line(width, 0, width, height),
    line(width, height, 0, height),
    line(0, height, 0, 0)
  ]);
}

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
