import { describe, expect, it } from 'vitest';

import { planMachineProfileImport } from '@/domain/machine/machineProfileFile';
import {
  createBlankMachineProfile,
  normalizeMachineProfile
} from '@/domain/machine/machineProfiles';
import {
  createDefaultMachineProfile,
  createWorkbenchProject
} from '@/domain/workbench/defaultProject';
import type { MachineProfile } from '@/domain/workbench/types';

import {
  addMachineProfile,
  deleteMachineProfile,
  duplicateMachineProfile,
  importMachineProfile,
  setActiveMachineProfile,
  updateMachineProfileLibrary
} from '../updateMachineProfileLibrary';
import {
  FOOTER_TEMPLATE_PATH,
  HEADER_TEMPLATE_PATH,
  WORKBENCH_MANIFEST_FILE,
  type ConnectedWorkbench,
  type WorkbenchStorageAdapter
} from '../workbenchStorage';

const now = new Date('2026-07-13T12:00:00.000Z');

class MemoryWorkbenchAdapter implements WorkbenchStorageAdapter {
  readonly kind = 'memory';
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  readonly writeAttempts = new Map<string, number>();
  readonly failedWriteAttempts = new Map<string, Set<number>>();

  constructor(readonly name = 'profile-library') {}

  async ensureDirectory() {}

  async readText(path: string) {
    return this.files.get(path) ?? null;
  }

  async writeText(path: string, contents: string) {
    const attempt = (this.writeAttempts.get(path) ?? 0) + 1;
    this.writeAttempts.set(path, attempt);
    this.writes.push(path);
    if (this.failedWriteAttempts.get(path)?.has(attempt)) {
      throw new Error(`Injected write failure for ${path} on attempt ${attempt}.`);
    }
    this.files.set(path, contents);
  }

  async deleteText(path: string) {
    this.files.delete(path);
  }

  failWrite(path: string, ...attempts: number[]) {
    this.failedWriteAttempts.set(path, new Set(attempts));
  }
}

function profile(overrides: Partial<MachineProfile> = {}): MachineProfile {
  const fallback = createDefaultMachineProfile();
  return normalizeMachineProfile({
    ...fallback,
    ...overrides,
    controller: overrides.controller ?? fallback.controller,
    compensation: overrides.compensation ?? fallback.compensation,
    templates: overrides.templates ?? fallback.templates,
    output: overrides.output ?? fallback.output,
    workArea: overrides.workArea ?? fallback.workArea
  });
}

function connectedWorkbench(
  profiles: MachineProfile[] = [createDefaultMachineProfile()],
  activeMachineProfileId = profiles[0].id
): ConnectedWorkbench {
  const adapter = new MemoryWorkbenchAdapter();
  const activeMachineProfile = profiles.find(({ id }) => id === activeMachineProfileId) ?? profiles[0];
  const projectEntry = {
    id: 'existing-job',
    name: 'Existing job',
    path: 'projects/existing-job/project.json',
    sourceKind: 'dxf' as const,
    updatedAt: '2026-07-12T09:00:00.000Z'
  };
  const workbench: ConnectedWorkbench = {
    adapter,
    manifest: {
      schemaVersion: 1,
      name: 'profile-library',
      createdAt: '2026-07-12T08:00:00.000Z',
      updatedAt: '2026-07-12T09:00:00.000Z',
      templates: {
        headerPath: HEADER_TEMPLATE_PATH,
        footerPath: FOOTER_TEMPLATE_PATH
      },
      output: activeMachineProfile.output,
      activeMachineProfileId: activeMachineProfile.id,
      machineProfiles: profiles,
      projects: [projectEntry]
    },
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer
  };

  adapter.files.set(HEADER_TEMPLATE_PATH, workbench.header);
  adapter.files.set(FOOTER_TEMPLATE_PATH, workbench.footer);
  adapter.files.set(WORKBENCH_MANIFEST_FILE, JSON.stringify(workbench.manifest, null, 2));
  const project = createWorkbenchProject({
    id: projectEntry.id,
    name: projectEntry.name,
    sourceKind: projectEntry.sourceKind,
    now: new Date(projectEntry.updatedAt)
  });
  project.machine = profile({
    id: 'project-machine-snapshot',
    name: 'Project machine snapshot',
    notes: 'Must remain byte-for-byte unchanged.'
  });
  adapter.files.set(projectEntry.path, JSON.stringify(project));
  adapter.writes.length = 0;
  adapter.writeAttempts.clear();

  return workbench;
}

