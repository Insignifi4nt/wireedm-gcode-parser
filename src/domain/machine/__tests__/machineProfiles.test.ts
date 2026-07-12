import { describe, expect, it } from 'vitest';

import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile, OutputFormat } from '@/domain/workbench/types';

import {
  normalizeCoordinatePrecision,
  normalizeMachineProfile,
  normalizeOutput
} from '../machineProfiles';

describe('machine profile output precision', () => {
  it('uses three decimal places for the default machine and legacy profiles', () => {
    const fallback = createDefaultMachineProfile();
    const legacy = {
      ...fallback,
      output: {
        extension: 'iso',
        lineEnding: 'crlf'
      }
    } as unknown as MachineProfile;

    expect(fallback.output.coordinatePrecision).toBe(3);
    expect(normalizeMachineProfile(legacy).output.coordinatePrecision).toBe(3);
  });

  it.each([0, 1, 3, 6])('retains allowed integer precision %s', (coordinatePrecision) => {
    const output = normalizeOutput({
      extension: 'iso',
      lineEnding: 'lf',
      coordinatePrecision
    });

    expect(output.coordinatePrecision).toBe(coordinatePrecision);
  });

  it.each([
    { label: 'missing', value: undefined },
    { label: 'negative', value: -1 },
    { label: 'over maximum', value: 7 },
    { label: 'fractional', value: 2.5 },
    { label: 'NaN', value: Number.NaN },
    { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
    { label: 'numeric string', value: '5' }
  ])('normalizes $label precision to 3 instead of clamping or coercing', ({ value }) => {
    expect(normalizeCoordinatePrecision(value)).toBe(3);

    const output = normalizeOutput({
      extension: 'gcode',
      lineEnding: 'crlf',
      coordinatePrecision: value
    } as unknown as OutputFormat);
    expect(output.coordinatePrecision).toBe(3);
  });
});
