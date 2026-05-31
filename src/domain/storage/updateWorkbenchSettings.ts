import { normalizeMachineProfile, normalizeOutput, upsertMachineProfile } from '@/domain/machine/machineProfiles';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  FOOTER_TEMPLATE_PATH,
  HEADER_TEMPLATE_PATH,
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from './workbenchStorage';

export interface UpdateWorkbenchSettingsInput {
  header?: string;
  footer?: string;
  machineProfile?: MachineProfile;
  output?: Partial<WorkbenchManifest['output']>;
  now?: Date;
}

export async function updateWorkbenchSettings(
  workbench: ConnectedWorkbench,
  input: UpdateWorkbenchSettingsInput
): Promise<ConnectedWorkbench> {
  const outputBase = input.machineProfile?.output ?? workbench.manifest.output;
  const output = normalizeOutput({
    ...outputBase,
    ...input.output
  });
  const activeMachineProfile = normalizeMachineProfile({
    ...workbench.activeMachineProfile,
    ...input.machineProfile,
    templates: {
      header: input.header ?? input.machineProfile?.templates.header ?? workbench.activeMachineProfile.templates.header,
      footer: input.footer ?? input.machineProfile?.templates.footer ?? workbench.activeMachineProfile.templates.footer
    },
    output
  });
  const machineProfiles = upsertMachineProfile(workbench.manifest.machineProfiles, activeMachineProfile);

  const updatedManifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: (input.now ?? new Date()).toISOString(),
    output: activeMachineProfile.output,
    activeMachineProfileId: activeMachineProfile.id,
    machineProfiles
  };

  await workbench.adapter.writeText(HEADER_TEMPLATE_PATH, activeMachineProfile.templates.header);
  await workbench.adapter.writeText(FOOTER_TEMPLATE_PATH, activeMachineProfile.templates.footer);
  await workbench.adapter.writeText(
    WORKBENCH_MANIFEST_FILE,
    JSON.stringify(updatedManifest, null, 2)
  );

  return {
    ...workbench,
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer,
    manifest: updatedManifest
  };
}