function connectedStateSnapshot(workbench: ConnectedWorkbench) {
  return {
    manifest: JSON.stringify(workbench.manifest),
    activeMachineProfile: JSON.stringify(workbench.activeMachineProfile),
    header: workbench.header,
    footer: workbench.footer
  };
}

describe('machine profile library persistence', () => {
  it('adds an inactive blank profile without rewriting active compatibility mirrors', async () => {
    const before = connectedWorkbench();
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await addMachineProfile(
      before,
      createBlankMachineProfile('new-wire-machine'),
      now
    );

    expect(result.manifest.machineProfiles.map(({ id }) => id)).toContain('new-wire-machine');
    expect(result.manifest.activeMachineProfileId).toBe(before.manifest.activeMachineProfileId);
    expect(result.manifest.output).toEqual(before.manifest.output);
    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe(before.header);
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe(before.footer);
    expect(adapter.writes).toEqual([WORKBENCH_MANIFEST_FILE]);
    expect(result.manifest.projects).toEqual(before.manifest.projects);
  });

  it('rejects adding a duplicate profile ID', async () => {
    const before = connectedWorkbench();

    await expect(
      addMachineProfile(before, profile({ name: 'Conflicting machine' }), now)
    ).rejects.toThrow(/already exists/i);
  });

  it('duplicates a profile with deterministic unique IDs and names', async () => {
    const source = profile({ id: 'shop-machine', name: 'Shop Machine' });
    const occupied = profile({ id: 'shop-machine-2', name: 'Shop Machine (2)' });
    const before = connectedWorkbench([source, occupied], source.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await duplicateMachineProfile(before, source.id, now);

    expect(result.manifest.machineProfiles.at(-1)).toMatchObject({
      id: 'shop-machine-3',
      name: 'Shop Machine (3)',
      controller: { verification: { status: 'unverified' } }
    });
    expect(result.manifest.activeMachineProfileId).toBe(source.id);
    expect(adapter.writes).toEqual([WORKBENCH_MANIFEST_FILE]);
  });

  it('replaces an inactive profile without rewriting active compatibility mirrors', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const inactive = profile({ id: 'inactive-machine', name: 'Inactive machine' });
    const before = connectedWorkbench([active, inactive], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await updateMachineProfileLibrary(
      before,
      {
        kind: 'replace',
        profile: { ...inactive, name: 'Edited inactive machine', templates: { header: 'INACTIVE', footer: 'ONLY' } }
      },
      now
    );

    expect(result.manifest.machineProfiles[1].name).toBe('Edited inactive machine');
    expect(result.activeMachineProfile).toEqual(active);
    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe(active.templates.header);
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe(active.templates.footer);
    expect(adapter.writes).toEqual([WORKBENCH_MANIFEST_FILE]);
  });

  it('selects an active profile and updates every compatibility mirror', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const selected = profile({
      id: 'selected-machine',
      name: 'Selected machine',
      templates: { header: 'SELECTED HEADER', footer: 'SELECTED FOOTER' },
      output: { extension: 'nc', lineEnding: 'lf', coordinatePrecision: 5 }
    });
    const before = connectedWorkbench([active, selected], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await setActiveMachineProfile(before, selected.id, now);

    expect(result.activeMachineProfile).toEqual(selected);
    expect(result.header).toBe('SELECTED HEADER');
    expect(result.footer).toBe('SELECTED FOOTER');
    expect(result.manifest.output).toEqual(selected.output);
    expect(result.manifest.activeMachineProfileId).toBe(selected.id);
    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe('SELECTED HEADER');
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe('SELECTED FOOTER');
    expect(adapter.writes).toEqual([
      HEADER_TEMPLATE_PATH,
      FOOTER_TEMPLATE_PATH,
      WORKBENCH_MANIFEST_FILE
    ]);
  });

  it('rolls back the header when the footer mirror write fails', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const selected = profile({
      id: 'selected-machine',
      name: 'Selected machine',
      templates: { header: 'SELECTED HEADER', footer: 'SELECTED FOOTER' }
    });
    const before = connectedWorkbench([active, selected], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;
    const manifestBefore = adapter.files.get(WORKBENCH_MANIFEST_FILE);
    const connectedBefore = connectedStateSnapshot(before);
    adapter.failWrite(FOOTER_TEMPLATE_PATH, 1);

    await expect(setActiveMachineProfile(before, selected.id, now)).rejects.toThrow(
      `Injected write failure for ${FOOTER_TEMPLATE_PATH}`
    );

    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe(active.templates.header);
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe(active.templates.footer);
    expect(adapter.files.get(WORKBENCH_MANIFEST_FILE)).toBe(manifestBefore);
    expect(connectedStateSnapshot(before)).toEqual(connectedBefore);
  });

  it('rolls back both compatibility mirrors when the manifest commit fails', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const selected = profile({
      id: 'selected-machine',
      name: 'Selected machine',
      templates: { header: 'SELECTED HEADER', footer: 'SELECTED FOOTER' }
    });
    const before = connectedWorkbench([active, selected], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;
    const manifestBefore = adapter.files.get(WORKBENCH_MANIFEST_FILE);
    const connectedBefore = connectedStateSnapshot(before);
    adapter.failWrite(WORKBENCH_MANIFEST_FILE, 1);

    await expect(setActiveMachineProfile(before, selected.id, now)).rejects.toThrow(
      `Injected write failure for ${WORKBENCH_MANIFEST_FILE}`
    );

    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe(active.templates.header);
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe(active.templates.footer);
    expect(adapter.files.get(WORKBENCH_MANIFEST_FILE)).toBe(manifestBefore);
    expect(connectedStateSnapshot(before)).toEqual(connectedBefore);
  });

  it('reports rollback failures while preserving the old manifest as reconnect authority', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const selected = profile({
      id: 'selected-machine',
      name: 'Selected machine',
      templates: { header: 'SELECTED HEADER', footer: 'SELECTED FOOTER' }
    });
    const before = connectedWorkbench([active, selected], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;
    const manifestBefore = adapter.files.get(WORKBENCH_MANIFEST_FILE);
    adapter.failWrite(FOOTER_TEMPLATE_PATH, 1);
    adapter.failWrite(HEADER_TEMPLATE_PATH, 2);

    await expect(setActiveMachineProfile(before, selected.id, now)).rejects.toThrow(
      /recovery failed.*header\.gcode/i
    );

    expect(adapter.files.get(WORKBENCH_MANIFEST_FILE)).toBe(manifestBefore);
    expect(JSON.parse(manifestBefore ?? '{}').activeMachineProfileId).toBe(active.id);
    expect(before.activeMachineProfile.id).toBe(active.id);
  });

  it('deletes the active profile using the first remaining profile as deterministic fallback', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const fallback = profile({
      id: 'fallback-machine',
      name: 'Fallback machine',
      templates: { header: 'FALLBACK HEADER', footer: 'FALLBACK FOOTER' },
      output: { extension: 'nc', lineEnding: 'lf', coordinatePrecision: 4 }
    });
    const later = profile({ id: 'later-machine', name: 'Later machine' });
    const before = connectedWorkbench([active, fallback, later], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await deleteMachineProfile(before, active.id, now);

    expect(result.activeMachineProfile.id).toBe(fallback.id);
    expect(result.manifest.activeMachineProfileId).toBe(fallback.id);
    expect(result.manifest.machineProfiles.map(({ id }) => id)).toEqual([fallback.id, later.id]);
    expect(result.header).toBe('FALLBACK HEADER');
    expect(result.footer).toBe('FALLBACK FOOTER');
    expect(result.manifest.output).toEqual(fallback.output);
    expect(adapter.files.get(HEADER_TEMPLATE_PATH)).toBe('FALLBACK HEADER');
    expect(adapter.files.get(FOOTER_TEMPLATE_PATH)).toBe('FALLBACK FOOTER');
    expect(adapter.writes).toEqual([
      HEADER_TEMPLATE_PATH,
      FOOTER_TEMPLATE_PATH,
      WORKBENCH_MANIFEST_FILE
    ]);
  });

  it('never deletes the final profile', async () => {
    const only = profile({ id: 'only-machine', name: 'Only machine' });
    const before = connectedWorkbench([only]);

    await expect(deleteMachineProfile(before, only.id, now)).rejects.toThrow(/final/i);
  });

  it('deletes an inactive profile without rewriting active compatibility mirrors', async () => {
    const active = profile({ id: 'active-machine', name: 'Active machine' });
    const inactive = profile({ id: 'inactive-machine', name: 'Inactive machine' });
    const before = connectedWorkbench([active, inactive], active.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await deleteMachineProfile(before, inactive.id, now);

    expect(result.manifest.machineProfiles).toHaveLength(1);
    expect(result.activeMachineProfile.id).toBe(active.id);
    expect(adapter.writes).toEqual([WORKBENCH_MANIFEST_FILE]);
  });

  it('treats a same-ID semantic import as a no-op', async () => {
    const installed = profile({ id: 'imported-machine', name: 'Imported machine' });
    const imported = {
      ...installed,
      controller: {
        ...installed.controller,
        verification: {
          status: 'user-verified' as const,
          verifiedAt: '2026-07-13T10:00:00.000Z',
          verifiedFingerprint: 'ignored-by-semantic-comparison'
        }
      }
    };
    const before = connectedWorkbench([installed]);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    expect(planMachineProfileImport([installed], imported).kind).toBe('already-installed');
    const result = await importMachineProfile(before, imported, now);

    expect(result).toBe(before);
    expect(adapter.writes).toEqual([]);
  });

  it('imports a same-ID collision as the deterministic inactive copy', async () => {
    const installed = profile({ id: 'imported-machine', name: 'Installed machine' });
    const occupied = profile({ id: 'imported-machine-2', name: 'Imported machine (2)' });
    const imported = profile({ id: installed.id, name: 'Imported machine', notes: 'Different semantics' });
    const before = connectedWorkbench([installed, occupied], installed.id);
    const adapter = before.adapter as MemoryWorkbenchAdapter;

    const result = await importMachineProfile(before, imported, now);

    expect(result.manifest.machineProfiles.at(-1)).toMatchObject({
      id: 'imported-machine-3',
      name: 'Imported machine (3)'
    });
    expect(result.activeMachineProfile.id).toBe(installed.id);
    expect(adapter.writes).toEqual([WORKBENCH_MANIFEST_FILE]);
  });

  it('deep-clones stored profiles and leaves existing project machine snapshots byte-for-byte unchanged', async () => {
    const before = connectedWorkbench();
    const adapter = before.adapter as MemoryWorkbenchAdapter;
    const projectPath = before.manifest.projects[0].path;
    const projectBefore = adapter.files.get(projectPath);
    const added = createBlankMachineProfile('detached-machine');

    const result = await addMachineProfile(before, added, now);
    added.templates.header = 'MUTATED AFTER SAVE';
    result.manifest.machineProfiles[0].templates.header = 'MUTATED RESULT';

    expect(result.manifest.machineProfiles.at(-1)?.templates.header).toBe('');
    expect(before.manifest.machineProfiles[0].templates.header).not.toBe('MUTATED RESULT');
    expect(adapter.files.get(projectPath)).toBe(projectBefore);
  });
});
