import { describe, expect, it } from 'vitest';

import { createDefaultMachineProfile } from '@/domain/workbench/defaultProject';
import type { ConnectedWorkbench } from '@/domain/storage/workbenchStorage';

import {
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
