import {
  DEFAULT_FOOTER_TEMPLATE,
  DEFAULT_HEADER_TEMPLATE
} from '../workbench/defaultProject';
import {
  activeMachineProfileFromList,
  machineProfileFromLegacySettings,
  normalizeMachineProfile
} from '@/domain/machine/machineProfiles';
import type { MachineProfile, OutputExtension } from '../workbench/types';

export const WORKBENCH_MANIFEST_FILE = 'workbench.json';
export const HEADER_TEMPLATE_PATH = 'templates/header.gcode';
export const FOOTER_TEMPLATE_PATH = 'templates/footer.gcode';
export const WORKBENCH_DIRECTORIES = [
  'imports',
  'exports',
  'templates',
  'machines',
  'editor',
  'projects'
] as const;

export interface WorkbenchStorageAdapter {
  readonly name: string;
  readonly kind: 'browser-cache' | 'directory' | 'memory';
  ensureDirectory(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, contents: string): Promise<void>;
}

export interface WorkbenchProjectIndexEntry {
  id: string;
  name: string;
  path: string;
  sourceKind: 'dxf' | 'external-gcode' | 'manual';
  updatedAt: string;
}

export interface WorkbenchManifest {
  schemaVersion: 1;
  name: string;
  createdAt: string;
  updatedAt: string;
  templates: {
    headerPath: typeof HEADER_TEMPLATE_PATH;
    footerPath: typeof FOOTER_TEMPLATE_PATH;
  };
  output: {
    extension: OutputExtension;
    customExtension?: string;
    lineEnding: 'lf' | 'crlf';
  };
  activeMachineProfileId: string;
  machineProfiles: MachineProfile[];
  projects: WorkbenchProjectIndexEntry[];
}

export interface ConnectedWorkbench {
  adapter: WorkbenchStorageAdapter;
  manifest: WorkbenchManifest;
  activeMachineProfile: MachineProfile;
  header: string;
  footer: string;
}

interface InitializeWorkbenchDirectoryOptions {
  now?: Date;
}

export async function initializeWorkbenchDirectory(
  adapter: WorkbenchStorageAdapter,
  options: InitializeWorkbenchDirectoryOptions = {}
): Promise<ConnectedWorkbench> {
  const now = (options.now ?? new Date()).toISOString();

  await Promise.all(
    WORKBENCH_DIRECTORIES.map((directory) => adapter.ensureDirectory(directory))
  );

  const existingManifest = await readManifest(adapter);
  const header = await ensureTextFile(
    adapter,
    HEADER_TEMPLATE_PATH,
    DEFAULT_HEADER_TEMPLATE
  );
  const footer = await ensureTextFile(
    adapter,
    FOOTER_TEMPLATE_PATH,
    DEFAULT_FOOTER_TEMPLATE
  );
  const output = {
    extension: existingManifest?.output.extension || 'iso',
    customExtension: existingManifest?.output.customExtension,
    lineEnding: existingManifest?.output.lineEnding || 'crlf'
  } satisfies WorkbenchManifest['output'];
  const profiles =
    existingManifest?.machineProfiles?.length
      ? existingManifest.machineProfiles.map(normalizeMachineProfile)
      : [
          machineProfileFromLegacySettings({
            header,
            footer,
            output
          })
        ];
  const activeMachineProfile = activeMachineProfileFromList(
    profiles,
    existingManifest?.activeMachineProfileId
  );
  const machineProfiles = profiles.some((profile) => profile.id === activeMachineProfile.id)
    ? profiles
    : [activeMachineProfile, ...profiles];

  const manifest: WorkbenchManifest = {
    schemaVersion: 1,
    name: existingManifest?.name || adapter.name,
    createdAt: existingManifest?.createdAt || now,
    updatedAt: now,
    templates: {
      headerPath: HEADER_TEMPLATE_PATH,
      footerPath: FOOTER_TEMPLATE_PATH
    },
    output: activeMachineProfile.output,
    activeMachineProfileId: activeMachineProfile.id,
    machineProfiles,
    projects: existingManifest?.projects || []
  };

  await adapter.writeText(HEADER_TEMPLATE_PATH, activeMachineProfile.templates.header);
  await adapter.writeText(FOOTER_TEMPLATE_PATH, activeMachineProfile.templates.footer);
  await adapter.writeText(WORKBENCH_MANIFEST_FILE, JSON.stringify(manifest, null, 2));

  return {
    adapter,
    manifest,
    activeMachineProfile,
    header: activeMachineProfile.templates.header,
    footer: activeMachineProfile.templates.footer
  };
}

async function readManifest(adapter: WorkbenchStorageAdapter) {
  const rawManifest = await adapter.readText(WORKBENCH_MANIFEST_FILE);
  if (!rawManifest) return null;

  const parsed = JSON.parse(rawManifest) as Partial<WorkbenchManifest>;
  if (parsed.schemaVersion !== 1) {
    throw new Error('Unsupported workbench manifest version.');
  }

  return parsed as WorkbenchManifest;
}

async function ensureTextFile(
  adapter: WorkbenchStorageAdapter,
  path: string,
  fallback: string
) {
  const existing = await adapter.readText(path);
  if (existing !== null) return existing;

  await adapter.writeText(path, fallback);
  return fallback;
}
