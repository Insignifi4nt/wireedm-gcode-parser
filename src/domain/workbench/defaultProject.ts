import type { MachineProfile, WorkbenchProject, WorkbenchSourceKind } from './types';

export const DEFAULT_HEADER_TEMPLATE = [
  '%',
  'G90 G21 G17 G40',
  'G54'
].join('\n');

export const DEFAULT_FOOTER_TEMPLATE = [
  'G40',
  'M30',
  '%'
].join('\n');

export function createDefaultMachineProfile(): MachineProfile {
  return {
    id: 'default-wire-machine',
    name: 'Default Wire EDM',
    preferredDxfImportUnit: null,
    controller: {
      family: 'generic-iso',
      postVersion: 1,
      verification: { status: 'unverified' },
      blockFormatting: 'spaced',
      coordinateSystem: 'template-managed',
      unitsCode: 'omit',
      planeCode: 'omit',
      workOffsetCode: 'template-managed',
      distanceMode: 'G90',
      arcCenterMode: 'incremental-from-start',
      programEnd: 'template-managed'
    },
    compensation: {
      supported: false,
      enabledByDefault: false,
      offsetSelection: { address: 'D', index: 0 },
      activation: 'linear-lead',
      cancellation: 'linear-lead-out',
      lifecycleScope: 'operation',
      preActivationCodes: [],
      validationLeadLengthMm: 2,
      expectedMaximumOffsetMm: null
    },
    templates: {
      header: DEFAULT_HEADER_TEMPLATE,
      footer: DEFAULT_FOOTER_TEMPLATE
    },
    output: {
      extension: 'iso',
      lineEnding: 'crlf',
      coordinatePrecision: 3
    },
    workArea: {
      widthMm: null,
      lengthMm: null
    },
    notes: 'Personal default. Feeds are intentionally omitted because they are set on the machine.'
  };
}

interface CreateWorkbenchProjectOptions {
  id?: string;
  name: string;
  sourceKind: WorkbenchSourceKind;
  now?: Date;
}

export function createWorkbenchProject({
  id,
  name,
  sourceKind,
  now = new Date()
}: CreateWorkbenchProjectOptions): WorkbenchProject {
  if (!sourceKind) {
    throw new Error('Project source kind is required.');
  }

  const timestamp = now.toISOString();
  const safeId = id ?? slugProjectName(name, timestamp);

  return {
    schemaVersion: 1,
    id: safeId,
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: {
      kind: sourceKind,
      files: []
    },
    machine: createDefaultMachineProfile(),
    editor: {
      activeFilePath: null,
      pinnedLineNumbers: []
    }
  };
}

function slugProjectName(name: string, timestamp: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `${slug || 'wire-edm-project'}-${timestamp.slice(0, 10)}`;
}
