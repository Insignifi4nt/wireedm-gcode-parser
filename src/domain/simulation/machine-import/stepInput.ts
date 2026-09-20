import { MACHINE_IMPORT_LIMITS, machineImportFailure, type MachineModelImportResult } from './model';

type InputCheck = { readonly ok: true } | Extract<MachineModelImportResult, { ok: false }>;

export function validateMachineFile(file: { readonly name: string; readonly size: number }): InputCheck {
  if (!/\.(step|stp)$/i.test(file.name)) {
    return machineImportFailure('MACHINE_IMPORT_UNSUPPORTED_FORMAT', 'Choose a STEP file (.step or .stp) with declared length units.');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MACHINE_IMPORT_LIMITS.fileBytes) {
    return machineImportFailure('MACHINE_IMPORT_TOO_LARGE', 'The machine model must be no larger than 25 MiB.');
  }
  if (file.size === 0) return machineImportFailure('MACHINE_IMPORT_EMPTY', 'The selected machine model is empty.');
  return { ok: true };
}

/** Reject incomplete envelopes and unitless sources before OpenCascade can assume units. */
export function validateStepBytes(bytes: Uint8Array): InputCheck {
  const size = validateMachineFile({ name: 'model.step', size: bytes.byteLength });
  if (!size.ok) return size;
  const text = new TextDecoder().decode(bytes);
  // STEP comments and quoted strings must not masquerade as structural declarations.
  const structural = text.replace(/\/\*[\s\S]*?\*\/|'(?:[^']|'')*'/g, (token) => token.startsWith("'") ? "''" : '');
  if (!/^\s*ISO-10303-21\s*;/i.test(structural) || !/END-ISO-10303-21\s*;\s*$/i.test(structural)
    || !/\bHEADER\s*;/i.test(structural) || !/\bDATA\s*(?:\([^;]*\))?\s*;/i.test(structural)) {
    return machineImportFailure('MACHINE_IMPORT_INVALID_STEP', 'The file is not a complete STEP exchange file.');
  }
  const entities = new Map(Array.from(structural.matchAll(/#(\d+)\s*=\s*([^;]*);/g), ([, id, body]) => [id, body]));
  const contexts = [...entities.values()].filter((body) => /\bGEOMETRIC_REPRESENTATION_CONTEXT\s*\(/i.test(body));
  const hasLengthUnit = (id: string, ancestors = new Set<string>()): boolean => {
    if (ancestors.has(id) || ancestors.size > 16) return false;
    ancestors.add(id);
    const body = entities.get(id) ?? '';
    if (!/\bLENGTH_UNIT\s*\(/i.test(body)) return false;
    if (/\bSI_UNIT\s*\(\s*(?:\$|\.(?:EXA|PETA|TERA|GIGA|MEGA|KILO|HECTO|DECA|DECI|CENTI|MILLI|MICRO|NANO|PICO|FEMTO|ATTO)\.)\s*,\s*\.METRE\.\s*\)/i.test(body)) return true;
    const conversion = /\bCONVERSION_BASED_UNIT\s*\(\s*''\s*,\s*#(\d+)\s*\)/i.exec(body);
    if (!conversion) return false;
    const measure = entities.get(conversion[1]) ?? '';
    const factor = /\b(?:LENGTH_)?MEASURE_WITH_UNIT\s*\(\s*LENGTH_MEASURE\s*\(\s*([-+\d.Ee]+)\s*\)\s*,\s*#(\d+)\s*\)/i.exec(measure);
    return !!factor && Number.isFinite(Number(factor[1])) && Number(factor[1]) > 0 && hasLengthUnit(factor[2], ancestors);
  };
  if (contexts.length === 0 || contexts.some((body) => {
    const assigned = /\bGLOBAL_UNIT_ASSIGNED_CONTEXT\s*\(\s*\(([^)]*)\)\s*\)/i.exec(body);
    return !assigned || !Array.from(assigned[1].matchAll(/#(\d+)/g), ([, id]) => id).some((id) => hasLengthUnit(id));
  })) {
    return machineImportFailure('MACHINE_IMPORT_UNITS_MISSING', 'The STEP model has no declared length-unit context. Export it with explicit units before importing.');
  }
  return { ok: true };
}
