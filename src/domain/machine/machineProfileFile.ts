import {
  normalizeMachineProfile
} from '@/domain/machine/machineProfiles';
import { OUTPUT_EXTENSIONS } from '@/domain/workbench/types';
import type {
  MachineProfile,
  MachineProfileVerification,
  PortableMachineProfileDocument
} from '@/domain/workbench/types';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 120;
const MAX_TEMPLATE_LENGTH = 64 * 1024;
const MAX_NOTES_LENGTH = 16 * 1024;
const MAX_PRE_ACTIVATION_CODES = 16;
const MAX_PRE_ACTIVATION_CODE_LENGTH = 64;
const PROFILE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const CUSTOM_EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,15}$/;
const CANONICAL_ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type MachineProfileImportPlan =
  | { kind: 'already-installed'; profile: MachineProfile }
  | { kind: 'add'; profile: MachineProfile }
  | { kind: 'copy'; profile: MachineProfile };

export function serializeMachineProfileFile(
  profile: MachineProfile,
  now: Date = new Date()
): string {
  const document: PortableMachineProfileDocument = {
    format: 'wire-edm-machine-profile',
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    profile: reconstructProfile(profile, false)
  };

  const text = `${JSON.stringify(document, null, 2)}\n`;
  enforceFileSize(text);
  return text;
}

export function parseMachineProfileFile(text: string): MachineProfile {
  enforceFileSize(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Machine profile file contains malformed JSON.');
  }

  const document = requireRecord(parsed, 'document');
  if (document.format !== 'wire-edm-machine-profile') {
    throw new Error('Machine profile file format is unsupported.');
  }
  if (document.schemaVersion !== 1) {
    throw new Error(`Machine profile file schema version ${String(document.schemaVersion)} is unsupported.`);
  }
  requireIsoTimestamp(document.exportedAt, 'exportedAt');

  return reconstructProfile(document.profile, true);
}

export function planMachineProfileImport(
  existing: MachineProfile[],
  imported: MachineProfile
): MachineProfileImportPlan {
  const installed = existing.find((profile) => profile.id === imported.id);
  if (!installed) return { kind: 'add', profile: imported };

  if (machineProfileSemanticKey(installed) === machineProfileSemanticKey(imported)) {
    return { kind: 'already-installed', profile: installed };
  }

  const occupiedIds = new Set(existing.map((profile) => profile.id));
  let copyNumber = 2;
  let copyId = suffixedId(imported.id, copyNumber);
  while (occupiedIds.has(copyId)) {
    copyNumber += 1;
    copyId = suffixedId(imported.id, copyNumber);
  }

  return {
    kind: 'copy',
    profile: {
      ...imported,
      id: copyId,
      name: suffixedName(imported.name, copyNumber),
      controller: {
        ...imported.controller,
        verification: { status: 'unverified' }
      }
    }
  };
}

