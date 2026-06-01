import type { UniversalPathIntelligenceDocument } from '@/domain/upid/upidDocument';

export const OUTPUT_EXTENSIONS = ['iso', 'nc', 'gcode'] as const;

export type OutputExtension = (typeof OUTPUT_EXTENSIONS)[number] | 'custom';

export type WorkbenchSourceKind = 'dxf' | 'external-gcode';

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
}

export interface MachineWorkArea {
  widthMm: number | null;
  lengthMm: number | null;
}

export interface MachineProfile {
  id: string;
  name: string;
  templates: GCodeTemplateSet;
  output: OutputFormat;
  workArea: MachineWorkArea;
  notes: string;
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
