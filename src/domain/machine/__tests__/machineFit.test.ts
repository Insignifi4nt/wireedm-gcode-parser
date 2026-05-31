import { describe, expect, it } from 'vitest';

import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { DxfEntity } from '@/domain/dxf/types';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile } from '@/domain/workbench/types';

import { evaluateMachineFit } from '../machineFit';

describe('evaluateMachineFit', () => {
  it('passes when machine profile has no work area limits', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 20, 10));
    const profile = createDefaultMachineProfile();

    expect(evaluateMachineFit({ document, profile })).toMatchObject({
      status: 'unchecked',
      issues: []
    });
  });

  it('treats legacy machine profiles without work area as unchecked', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 20, 10));
    const legacyProfile = {
      ...createDefaultMachineProfile(),
      workArea: undefined
    } as unknown as MachineProfile;

    expect(evaluateMachineFit({ document, profile: legacyProfile })).toMatchObject({
      status: 'unchecked',
      issues: []
    });
  });

  it('detects imported geometry wider than the active machine profile work area', () => {
    const document = createPathPlanningDocumentFromDxfEntities(rectangleLines(0, 0, 20, 10));
    const profile = {
      ...createDefaultMachineProfile(),
      workArea: {
        widthMm: 15,
        lengthMm: 12
      }
    };

    expect(evaluateMachineFit({ document, profile })).toMatchObject({
      status: 'too-large',
      bounds: {
        widthMm: 20,
        lengthMm: 10
      },
      issues: [
        {
          axis: 'width',
          actualMm: 20,
          limitMm: 15
        }
      ]
    });
  });
});

function rectangleLines(minX: number, minY: number, maxX: number, maxY: number): DxfEntity[] {
  return [
    line(minX, minY, maxX, minY),
    line(maxX, minY, maxX, maxY),
    line(maxX, maxY, minX, maxY),
    line(minX, maxY, minX, minY)
  ];
}

function line(startX: number, startY: number, endX: number, endY: number): DxfEntity {
  return {
    type: 'line',
    layer: 'CUT',
    start: { x: startX, y: startY },
    end: { x: endX, y: endY }
  };
}
