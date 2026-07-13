import { describe, expect, it } from 'vitest';

import {
  createBlankMachineProfile,
  createVerifiedCharmillesRobofil100Profile,
  machineProfileVerificationFingerprint
} from '@/domain/machine/machineProfiles';
import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import {
  acknowledgeMachineProfileFromSettingsDraft,
  applySettingsDraftPatch,
  machineProfileFromSettingsDraft,
  settingsDraftFromWorkbench,
  workbenchSettingsInputFromDraft
} from './workbenchSettings';

describe('settingsDraftFromWorkbench', () => {
  it('keeps the same source key when only manifest updatedAt changes', () => {
    const workbench = createWorkbench('2026-07-12T10:00:00.000Z');
    const initialDraft = settingsDraftFromWorkbench(workbench);
    const refreshedDraft = settingsDraftFromWorkbench({
      ...workbench,
      manifest: {
        ...workbench.manifest,
        updatedAt: '2026-07-12T10:01:00.000Z'
      }
    });

    expect(refreshedDraft.sourceKey).toBe(initialDraft.sourceKey);
  });

  it('uses adapter name to distinguish same-kind workbenches', () => {
    const browserCacheDraft = settingsDraftFromWorkbench(
      createWorkbench('2026-07-12T10:00:00.000Z', 'Browser cache')
    );
    const secondaryCacheDraft = settingsDraftFromWorkbench(
      createWorkbench('2026-07-12T10:00:00.000Z', 'Secondary cache')
    );

    expect(secondaryCacheDraft.sourceKey).not.toBe(browserCacheDraft.sourceKey);
  });

  it('keys drafts by coordinate precision and saves it through both output paths', () => {
    const workbench = createWorkbench('2026-07-12T10:00:00.000Z');
    const initialDraft = settingsDraftFromWorkbench(workbench);
    const higherPrecisionWorkbench = {
      ...workbench,
      manifest: {
        ...workbench.manifest,
        output: {
          ...workbench.manifest.output,
          coordinatePrecision: 5
        }
      },
      activeMachineProfile: {
        ...workbench.activeMachineProfile,
        output: {
          ...workbench.activeMachineProfile.output,
          coordinatePrecision: 5
        }
      }
    };
    const higherPrecisionDraft = settingsDraftFromWorkbench(higherPrecisionWorkbench);

    expect(initialDraft.coordinatePrecision).toBe('3');
    expect(higherPrecisionDraft.coordinatePrecision).toBe('5');
    expect(higherPrecisionDraft.sourceKey).not.toBe(initialDraft.sourceKey);
    expect(
      workbenchSettingsInputFromDraft(higherPrecisionWorkbench, higherPrecisionDraft)
    ).toMatchObject({
      machineProfile: {
        output: { coordinatePrecision: 5 }
      },
      output: { coordinatePrecision: 5 }
    });
  });

  it('creates a complete draft for a selected inactive profile', () => {
    const workbench = createWorkbench('2026-07-12T10:00:00.000Z');
    const inactive = createVerifiedCharmillesRobofil100Profile(
      'robofil-100',
      new Date('2026-07-13T12:00:00.000Z')
    );
    workbench.manifest.machineProfiles.push(inactive);

    const draft = settingsDraftFromWorkbench(workbench, inactive.id);

    expect(draft).toMatchObject({
      profileId: 'robofil-100',
      machineName: 'Charmilles Robofil 100 / Classic (verified 2026-07-13)',
      controllerFamily: 'charmilles-robofil-classic',
      postVersion: '1',
      verificationStatus: 'user-verified',
      compensationSupported: true,
      compensationEnabledByDefault: true,
      dRegisterIndex: '0',
      activation: 'charmilles-g38',
      cancellation: 'program-end',
      lifecycleScope: 'program',
      preActivationCodes: 'G60',
      validationLeadLengthMm: '2',
      expectedMaximumOffsetMm: '0.5',
      blockFormatting: 'spaced',
      coordinateSystem: 'wire-position-g92',
      unitsCode: 'omit',
      planeCode: 'omit',
      workOffsetCode: 'omit',
      distanceMode: 'G90',
      arcCenterMode: 'absolute',
      programEnd: 'M02',
      header: '',
      footer: ''
    });
    expect(workbench.manifest.activeMachineProfileId).toBe('default-wire-machine');
  });

  it('resets verification for exactly controller-sensitive draft edits', () => {
    const profile = createVerifiedCharmillesRobofil100Profile(
      'robofil-100',
      new Date('2026-07-13T12:00:00.000Z')
    );
    const workbench = createWorkbench('2026-07-12T10:00:00.000Z');
    workbench.manifest.machineProfiles = [profile];
    workbench.manifest.activeMachineProfileId = profile.id;
    workbench.activeMachineProfile = profile;
    const draft = settingsDraftFromWorkbench(workbench, profile.id);

    expect(applySettingsDraftPatch(profile, draft, { machineName: 'Shop Robofil' }).verificationStatus)
      .toBe('user-verified');
    expect(
      applySettingsDraftPatch(profile, draft, { expectedMaximumOffsetMm: '0.75' })
        .verificationStatus
    ).toBe('user-verified');
    expect(applySettingsDraftPatch(profile, draft, { dRegisterIndex: '1' }).verificationStatus)
      .toBe('unverified');
    expect(applySettingsDraftPatch(profile, draft, { header: 'G60' }).verificationStatus)
      .toBe('unverified');
  });

  it('uses the shared helper when verification is explicitly acknowledged', () => {
    const profile = createBlankMachineProfile('custom-machine');
    const workbench = createWorkbench('2026-07-12T10:00:00.000Z');
    workbench.manifest.machineProfiles = [profile];
    const draft = settingsDraftFromWorkbench(workbench, profile.id);
    const now = new Date('2026-07-13T15:00:00.000Z');

    const acknowledged = acknowledgeMachineProfileFromSettingsDraft(profile, draft, now);

    expect(acknowledged.controller.verification).toEqual({
      status: 'user-verified',
      verifiedAt: now.toISOString(),
      verifiedFingerprint: machineProfileVerificationFingerprint(acknowledged)
    });
  });

  it('strictly rejects invalid drafts while preserving blank templates', () => {
    const profile = createBlankMachineProfile('custom-machine');
    const workbench = createWorkbench('2026-07-12T10:00:00.000Z');
    workbench.manifest.machineProfiles = [profile];
    const draft = settingsDraftFromWorkbench(workbench, profile.id);

    expect(machineProfileFromSettingsDraft(profile, draft).templates).toEqual({
      header: '',
      footer: ''
    });
    expect(() =>
      machineProfileFromSettingsDraft(profile, { ...draft, postVersion: '0' })
    ).toThrow(/post version/i);
    expect(() =>
      machineProfileFromSettingsDraft(profile, {
        ...draft,
        compensationSupported: true,
        activation: 'linear-lead',
        expectedMaximumOffsetMm: ''
      })
    ).toThrow(/expected maximum offset/i);
  });
});

function createWorkbench(updatedAt: string, adapterName = 'Browser cache'): ConnectedWorkbench {
  const activeMachineProfile = createDefaultMachineProfile();

  return {
    adapter: {
      name: adapterName,
      kind: 'browser-cache',
      ensureDirectory: async () => undefined,
      readText: async () => null,
      deleteText: async () => undefined,
      writeText: async () => undefined
    },
    manifest: {
      schemaVersion: 1,
      name: 'Workbench',
      createdAt: '2026-07-12T10:00:00.000Z',
      updatedAt,
      templates: {
        headerPath: 'templates/header.gcode',
        footerPath: 'templates/footer.gcode'
      },
      output: activeMachineProfile.output,
      activeMachineProfileId: activeMachineProfile.id,
      machineProfiles: [activeMachineProfile],
      projects: []
    },
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer
  };
}