function reconstructProfile(value: unknown, resetVerification: boolean): MachineProfile {
  const source = requireRecord(value, 'profile');
  const id = requireString(source.id, 'ID', MAX_ID_LENGTH);
  if (!PROFILE_ID_PATTERN.test(id)) {
    invalidProfile('ID must use lowercase letters, numbers, and internal hyphens.');
  }

  const name = requireString(source.name, 'name', MAX_NAME_LENGTH);
  if (name.trim().length === 0) invalidProfile('name must not be blank.');
  const preferredDxfImportUnit = source.preferredDxfImportUnit == null
    ? null
    : requireEnum(
      source.preferredDxfImportUnit,
      ['millimeters', 'inches'] as const,
      'preferred DXF import unit'
    );

  const controller = requireRecord(source.controller, 'controller');
  const controllerFamily = requireEnum(
    controller.family,
    ['generic-iso', 'charmilles-robofil-classic', 'custom'] as const,
    'controller family'
  );
  const postVersion = controller.postVersion === undefined
    ? 1
    : requirePositiveSafeInteger(controller.postVersion, 'post version');
  const blockFormatting = requireEnum(
    controller.blockFormatting,
    ['spaced', 'compact'] as const,
    'block formatting'
  );
  const coordinateSystem = requireEnum(
    controller.coordinateSystem,
    ['template-managed', 'work-offset', 'wire-position-g92'] as const,
    'coordinate system'
  );
  const unitsCode = controller.unitsCode === undefined
    ? 'omit'
    : requireEnum(controller.unitsCode, ['G20', 'G21', 'omit'] as const, 'units code');
  const planeCode = controller.planeCode === undefined
    ? 'omit'
    : requireEnum(controller.planeCode, ['G17', 'omit'] as const, 'plane code');
  const workOffsetCode = controller.workOffsetCode === undefined
    ? 'template-managed'
    : requireEnum(
      controller.workOffsetCode,
      ['G54', 'omit', 'template-managed'] as const,
      'work-offset code'
    );
  const distanceMode = controller.distanceMode === undefined
    ? 'G90'
    : requireEnum(controller.distanceMode, ['G90'] as const, 'distance mode');
  const arcCenterMode = controller.arcCenterMode === undefined
    ? 'incremental-from-start'
    : requireEnum(
      controller.arcCenterMode,
      ['incremental-from-start', 'absolute'] as const,
      'arc-centre mode'
    );
  const programEnd = requireEnum(
    controller.programEnd,
    ['M02', 'M30', 'template-managed'] as const,
    'program end'
  );
  const verification = resetVerification
    ? validateAndResetVerification(controller.verification)
    : reconstructVerification(controller.verification);

  const compensation = requireRecord(source.compensation, 'compensation');
  const supported = requireBoolean(compensation.supported, 'compensation supported');
  const enabledByDefault = requireBoolean(
    compensation.enabledByDefault,
    'compensation enabled-by-default'
  );
  if (!supported && enabledByDefault) {
    invalidProfile('compensation cannot be enabled by default when it is unsupported.');
  }
  const offsetSelection = requireRecord(compensation.offsetSelection, 'offset selection');
  if (offsetSelection.address !== 'D') invalidProfile('offset selection address must be D.');
  const offsetIndex = requireNonNegativeInteger(offsetSelection.index, 'D offset index');
  const activation = requireEnum(
    compensation.activation,
    ['linear-lead', 'charmilles-g38'] as const,
    'compensation activation'
  );
  const cancellation = requireEnum(
    compensation.cancellation,
    ['linear-lead-out', 'charmilles-g39', 'program-end'] as const,
    'compensation cancellation'
  );
  const lifecycleScope = compensation.lifecycleScope === undefined
    ? 'operation'
    : requireEnum(
      compensation.lifecycleScope,
      ['operation', 'program'] as const,
      'compensation lifecycle scope'
    );
  const preActivationCodes = compensation.preActivationCodes === undefined
    ? []
    : requirePreActivationCodes(compensation.preActivationCodes);
  const validationLeadLengthMm = requirePositiveFinite(
    compensation.validationLeadLengthMm,
    'validation lead length'
  );
  const expectedMaximumOffsetMm = compensation.expectedMaximumOffsetMm === null
    ? null
    : requirePositiveFinite(compensation.expectedMaximumOffsetMm, 'expected maximum offset');
  if (supported && activation === 'linear-lead' && expectedMaximumOffsetMm === null) {
    invalidProfile('explicit linear compensation requires an expected maximum offset.');
  }

  const threading = source.threading === undefined
    ? {
        manual: { supported: false, stopCode: 'M00' as const },
        automatic: {
          supported: false,
          beforePositioningCodes: [],
          afterPositioningCodes: []
        }
      }
    : reconstructThreading(source.threading);
  const programStops = source.programStops === undefined
    ? {
        supported: false,
        code: 'M00' as const,
        allowedPlacements: [],
        allowCompensationActive: false
      }
    : reconstructProgramStops(source.programStops);

  const templates = requireRecord(source.templates, 'templates');
  const header = requireString(templates.header, 'header template', MAX_TEMPLATE_LENGTH, true);
  const footer = requireString(templates.footer, 'footer template', MAX_TEMPLATE_LENGTH, true);
  if (header.includes('\0') || footer.includes('\0')) {
    invalidProfile('templates must not contain NUL characters.');
  }

  const output = requireRecord(source.output, 'output');
  const extension = requireEnum(output.extension, [...OUTPUT_EXTENSIONS, 'custom'] as const, 'output extension');
  const lineEnding = requireEnum(output.lineEnding, ['lf', 'crlf'] as const, 'line ending');
  const coordinatePrecision = requireIntegerInRange(output.coordinatePrecision, 0, 6, 'coordinate precision');
  let customExtension: string | undefined;
  if (extension === 'custom') {
    customExtension = requireString(output.customExtension, 'custom extension', 16);
    if (!CUSTOM_EXTENSION_PATTERN.test(customExtension)) {
      invalidProfile('custom extension is invalid.');
    }
  }

  const workArea = requireRecord(source.workArea, 'work area');
  const widthMm = requireNullablePositiveFinite(workArea.widthMm, 'work area width');
  const lengthMm = requireNullablePositiveFinite(workArea.lengthMm, 'work area length');
  const notes = requireString(source.notes, 'notes', MAX_NOTES_LENGTH, true);

  const profile: MachineProfile = {
    id,
    name: name.trim(),
    preferredDxfImportUnit,
    controller: {
      family: controllerFamily,
      postVersion,
      verification,
      blockFormatting,
      coordinateSystem,
      unitsCode,
      planeCode,
      workOffsetCode,
      distanceMode,
      arcCenterMode,
      programEnd
    },
    compensation: {
      supported,
      enabledByDefault,
      offsetSelection: { address: 'D', index: offsetIndex },
      activation,
      cancellation,
      lifecycleScope,
      preActivationCodes,
      validationLeadLengthMm,
      expectedMaximumOffsetMm
    },
    threading,
    programStops,
    templates: { header, footer },
    output: {
      extension,
      ...(customExtension === undefined ? {} : { customExtension }),
      lineEnding,
      coordinatePrecision
    },
    workArea: { widthMm, lengthMm },
    notes
  };

  return normalizeMachineProfile(profile);
}

