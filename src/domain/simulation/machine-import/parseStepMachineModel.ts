import type { OcctImportModule } from 'occt-import-js';
import { MACHINE_TESSELLATION, machineImportFailure, type MachineImportProgress, type MachineModelImportResult } from './model';
import { validateMachineFile, validateStepBytes } from './stepInput';
import { validateMachineModel } from './validateMachineModel';

export async function parseStepMachineModel(
  bytes: Uint8Array,
  fileName: string,
  loadParser: () => Promise<OcctImportModule>,
  onProgress?: (progress: MachineImportProgress) => void
): Promise<MachineModelImportResult> {
  const fileCheck = validateMachineFile({ name: fileName, size: bytes.byteLength });
  if (!fileCheck.ok) return fileCheck;
  const contentCheck = validateStepBytes(bytes);
  if (!contentCheck.ok) return contentCheck;
  onProgress?.({ stage: 'loading-parser' });
  let parser: OcctImportModule;
  try { parser = await loadParser(); }
  catch { return machineImportFailure('MACHINE_IMPORT_PARSER_UNAVAILABLE', 'The local STEP parser could not load. Reload the app and try again.'); }
  onProgress?.({ stage: 'triangulating' });
  let raw: unknown;
  try {
    raw = parser.ReadStepFile(bytes, { linearUnit: 'millimeter', linearDeflectionType: 'absolute_value',
      linearDeflection: MACHINE_TESSELLATION.linearDeflectionMm, angularDeflection: MACHINE_TESSELLATION.angularDeflectionRadians });
  } catch {
    return machineImportFailure('MACHINE_IMPORT_PARSE_FAILED', 'OpenCascade could not triangulate this STEP model. Export a simpler complete model and try again.');
  }
  onProgress?.({ stage: 'validating' });
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  const sha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
  return validateMachineModel(raw, { fileName, byteLength: bytes.byteLength, sha256 });
}
