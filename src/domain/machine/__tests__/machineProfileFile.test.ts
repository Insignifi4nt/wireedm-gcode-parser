import { describe, expect, it } from 'vitest';

import {
  createBlankMachineProfile,
  createCharmillesRobofilClassicProfile,
  createVerifiedCharmillesRobofil100Profile,
  machineProfileVerificationFingerprint,
  markMachineProfileUserVerified
} from '../machineProfiles';
import {
  parseMachineProfileFile,
  planMachineProfileImport,
  serializeMachineProfileFile
} from '../machineProfileFile';

const now = new Date('2026-07-13T09:30:00.000Z');

function portableDocument(profile: ReturnType<typeof createBlankMachineProfile>) {
  return {
    format: 'wire-edm-machine-profile',
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    profile
  };
}

function legacyVerificationFingerprint(
  profile: ReturnType<typeof createVerifiedCharmillesRobofil100Profile>
) {
  const current = JSON.parse(machineProfileVerificationFingerprint(profile));
  const {
    offsetSelection,
    activation,
    cancellation,
    lifecycleScope,
    preActivationCodes,
    templates,
    lineEnding,
    coordinatePrecision,
    ...prefix
  } = current;
  return JSON.stringify({
    ...prefix,
    enabledByDefault: profile.compensation.enabledByDefault,
    offsetSelection,
    activation,
    cancellation,
    lifecycleScope,
    preActivationCodes,
    templates,
    lineEnding,
    coordinatePrecision
  });
}

