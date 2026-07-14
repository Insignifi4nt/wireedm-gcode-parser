import type { UniversalPathIntelligenceDocument } from '@/domain/upid/upidDocument';

export const OUTPUT_EXTENSIONS = ['iso', 'nc', 'gcode'] as const;

export type OutputExtension = (typeof OUTPUT_EXTENSIONS)[number] | 'custom';

export type WorkbenchSourceKind = 'dxf' | 'upid' | 'external-gcode';
export type PathProjectSourceKind = Extract<WorkbenchSourceKind, 'dxf' | 'upid'>;

export function isPathProjectSourceKind(
  sourceKind: WorkbenchSourceKind
): sourceKind is PathProjectSourceKind {
  return sourceKind === 'dxf' || sourceKind === 'upid';
}

export interface WorkbenchFileRef {
  name: string;
  path: string;
  kind: WorkbenchSourceKind | 'exported' | 'template';
  createdAt: string;
}

export interface GCodeTemplateSet {
  header: string;
  footer: string;
}

export interface OutputFormat {
  extension: OutputExtension;
  customExtension?: string;
  lineEnding: 'lf' | 'crlf';
  coordinatePrecision: number;
}

export interface MachineWorkArea {
  widthMm: number | null;
  lengthMm: number | null;
}

export interface MachineProfileVerification {
  status: 'unverified' | 'user-verified';
  verifiedAt?: string;
  verifiedFingerprint?: string;
}

export interface MachineControllerPolicy {
  family: 'generic-iso' | 'charmilles-robofil-classic' | 'custom';
  postVersion: number;
  verification: MachineProfileVerification;
  blockFormatting: 'spaced' | 'compact';
  coordinateSystem: 'template-managed' | 'work-offset' | 'wire-position-g92';
  unitsCode: 'G20' | 'G21' | 'omit';
  planeCode: 'G17' | 'omit';
  workOffsetCode: 'G54' | 'omit' | 'template-managed';
  distanceMode: 'G90';
  arcCenterMode: 'incremental-from-start' | 'absolute';
  programEnd: 'M02' | 'M30' | 'template-managed';
}

export interface MachineCompensationPolicy {
  supported: boolean;
  enabledByDefault: boolean;
  offsetSelection: { address: 'D'; index: number };
  activation: 'linear-lead' | 'charmilles-g38';
  cancellation: 'linear-lead-out' | 'charmilles-g39' | 'program-end';
  lifecycleScope: 'operation' | 'program';
  preActivationCodes: string[];
  validationLeadLengthMm: number;
  expectedMaximumOffsetMm: number | null;
}

export interface MachineProfile {
  id: string;
  name: string;
  preferredDxfImportUnit: 'millimeters' | 'inches' | null;
  controller: MachineControllerPolicy;
  compensation: MachineCompensationPolicy;
  templates: GCodeTemplateSet;
  output: OutputFormat;
  workArea: MachineWorkArea;
  notes: string;
}

export interface PortableMachineProfileDocument {
  format: 'wire-edm-machine-profile';
  schemaVersion: 1;
  exportedAt: string;
  profile: MachineProfile;
}

export interface EditorSessionState {
  activeFilePath: string | null;
  pinnedLineNumbers: number[];
}

export interface WorkbenchUpidState {
  format: 'upid';
  schemaVersion: 1;
  document: UniversalPathIntelligenceDocument;
}

export interface WorkbenchProject {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: {
    kind: WorkbenchSourceKind;
    files: WorkbenchFileRef[];
  };
  upid?: WorkbenchUpidState;
  machine: MachineProfile;
  editor: EditorSessionState;
}
