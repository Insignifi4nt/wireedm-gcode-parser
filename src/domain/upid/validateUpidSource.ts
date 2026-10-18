import { dxfUnitsFromInsunitsCode } from '@/domain/dxf/parseDxf';
import {
  finiteInteger,
  finiteNumber,
  finitePoint,
  optionalString,
  readUpidRecord as record,
  type UpidValidationContext
} from './upidValidationPrimitives';

export function validateUpidSource(value: unknown, context: UpidValidationContext) {
  const source = record(value);
  if (!source) {
    context.add('upid-invalid-value', 'UPID source must be an object.');
    return;
  }
  if (source.kind !== 'dxf-entities') {
    context.add('upid-invalid-value', `UPID source kind ${String(source.kind)} is unsupported.`);
  }
  finiteInteger(source.entityCount, 'source.entityCount', context, 0);
  optionalString(source.fileName, 'source.fileName', context);
  optionalString(source.projectId, 'source.projectId', context, true);
  if (source.importWarnings != null) {
    if (!Array.isArray(source.importWarnings)) {
      context.add('upid-invalid-value', 'source.importWarnings must be an array when present.');
    } else {
      source.importWarnings.forEach((warning, index) => {
        if (typeof warning !== 'string') {
          context.add(
            'upid-invalid-value',
            `source.importWarnings[${index}] must be a string.`
          );
        }
      });
    }
  }
  if (source.importedAt != null) {
    if (typeof source.importedAt !== 'string' || Number.isNaN(Date.parse(source.importedAt))) {
      context.add('upid-invalid-value', 'source.importedAt must be a valid date string.');
    }
  }
  if (source.coordinateScaleToMillimeters != null) {
    finiteNumber(source.coordinateScaleToMillimeters, 'source.coordinateScaleToMillimeters', context, {
      positive: true
    });
  }
  const appliedUnits = source.appliedUnits == null ? null : record(source.appliedUnits);
  if (source.appliedUnits != null && !appliedUnits) {
    context.add('upid-invalid-value', 'source.appliedUnits must be an object when present.');
  }
  if (appliedUnits) {
    if (typeof appliedUnits.label !== 'string' || appliedUnits.label.length === 0) {
      context.add('upid-invalid-value', 'source.appliedUnits.label must be a non-empty string.');
    }
    const validScale = finiteNumber(
      appliedUnits.scaleToMillimeters,
      'source.appliedUnits.scaleToMillimeters',
      context,
      { positive: true }
    );
    if (appliedUnits.basis !== 'dxf-declared' && appliedUnits.basis !== 'user-confirmed') {
      context.add('upid-invalid-value', 'source.appliedUnits.basis is unsupported.');
    }
    if (typeof appliedUnits.confirmed !== 'boolean') {
      context.add('upid-invalid-value', 'source.appliedUnits.confirmed must be boolean.');
    }
    if (
      appliedUnits.confirmedAt != null &&
      (typeof appliedUnits.confirmedAt !== 'string' ||
        Number.isNaN(Date.parse(appliedUnits.confirmedAt)))
    ) {
      context.add('upid-invalid-value', 'source.appliedUnits.confirmedAt must be a valid date string.');
    }
    if (
      validScale &&
      source.coordinateScaleToMillimeters !== appliedUnits.scaleToMillimeters
    ) {
      context.add(
        'upid-invalid-value',
        'source.appliedUnits.scaleToMillimeters must equal source.coordinateScaleToMillimeters.'
      );
    }
  }
  const drawing = source.drawing == null ? null : record(source.drawing);
  if (source.drawing != null && !drawing) {
    context.add('upid-invalid-value', 'source.drawing must be an object when present.');
  }
  if (drawing) {
    if (drawing.basePoint != null) finitePoint(drawing.basePoint, 'source.drawing.basePoint', context);
    const extents = drawing.extents == null ? null : record(drawing.extents);
    if (drawing.extents != null && !extents) {
      context.add('upid-invalid-value', 'source.drawing.extents must be an object when present.');
    }
    if (extents) {
      finitePoint(extents.min, 'source.drawing.extents.min', context);
      finitePoint(extents.max, 'source.drawing.extents.max', context);
    }
  }
  const units = source.units == null ? null : record(source.units);
  if (source.units != null && !units) {
    context.add('upid-invalid-value', 'source.units must be an object when present.');
  }
  if (units) {
    validateDxfUnits(units, 'source.units', context);
  }
  const unitDeclaration = source.unitDeclaration == null
    ? null
    : record(source.unitDeclaration);
  if (source.unitDeclaration != null && !unitDeclaration) {
    context.add('upid-invalid-value', 'source.unitDeclaration must be an object when present.');
  }
  if (unitDeclaration) {
    validateDxfUnitDeclaration(unitDeclaration, units, context);
  }
  if (appliedUnits) {
    validateAppliedDxfUnitInvariants(appliedUnits, unitDeclaration, context);
  }
}