describe('portable machine profile files', () => {
  it('round-trips one versioned portable profile and resets imported verification', () => {
    const verifiedRobofil = createVerifiedCharmillesRobofil100Profile('robofil-local', now);
    verifiedRobofil.preferredDxfImportUnit = 'inches';
    const text = serializeMachineProfileFile(verifiedRobofil, now);
    const parsed = parseMachineProfileFile(text);

    expect(JSON.parse(text)).toMatchObject({
      format: 'wire-edm-machine-profile',
      schemaVersion: 1,
      exportedAt: now.toISOString()
    });
    expect(parsed.id).toBe(verifiedRobofil.id);
    expect(parsed.preferredDxfImportUnit).toBe('inches');
    expect(parsed.controller.verification.status).toBe('unverified');
    expect(parsed).toMatchObject({
      controller: {
        postVersion: 1,
        unitsCode: 'omit',
        planeCode: 'omit',
        workOffsetCode: 'omit',
        distanceMode: 'G90',
        arcCenterMode: 'absolute'
      },
      compensation: {
        cancellation: 'program-end',
        lifecycleScope: 'program',
        preActivationCodes: ['G60']
      }
    });
  });

  it('upgrades the prior enabled-by-default fingerprint while serializing local profiles', () => {
    const profile = createVerifiedCharmillesRobofil100Profile('robofil-local', now);
    profile.controller.verification.verifiedFingerprint = legacyVerificationFingerprint(profile);

    const serialized = JSON.parse(serializeMachineProfileFile(profile, now));

    expect(serialized.profile.controller.verification).toMatchObject({
      status: 'user-verified',
      verifiedFingerprint: machineProfileVerificationFingerprint(profile)
    });
    expect(serialized.profile.controller.verification.verifiedFingerprint)
      .not.toContain('enabledByDefault');
  });

  it('migrates an older schema-version-1 portable profile to conservative post defaults', () => {
    const profile = createBlankMachineProfile() as unknown as Record<string, unknown>;
    const controller = profile.controller as Record<string, unknown>;
    const compensation = profile.compensation as Record<string, unknown>;
    delete profile.preferredDxfImportUnit;
    for (const key of ['postVersion', 'unitsCode', 'planeCode', 'workOffsetCode', 'distanceMode', 'arcCenterMode']) {
      delete controller[key];
    }
    for (const key of ['lifecycleScope', 'preActivationCodes']) delete compensation[key];

    expect(parseMachineProfileFile(JSON.stringify(portableDocument(
      profile as unknown as ReturnType<typeof createBlankMachineProfile>
    )))).toMatchObject({
      preferredDxfImportUnit: null,
      controller: {
        postVersion: 1,
        unitsCode: 'omit',
        planeCode: 'omit',
        workOffsetCode: 'template-managed',
        distanceMode: 'G90',
        arcCenterMode: 'incremental-from-start',
        verification: { status: 'unverified' }
      },
      compensation: { lifecycleScope: 'operation', preActivationCodes: [] }
    });
  });

  it('rejects an invalid preferred DXF import unit at the portable boundary', () => {
    const profile = createBlankMachineProfile() as unknown as Record<string, unknown>;
    profile.preferredDxfImportUnit = 'feet';

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(
      profile as unknown as ReturnType<typeof createBlankMachineProfile>
    )))).toThrow(/preferred DXF import unit/i);
  });

  it('round-trips multibyte template content while the portable file remains under 256 KiB', () => {
    const profile = createBlankMachineProfile('multibyte-machine');
    profile.templates.header = `(${'電'.repeat(1_000)})`;

    const text = serializeMachineProfileFile(profile, now);

    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(parseMachineProfileFile(text).templates.header).toBe(profile.templates.header);
  });

  it('rejects serialization when multibyte content makes the final portable file exceed 256 KiB', () => {
    const profile = createBlankMachineProfile('oversize-multibyte-machine');
    profile.templates.header = '🙂'.repeat(32_768);
    profile.templates.footer = '🙂'.repeat(32_768);

    expect(() => serializeMachineProfileFile(profile, now)).toThrow(/256 KiB/i);
  });

  it('rejects files larger than 256 KiB before parsing', () => {
    expect(() => parseMachineProfileFile(' '.repeat(256 * 1024 + 1))).toThrow(/256 KiB/i);
  });

  it('rejects malformed JSON and unsupported wrappers', () => {
    expect(() => parseMachineProfileFile('{')).toThrow(/JSON/i);
    expect(() => parseMachineProfileFile(JSON.stringify({
      ...portableDocument(createBlankMachineProfile()),
      schemaVersion: 2
    }))).toThrow(/schema/i);
    expect(() => parseMachineProfileFile(JSON.stringify({
      ...portableDocument(createBlankMachineProfile()),
      format: 'other-profile'
    }))).toThrow(/format/i);
  });

  it('rejects non-canonical exportedAt timestamps', () => {
    expect(() => parseMachineProfileFile(JSON.stringify({
      ...portableDocument(createBlankMachineProfile()),
      exportedAt: '0'
    }))).toThrow(/exportedAt/i);
  });

  it('rejects non-canonical imported verification timestamps', () => {
    const profile = markMachineProfileUserVerified(createCharmillesRobofilClassicProfile(), now);
    profile.controller.verification.verifiedAt = '0';

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/verifiedAt/i);
  });

  it('rejects NUL template content', () => {
    const profile = createBlankMachineProfile();
    profile.templates.header = 'G40\0M30';

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/NUL/i);
  });

  it('rejects templates longer than 64 KiB', () => {
    const profile = createBlankMachineProfile();
    profile.templates.footer = 'G'.repeat(64 * 1024 + 1);

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/profile/i);
  });

  it('rejects notes longer than 16 KiB', () => {
    const profile = createBlankMachineProfile();
    profile.notes = 'n'.repeat(16 * 1024 + 1);

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(profile)))).toThrow(/profile/i);
  });

  it.each([
    { label: 'blank ID', mutate: (profile: Record<string, unknown>) => { profile.id = ' '; } },
    { label: 'unsafe ID', mutate: (profile: Record<string, unknown>) => { profile.id = '../machine'; } },
    { label: 'overlong ID', mutate: (profile: Record<string, unknown>) => { profile.id = 'a'.repeat(65); } },
    { label: 'overlong name', mutate: (profile: Record<string, unknown>) => { profile.name = 'n'.repeat(121); } },
    { label: 'invalid extension', mutate: (profile: Record<string, unknown>) => {
      (profile.output as Record<string, unknown>).extension = 'tap';
    } },
    { label: 'invalid line ending', mutate: (profile: Record<string, unknown>) => {
      (profile.output as Record<string, unknown>).lineEnding = 'native';
    } },
    { label: 'invalid precision', mutate: (profile: Record<string, unknown>) => {
      (profile.output as Record<string, unknown>).coordinatePrecision = 7;
    } },
    { label: 'invalid work area', mutate: (profile: Record<string, unknown>) => {
      (profile.workArea as Record<string, unknown>).widthMm = 0;
    } },
    { label: 'invalid controller family', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).family = 'unknown';
    } },
    { label: 'invalid post version', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).postVersion = 0;
    } },
    { label: 'invalid units code', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).unitsCode = 'G70';
    } },
    { label: 'invalid plane code', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).planeCode = 'G18';
    } },
    { label: 'invalid work-offset code', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).workOffsetCode = 'G55';
    } },
    { label: 'invalid distance mode', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).distanceMode = 'G91';
    } },
    { label: 'invalid arc-centre mode', mutate: (profile: Record<string, unknown>) => {
      ((profile.controller as Record<string, unknown>)).arcCenterMode = 'radius';
    } },
    { label: 'invalid D index', mutate: (profile: Record<string, unknown>) => {
      (((profile.compensation as Record<string, unknown>).offsetSelection) as Record<string, unknown>).index = -1;
    } },
    { label: 'invalid lead length', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).validationLeadLengthMm = 0;
    } },
    { label: 'invalid offset envelope', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).expectedMaximumOffsetMm = -0.5;
    } },
    { label: 'invalid lifecycle scope', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).lifecycleScope = 'document';
    } },
    { label: 'multiline pre-activation block', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).preActivationCodes = ['G60\nG61'];
    } },
    { label: 'non-printable pre-activation block', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).preActivationCodes = ['G60\u0007'];
    } },
    { label: 'overlong pre-activation block', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).preActivationCodes = ['G'.repeat(65)];
    } },
    { label: 'too many pre-activation blocks', mutate: (profile: Record<string, unknown>) => {
      (profile.compensation as Record<string, unknown>).preActivationCodes = Array(17).fill('G60');
    } }
  ])('rejects $label', ({ mutate }) => {
    const profile = createCharmillesRobofilClassicProfile() as unknown as Record<string, unknown>;
    mutate(profile);

    expect(() => parseMachineProfileFile(JSON.stringify(portableDocument(
      profile as unknown as ReturnType<typeof createBlankMachineProfile>
    )))).toThrow(/profile/i);
  });

  it('strips unknown keys while reconstructing an imported profile', () => {
    const document = portableDocument(createBlankMachineProfile()) as Record<string, unknown>;
    const profile = document.profile as ReturnType<typeof createBlankMachineProfile> & { injected?: string };
    profile.injected = 'discard me';
    (profile.controller as typeof profile.controller & { injected?: string }).injected = 'discard me';
    (profile.compensation as typeof profile.compensation & { injected?: string }).injected = 'discard me';
    (profile.output as typeof profile.output & { injected?: string }).injected = 'discard me';
    document.injected = 'discard me';

    const parsed = parseMachineProfileFile(JSON.stringify(document));

    expect(parsed).not.toHaveProperty('injected');
    expect(parsed.controller).not.toHaveProperty('injected');
    expect(parsed.compensation).not.toHaveProperty('injected');
    expect(parsed.output).not.toHaveProperty('injected');
  });

  it('selects the installed profile for a semantic duplicate', () => {
    const existing = markMachineProfileUserVerified(createCharmillesRobofilClassicProfile(), now);
    const imported = createCharmillesRobofilClassicProfile();

    expect(planMachineProfileImport([existing], imported)).toEqual({
      kind: 'already-installed',
      profile: existing
    });
  });

  it('adds a profile whose ID is not installed', () => {
    const imported = createBlankMachineProfile('shop-machine');

    expect(planMachineProfileImport([], imported)).toEqual({ kind: 'add', profile: imported });
  });

  it('imports a conflicting ID as a deterministic copy', () => {
    const existing = createBlankMachineProfile('shop-machine');
    existing.name = 'Shop Machine';
    const occupiedCopy = createBlankMachineProfile('shop-machine-2');
    const changed = { ...existing, notes: 'Different setup.' };

    expect(planMachineProfileImport([existing, occupiedCopy], changed)).toMatchObject({
      kind: 'copy',
      profile: { id: `${existing.id}-3`, name: `${existing.name} (3)` }
    });
  });
});
