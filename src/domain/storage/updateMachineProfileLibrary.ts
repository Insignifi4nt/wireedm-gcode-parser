import { planMachineProfileImport } from '@/domain/machine/machineProfileFile';
import { normalizeMachineProfile } from '@/domain/machine/machineProfiles';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  FOOTER_TEMPLATE_PATH,
  HEADER_TEMPLATE_PATH,
  writeWorkbenchManifest,
  type ConnectedWorkbench,
  type WorkbenchManifest
} from './workbenchStorage';

const MAX_PROFILE_ID_LENGTH = 64;
const MAX_PROFILE_NAME_LENGTH = 120;

export type MachineProfileLibraryAction =
  | { kind: 'add'; profile: MachineProfile }
  | { kind: 'replace'; profile: MachineProfile }
  | { kind: 'delete'; profileId: string }
  | { kind: 'select-active'; profileId: string };

export async function updateMachineProfileLibrary(
  workbench: ConnectedWorkbench,
  action: MachineProfileLibraryAction,
  now: Date = new Date()
): Promise<ConnectedWorkbench> {
  const profiles = workbench.manifest.machineProfiles.map(normalizeMachineProfile);
  if (profiles.length === 0) {
    throw new Error('Machine profile library must contain at least one profile.');
  }

  let machineProfiles: MachineProfile[];
  let activeMachineProfileId = workbench.manifest.activeMachineProfileId;
  let writesActiveMirrors = false;

  switch (action.kind) {
    case 'add': {
      const added = normalizeMachineProfile(action.profile);
      requireUniqueProfileId(profiles, added.id);
      machineProfiles = [...profiles, added];
      break;
    }
    case 'replace': {
      const replacement = normalizeMachineProfile(action.profile);
      const replacementIndex = requireProfileIndex(profiles, replacement.id);
      machineProfiles = profiles.map((profile, index) =>
        index === replacementIndex ? replacement : profile
      );
      writesActiveMirrors = replacement.id === activeMachineProfileId;
      break;
    }
    case 'delete': {
      const deletedIndex = requireProfileIndex(profiles, action.profileId);
      if (profiles.length === 1) {
        throw new Error('Cannot delete the final machine profile.');
      }
      machineProfiles = profiles.filter((_, index) => index !== deletedIndex);
      if (action.profileId === activeMachineProfileId) {
        activeMachineProfileId = machineProfiles[0].id;
        writesActiveMirrors = true;
      }
      break;
    }
    case 'select-active': {
      requireProfileIndex(profiles, action.profileId);
      machineProfiles = profiles;
      activeMachineProfileId = action.profileId;
      writesActiveMirrors = true;
      break;
    }
  }

  const activeMachineProfile = machineProfiles.find(
    (profile) => profile.id === activeMachineProfileId
  );
  if (!activeMachineProfile) {
    throw new Error(`Active machine profile not found: ${activeMachineProfileId}`);
  }

  const manifest: WorkbenchManifest = {
    ...workbench.manifest,
    updatedAt: now.toISOString(),
    output: writesActiveMirrors ? activeMachineProfile.output : workbench.manifest.output,
    activeMachineProfileId,
    machineProfiles,
    projects: workbench.manifest.projects
  };

  if (writesActiveMirrors) {
    await workbench.adapter.writeText(
      HEADER_TEMPLATE_PATH,
      activeMachineProfile.templates.header
    );
    await workbench.adapter.writeText(
      FOOTER_TEMPLATE_PATH,
      activeMachineProfile.templates.footer
    );
  }
  await writeWorkbenchManifest(workbench.adapter, manifest);

  return {
    ...workbench,
    manifest,
    activeMachineProfile,
    header: writesActiveMirrors ? activeMachineProfile.templates.header : workbench.header,
    footer: writesActiveMirrors ? activeMachineProfile.templates.footer : workbench.footer
  };
}

export function addMachineProfile(
  workbench: ConnectedWorkbench,
  profile: MachineProfile,
  now: Date = new Date()
) {
  return updateMachineProfileLibrary(workbench, { kind: 'add', profile }, now);
}

export function duplicateMachineProfile(
  workbench: ConnectedWorkbench,
  profileId: string,
  now: Date = new Date()
) {
  const profiles = workbench.manifest.machineProfiles.map(normalizeMachineProfile);
  const source = profiles[requireProfileIndex(profiles, profileId)];
  const occupiedIds = new Set(profiles.map((profile) => profile.id));
  const occupiedNames = new Set(profiles.map((profile) => profile.name));
  let copyNumber = 2;
  let copyId = suffixedId(source.id, copyNumber);
  let copyName = suffixedName(source.name, copyNumber);

  while (occupiedIds.has(copyId) || occupiedNames.has(copyName)) {
    copyNumber += 1;
    copyId = suffixedId(source.id, copyNumber);
    copyName = suffixedName(source.name, copyNumber);
  }

  return addMachineProfile(
    workbench,
    {
      ...source,
      id: copyId,
      name: copyName,
      controller: {
        ...source.controller,
        verification: { status: 'unverified' }
      }
    },
    now
  );
}

export function deleteMachineProfile(
  workbench: ConnectedWorkbench,
  profileId: string,
  now: Date = new Date()
) {
  return updateMachineProfileLibrary(workbench, { kind: 'delete', profileId }, now);
}

export function setActiveMachineProfile(
  workbench: ConnectedWorkbench,
  profileId: string,
  now: Date = new Date()
) {
  return updateMachineProfileLibrary(workbench, { kind: 'select-active', profileId }, now);
}

export function importMachineProfile(
  workbench: ConnectedWorkbench,
  importedProfile: MachineProfile,
  now: Date = new Date()
) {
  const plan = planMachineProfileImport(
    workbench.manifest.machineProfiles.map(normalizeMachineProfile),
    normalizeMachineProfile(importedProfile)
  );
  if (plan.kind === 'already-installed') return Promise.resolve(workbench);

  return addMachineProfile(workbench, plan.profile, now);
}

function requireUniqueProfileId(profiles: MachineProfile[], profileId: string) {
  if (profiles.some((profile) => profile.id === profileId)) {
    throw new Error(`Machine profile already exists: ${profileId}`);
  }
}

function requireProfileIndex(profiles: MachineProfile[], profileId: string) {
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index === -1) throw new Error(`Machine profile not found: ${profileId}`);
  return index;
}

function suffixedId(id: string, copyNumber: number) {
  const suffix = `-${copyNumber}`;
  const base = id.slice(0, MAX_PROFILE_ID_LENGTH - suffix.length).replace(/-+$/g, '');
  return `${base}${suffix}`;
}

function suffixedName(name: string, copyNumber: number) {
  const suffix = ` (${copyNumber})`;
  return `${name.slice(0, MAX_PROFILE_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}