function validateDxfUnits(
  units: Record<string, unknown>,
  path: string,
  context: UpidValidationContext
) {
  if (units.source !== 'dxf-insunits') {
    context.add('upid-invalid-value', `${path}.source is unsupported.`);
  }
  finiteInteger(units.code, `${path}.code`, context, 0);
  if (typeof units.label !== 'string' || units.label.length === 0) {
    context.add('upid-invalid-value', `${path}.label must be a non-empty string.`);
  }
  if (units.scaleToMillimeters != null) {
    finiteNumber(units.scaleToMillimeters, `${path}.scaleToMillimeters`, context, {
      positive: true
    });
  }
  if (typeof units.code === 'number' && Number.isSafeInteger(units.code) && units.code >= 0) {
    const expected = dxfUnitsFromInsunitsCode(units.code);
    if (units.label !== expected.label || units.scaleToMillimeters !== expected.scaleToMillimeters) {
      context.add('upid-invalid-value', `${path} label and scale must match DXF INSUNITS code ${units.code}.`);
    }
  }
}

function validateDxfUnitDeclaration(
  declaration: Record<string, unknown>,
  sourceUnits: Record<string, unknown> | null,
  context: UpidValidationContext
) {
  const status = declaration.status;
  if (!['missing', 'malformed', 'unitless', 'unknown', 'recognized'].some((supported) => supported === status)) {
    context.add('upid-invalid-value', 'source.unitDeclaration.status is unsupported.');
    return;
  }
  if (status === 'missing' || status === 'malformed') {
    if (status === 'malformed' && declaration.rawValue !== null && typeof declaration.rawValue !== 'string') {
      context.add(
        'upid-invalid-value',
        'source.unitDeclaration.rawValue must be a string or null for malformed declarations.'
      );
    }
    if (sourceUnits) {
      context.add(
        'upid-invalid-value',
        `source.unitDeclaration status ${status} cannot accompany source.units.`
      );
    }
    return;
  }

  const declarationUnits = record(declaration.units);
  if (!declarationUnits) {
    context.add(
      'upid-invalid-value',
      `source.unitDeclaration.units is required for status ${status}.`
    );
    return;
  }
  validateDxfUnits(declarationUnits, 'source.unitDeclaration.units', context);
  if (!sourceUnits || !sameDxfUnits(declarationUnits, sourceUnits)) {
    context.add(
      'upid-invalid-value',
      'source.unitDeclaration.units must match source.units.'
    );
  }
  if (
    status === 'recognized' &&
    (declarationUnits.code === 0 || declarationUnits.scaleToMillimeters == null)
  ) {
    context.add(
      'upid-invalid-value',
      'Recognized source.unitDeclaration units require a millimeter scale.'
    );
  }
  if (
    status === 'unitless' &&
    (declarationUnits.code !== 0 || declarationUnits.scaleToMillimeters != null)
  ) {
    context.add('upid-invalid-value', 'Unitless source.unitDeclaration units are inconsistent.');
  }
  if (
    status === 'unknown' &&
    (declarationUnits.code === 0 || declarationUnits.scaleToMillimeters != null)
  ) {
    context.add('upid-invalid-value', 'Unknown source.unitDeclaration units cannot have a scale.');
  }
}

function validateAppliedDxfUnitInvariants(
  applied: Record<string, unknown>,
  declaration: Record<string, unknown> | null,
  context: UpidValidationContext
) {
  if (applied.basis === 'user-confirmed') {
    if (applied.confirmed !== true) {
      context.add('upid-invalid-value', 'User-confirmed source.appliedUnits must be confirmed.');
    }
    if (
      typeof applied.confirmedAt !== 'string' ||
      Number.isNaN(Date.parse(applied.confirmedAt))
    ) {
      context.add(
        'upid-invalid-value',
        'User-confirmed source.appliedUnits require a valid confirmation timestamp.'
      );
    }
    const namedUnitIsConsistent =
      (applied.label === 'millimeters' && applied.scaleToMillimeters === 1) ||
      (applied.label === 'inches' && applied.scaleToMillimeters === 25.4);
    if (!namedUnitIsConsistent) {
      context.add(
        'upid-invalid-value',
        'User-confirmed source.appliedUnits label and scale are inconsistent.'
      );
    }
    return;
  }
  if (applied.basis === 'dxf-declared') {
    const declarationUnits = declaration?.status === 'recognized'
      ? record(declaration.units)
      : null;
    if (
      applied.confirmed !== true ||
      !declarationUnits ||
      applied.scaleToMillimeters !== declarationUnits.scaleToMillimeters ||
      applied.label !== declarationUnits.label
    ) {
      context.add(
        'upid-invalid-value',
        'DXF-declared source.appliedUnits must match a recognized unit declaration.'
      );
    }
  }
}

function sameDxfUnits(left: Record<string, unknown>, right: Record<string, unknown>) {
  return left.source === right.source &&
    left.code === right.code &&
    left.label === right.label &&
    left.scaleToMillimeters === right.scaleToMillimeters;
}