function reconstructThreading(value: unknown): MachineProfile['threading'] {
  const threading = requireRecord(value, 'threading');
  const manual = requireRecord(threading.manual, 'manual threading');
  const automatic = requireRecord(threading.automatic, 'automatic threading');
  const manualSupported = requireBoolean(manual.supported, 'manual threading supported');
  if (manual.stopCode !== 'M00') {
    invalidProfile('manual threading stop code must be canonical M00.');
  }
  const automaticSupported = requireBoolean(
    automatic.supported,
    'automatic threading supported'
  );
  const beforePositioningCodes = requirePreActivationCodes(
    automatic.beforePositioningCodes
  );
  const afterPositioningCodes = requirePreActivationCodes(
    automatic.afterPositioningCodes
  );
  if (
    automaticSupported &&
    (beforePositioningCodes.length === 0 || afterPositioningCodes.length === 0)
  ) {
    invalidProfile('automatic threading requires exact before- and after-positioning codes.');
  }
  return {
    manual: { supported: manualSupported, stopCode: 'M00' },
    automatic: {
      supported: automaticSupported,
      beforePositioningCodes,
      afterPositioningCodes
    }
  };
}

function reconstructProgramStops(value: unknown): MachineProfile['programStops'] {
  const policy = requireRecord(value, 'program stops');
  const supported = requireBoolean(policy.supported, 'program stops supported');
  if (policy.code !== 'M00') invalidProfile('program-stop code must be canonical M00.');
  if (!Array.isArray(policy.allowedPlacements)) {
    invalidProfile('program-stop placements must be an array.');
  }
  const allowedValues = [
    'before-entry',
    'before-operation-end',
    'after-contour',
    'after-exit'
  ] as const;
  const allowedPlacements = policy.allowedPlacements.map((placement) =>
    requireEnum(placement, allowedValues, 'program-stop placement')
  );
  if (new Set(allowedPlacements).size !== allowedPlacements.length) {
    invalidProfile('program-stop placements must not contain duplicates.');
  }
  return {
    supported,
    code: 'M00',
    allowedPlacements,
    allowCompensationActive: requireBoolean(
      policy.allowCompensationActive,
      'compensation-active program stops'
    )
  };
}

