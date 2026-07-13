import { describe, expect, it } from 'vitest';

import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { MachineProfile, OutputFormat } from '@/domain/workbench/types';

import {
  createBlankMachineProfile,
  createCharmillesRobofilClassicProfile,
  createVerifiedCharmillesRobofil100Profile,
  machineProfileVerificationFingerprint,
  markMachineProfileUserVerified,
  normalizeCoordinatePrecision,
  normalizeMachineProfile,
  normalizeOutput
} from '../machineProfiles';

describe('machine profile policies', () => {
  it('creates the physically verified Robofil 100 version-1 post policy', () => {
    const verifiedAt = new Date('2026-07-13T09:30:00.000Z');

    expect(createVerifiedCharmillesRobofil100Profile('robofil-local', verifiedAt)).toMatchObject({
      id: 'robofil-local',
      name: 'Charmilles Robofil 100 / Classic (verified 2026-07-13)',
      controller: {
        family: 'charmilles-robofil-classic',
        postVersion: 1,
        verification: { status: 'user-verified', verifiedAt: verifiedAt.toISOString() },
        coordinateSystem: 'wire-position-g92',
        unitsCode: 'omit',
        planeCode: 'omit',
        workOffsetCode: 'omit',
        distanceMode: 'G90',
        arcCenterMode: 'absolute',
        programEnd: 'M02'
      },
      compensation: {
        supported: true,
        enabledByDefault: true,
        offsetSelection: { address: 'D', index: 0 },
        activation: 'charmilles-g38',
        cancellation: 'program-end',
        lifecycleScope: 'program',
        preActivationCodes: ['G60']
      },
      templates: { header: '', footer: '' },
      output: { extension: 'iso', lineEnding: 'crlf', coordinatePrecision: 3 }
    });
  });

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

    expect(normalizeMachineProfile(legacyProfile)).toMatchObject({
      controller: {
        family: 'generic-iso',
        postVersion: 1,
        verification: { status: 'unverified' },
        unitsCode: 'omit',
        planeCode: 'omit',
        workOffsetCode: 'template-managed',
        distanceMode: 'G90',
        arcCenterMode: 'incremental-from-start'
      },
      compensation: {
        supported: false,
        enabledByDefault: false,
        lifecycleScope: 'operation',
        preActivationCodes: []
      }
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

  it('treats enabled-by-default as an initialization preference outside the safety fingerprint', () => {
    const verified = createVerifiedCharmillesRobofil100Profile();
    const changed = structuredClone(verified);
    changed.compensation.enabledByDefault = false;

    expect(machineProfileVerificationFingerprint(verified)).not.toContain('enabledByDefault');
    expect(normalizeMachineProfile(changed).controller.verification).toEqual(
      verified.controller.verification
    );
  });

  it('migrates the prior enabled-by-default fingerprint without losing verification', () => {
    const verified = createVerifiedCharmillesRobofil100Profile();
    verified.controller.verification.verifiedFingerprint = legacyVerificationFingerprint(verified);

    const migrated = normalizeMachineProfile(verified);

    expect(migrated.controller.verification).toMatchObject({
      status: 'user-verified',
      verifiedAt: verified.controller.verification.verifiedAt,
      verifiedFingerprint: machineProfileVerificationFingerprint(migrated)
    });
    expect(migrated.controller.verification.verifiedFingerprint).not.toContain('enabledByDefault');
  });

  it.each([
    ['post version', (profile: MachineProfile) => { profile.controller.postVersion = 2; }],
    ['units emission', (profile: MachineProfile) => { profile.controller.unitsCode = 'G21'; }],
    ['plane emission', (profile: MachineProfile) => { profile.controller.planeCode = 'G17'; }],
    ['work-offset emission', (profile: MachineProfile) => { profile.controller.workOffsetCode = 'G54'; }],
    ['arc-centre mode', (profile: MachineProfile) => { profile.controller.arcCenterMode = 'incremental-from-start'; }],
    ['lifecycle scope', (profile: MachineProfile) => { profile.compensation.lifecycleScope = 'operation'; }],
    ['pre-activation code', (profile: MachineProfile) => { profile.compensation.preActivationCodes = ['G61']; }],
    ['D index', (profile: MachineProfile) => { profile.compensation.offsetSelection.index = 1; }],
    ['header', (profile: MachineProfile) => { profile.templates.header = '%'; }],
    ['footer', (profile: MachineProfile) => { profile.templates.footer = '%'; }],
    ['line ending', (profile: MachineProfile) => { profile.output.lineEnding = 'lf'; }],
    ['precision', (profile: MachineProfile) => { profile.output.coordinatePrecision = 4; }]
  ])('resets verification after changing %s', (_label, mutate) => {
    const verified = createVerifiedCharmillesRobofil100Profile();
    const changed = JSON.parse(JSON.stringify(verified)) as MachineProfile;
    mutate(changed);

    expect(normalizeMachineProfile(changed).controller.verification.status).toBe('unverified');
  });

  it.each([
    ['ID', (profile: MachineProfile) => { profile.id = 'shop-robofil'; }],
    ['name', (profile: MachineProfile) => { profile.name = 'Shop Robofil'; }],
    ['notes', (profile: MachineProfile) => { profile.notes = 'Local note'; }],
    ['extension', (profile: MachineProfile) => { profile.output.extension = 'nc'; }]
  ])('preserves verification after changing only %s', (_label, mutate) => {
    const verified = createVerifiedCharmillesRobofil100Profile();
    const changed = JSON.parse(JSON.stringify(verified)) as MachineProfile;
    mutate(changed);

    expect(normalizeMachineProfile(changed).controller.verification)
      .toEqual(verified.controller.verification);
  });

  it('does not share mutable verification state between profiles', () => {
    const first = createBlankMachineProfile('first-machine');
    const second = createBlankMachineProfile('second-machine');

    first.controller.verification.status = 'user-verified';

    expect(second.controller.verification.status).toBe('unverified');
  });
});

function legacyVerificationFingerprint(profile: MachineProfile) {
  return JSON.stringify({
    family: profile.controller.family,
    postVersion: profile.controller.postVersion,
    blockFormatting: profile.controller.blockFormatting,
    coordinateSystem: profile.controller.coordinateSystem,
    unitsCode: profile.controller.unitsCode,
    planeCode: profile.controller.planeCode,
    workOffsetCode: profile.controller.workOffsetCode,
    distanceMode: profile.controller.distanceMode,
    arcCenterMode: profile.controller.arcCenterMode,
    programEnd: profile.controller.programEnd,
    supported: profile.compensation.supported,
    enabledByDefault: profile.compensation.enabledByDefault,
    offsetSelection: profile.compensation.offsetSelection,
    activation: profile.compensation.activation,
    cancellation: profile.compensation.cancellation,
    lifecycleScope: profile.compensation.lifecycleScope,
    preActivationCodes: profile.compensation.preActivationCodes,
    templates: profile.templates,
    lineEnding: profile.output.lineEnding,
    coordinatePrecision: profile.output.coordinatePrecision
  });
}

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
