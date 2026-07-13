import { normalizeMachineProfile, normalizeOutput } from '@/domain/machine/machineProfiles';
import type { MachineProfile } from '@/domain/workbench/types';

import { updateMachineProfileLibrary } from './updateMachineProfileLibrary';
import type { ConnectedWorkbench, WorkbenchManifest } from './workbenchStorage';

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
    id: workbench.activeMachineProfile.id,
    templates: {
      header: input.header ?? input.machineProfile?.templates.header ?? workbench.activeMachineProfile.templates.header,
      footer: input.footer ?? input.machineProfile?.templates.footer ?? workbench.activeMachineProfile.templates.footer
    },
    output
  });

  return updateMachineProfileLibrary(
    workbench,
    { kind: 'replace', profile: activeMachineProfile },
    input.now
  );
}