function reconstructVerification(value: unknown): MachineProfileVerification {
  const verification = requireRecord(value, 'controller verification');
  const status = requireEnum(
    verification.status,
    ['unverified', 'user-verified'] as const,
    'verification status'
  );
  if (status === 'unverified') return { status };

  const verifiedAt = requireIsoTimestamp(verification.verifiedAt, 'verifiedAt');
  const verifiedFingerprint = requireString(
    verification.verifiedFingerprint,
    'verification fingerprint',
    2048
  );
  return { status, verifiedAt, verifiedFingerprint };
}

function validateAndResetVerification(value: unknown): MachineProfileVerification {
  reconstructVerification(value);
  return { status: 'unverified' };
}

function machineProfileSemanticKey(profile: MachineProfile): string {
  const normalized = normalizeMachineProfile(profile);
  return JSON.stringify({
    ...normalized,
    controller: {
      ...normalized.controller,
      verification: { status: 'unverified' }
    }
  });
}

function suffixedId(id: string, copyNumber: number): string {
  const suffix = `-${copyNumber}`;
  const base = id.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/g, '');
  return `${base}${suffix}`;
}

function suffixedName(name: string, copyNumber: number): string {
  const suffix = ` (${copyNumber})`;
  return `${name.slice(0, MAX_NAME_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidProfile(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(
  value: unknown,
  label: string,
  maximumLength: number,
  allowEmpty = false
): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximumLength) {
    invalidProfile(`${label} must be a string of at most ${maximumLength} characters.`);
  }
  return value as string;
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  label: string
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    invalidProfile(`${label} is invalid.`);
  }
  return value as T[number];
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') invalidProfile(`${label} must be boolean.`);
  return value as boolean;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    invalidProfile(`${label} must be a non-negative integer.`);
  }
  return value;
}

function requirePositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    invalidProfile(`${label} must be a positive integer.`);
  }
  return value;
}

function requirePreActivationCodes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_PRE_ACTIVATION_CODES) {
    invalidProfile(`pre-activation codes must contain at most ${MAX_PRE_ACTIVATION_CODES} blocks.`);
  }

  return value.map((block) => {
    if (
      typeof block !== 'string' ||
      block.length === 0 ||
      block.length > MAX_PRE_ACTIVATION_CODE_LENGTH ||
      !/^[\x20-\x7e]+$/.test(block)
    ) {
      invalidProfile(
        `each pre-activation code must be one printable line of at most ${MAX_PRE_ACTIVATION_CODE_LENGTH} characters.`
      );
    }
    return block;
  });
}

function requireIntegerInRange(value: unknown, minimum: number, maximum: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    invalidProfile(`${label} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value;
}

function requirePositiveFinite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    invalidProfile(`${label} must be a positive finite number.`);
  }
  return value;
}

function requireNullablePositiveFinite(value: unknown, label: string): number | null {
  if (value === null) return null;
  return requirePositiveFinite(value, label);
}

function requireIsoTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !CANONICAL_ISO_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    invalidProfile(`${label} must be an ISO timestamp.`);
  }
  return value as string;
}

function enforceFileSize(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) {
    throw new Error('Machine profile file exceeds the 256 KiB limit.');
  }
}

function invalidProfile(message: string): never {
  throw new Error(`Invalid machine profile: ${message}`);
}
