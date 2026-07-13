import { describe, expect, it } from 'vitest';

import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile, OutputFormat } from '@/domain/workbench/types';

import {
  createBlankMachineProfile,
  createCharmillesRobofilClassicProfile,
  machineProfileVerificationFingerprint,
  markMachineProfileUserVerified,
  normalizeCoordinatePrecision,
  normalizeMachineProfile,
  normalizeOutput
} from '../machineProfiles';

describe('machine profile policies', () => {
  it('creates a blank editable G40-only machine profile', () => {
    expect(createBlankMachineProfile('new-wire-machine')).toMatchObject({
      id: 'new-wire-machine',
      name: 'Untitled Wire EDM',
      controller: { family: 'custom', verification: { status: 'unverified' } },
      compensation: { supported: false, enabledByDefault: false },
      templates: { header: '', footer: '' }
    });
  });

  it('normalizes legacy profiles without enabling compensation', () => {
    const legacyProfile = createDefaultMachineProfile() as unknown as Omit<
      MachineProfile,
      'controller' | 'compensation'
    >;
    delete (legacyProfile as Partial<MachineProfile>).controller;
    delete (legacyProfile as Partial<MachineProfile>).compensation;

    expect(normalizeMachineProfile(legacyProfile).compensation).toMatchObject({
      supported: false,
      enabledByDefault: false
    });
  });

  it('resets verification when controller-sensitive settings change', () => {
    const now = new Date('2026-07-13T09:30:00.000Z');
    const verified = markMachineProfileUserVerified(createCharmillesRobofilClassicProfile(), now);

    expect(verified.controller.verification).toEqual({
      status: 'user-verified',
      verifiedAt: now.toISOString(),
      verifiedFingerprint: machineProfileVerificationFingerprint(verified)
    });
    expect(normalizeMachineProfile({
      ...verified,
      compensation: { ...verified.compensation, offsetSelection: { address: 'D', index: 1 } }
    }).controller.verification.status).toBe('unverified');
  });

  it('preserves verification across non-controller-sensitive edits', () => {
    const verified = markMachineProfileUserVerified(
      createCharmillesRobofilClassicProfile(),
      new Date('2026-07-13T09:30:00.000Z')
    );

    expect(normalizeMachineProfile({ ...verified, name: 'Shop Robofil' }).controller.verification)
      .toEqual(verified.controller.verification);
  });

  it('does not share mutable verification state between profiles', () => {
    const first = createBlankMachineProfile('first-machine');
    const second = createBlankMachineProfile('second-machine');

    first.controller.verification.status = 'user-verified';

    expect(second.controller.verification.status).toBe('unverified');
  });
});

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
