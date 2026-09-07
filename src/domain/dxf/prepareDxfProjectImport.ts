import { pathSegmentsFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { mergeBounds } from '@/domain/path-intel/segments';
import { sanitizePathSegments } from '@/domain/path-intel/sanitizeSegments';
import type { Bounds2 } from '@/domain/path-intel/types';
import type { ConnectedWorkbenchCatalog } from '@/domain/workbench-catalog/workbenchCatalog';

import {
  buildDxfImportUnitCandidates,
  defaultDxfImportUnitCandidateId,
  type DxfImportUnitCandidate
} from './dxfImportUnits';
import { DEFAULT_DXF_UPID_OPTIONS } from './dxfToUpid';
import { normalizeDxfGeometry } from './normalizeDxfGeometry';
import { parseDxf } from './parseDxf';
import type { DxfParseResult } from './types';

export interface DxfImportSelection {
  readonly unitCandidateId: string;
}

export interface DxfImportPreparation {
  readonly fileName: string;
  readonly text: string;
  readonly preparedAt: string;
  readonly parseResult: DxfParseResult;
  readonly entityCount: number;
  readonly unsupportedEntityCount: number;
  readonly warningCount: number;
  readonly unitCandidates: readonly DxfImportUnitCandidate[];
  readonly defaultUnitCandidateId: string | null;
}

export interface DxfImportPreview {
  readonly boundsMm: Bounds2;
  readonly sizeMm: { readonly widthMm: number; readonly lengthMm: number };
  readonly unitCandidate: DxfImportUnitCandidate;
  readonly segmentCount: number;
  readonly geometryWarnings: readonly string[];
}

export type DxfImportPreparationError =
  | { readonly code: 'DXF_IMPORT_TIMESTAMP_INVALID'; readonly message: string }
  | { readonly code: 'DXF_IMPORT_GEOMETRY_REQUIRED'; readonly message: string };

export type DxfImportPreviewError =
  | {
      readonly code: 'DXF_IMPORT_UNIT_CANDIDATE_NOT_FOUND';
      readonly message: string;
      readonly candidateId: string;
    }
  | { readonly code: 'DXF_IMPORT_PREVIEW_INVALID'; readonly message: string };

export type DxfImportPreparationResult =
  | { readonly ok: true; readonly preparation: DxfImportPreparation }
  | { readonly ok: false; readonly error: DxfImportPreparationError };

export type DxfImportPreviewResult =
  | { readonly ok: true; readonly preview: DxfImportPreview }
  | { readonly ok: false; readonly error: DxfImportPreviewError };

export function prepareDxfProjectImport(
  workbench: ConnectedWorkbenchCatalog,
  input: { readonly fileName: string; readonly text: string; readonly now?: Date }
): DxfImportPreparationResult {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    return {
      ok: false,
      error: { code: 'DXF_IMPORT_TIMESTAMP_INVALID', message: 'DXF import timestamp is invalid.' }
    };
  }
  const preparedAt = now.toISOString();
  const parseResult = deepFreeze(jsonSnapshot(parseDxf(input.text)));
  const rawSegments = pathSegmentsFromDxfEntities(parseResult.entities, DEFAULT_DXF_UPID_OPTIONS);
  if (rawSegments.segments.length === 0) {
    return {
      ok: false,
      error: {
        code: 'DXF_IMPORT_GEOMETRY_REQUIRED',
        message: 'DXF did not contain supported cut geometry.'
      }
    };
  }
  const preference = workbench.manifest.preferences.importUnits;
  return {
    ok: true,
    preparation: deepFreeze({
      fileName: input.fileName,
      text: input.text,
      preparedAt,
      parseResult,
      entityCount: parseResult.entities.length,
      unsupportedEntityCount: parseResult.unsupportedEntities.length,
      warningCount: parseResult.warnings.length,
      unitCandidates: buildDxfImportUnitCandidates(parseResult.unitDeclaration, preference),
      defaultUnitCandidateId: defaultDxfImportUnitCandidateId(
        parseResult.unitDeclaration,
        preference
      )
    })
  };
}

export function previewDxfProjectImport(
  preparation: DxfImportPreparation,
  selection: DxfImportSelection
): DxfImportPreviewResult {
  const unitCandidate = preparation.unitCandidates.find(
    ({ id }) => id === selection.unitCandidateId
  );
  if (!unitCandidate) {
    return {
      ok: false,
      error: {
        code: 'DXF_IMPORT_UNIT_CANDIDATE_NOT_FOUND',
        message: `DXF unit candidate was not reviewed: ${selection.unitCandidateId}.`,
        candidateId: selection.unitCandidateId
      }
    };
  }
  try {
    const normalized = normalizeDxfGeometry({
      entities: preparation.parseResult.entities,
      options: DEFAULT_DXF_UPID_OPTIONS,
      sourceMetadata: { units: unitCandidate.units }
    });
    const built = pathSegmentsFromDxfEntities(normalized.entities, normalized.options);
    const sanitized = sanitizePathSegments(built.segments, normalized.options);
    const boundsMm = boundsForSegments(sanitized.segments.map(({ bounds }) => bounds));
    if (!boundsMm) return previewInvalid('DXF unit preview did not contain supported cut geometry.');
    const widthMm = boundsMm.maxX - boundsMm.minX;
    const lengthMm = boundsMm.maxY - boundsMm.minY;
    if (!Number.isFinite(widthMm) || !Number.isFinite(lengthMm)) {
      return previewInvalid('DXF unit preview produced invalid millimeter bounds.');
    }
    return {
      ok: true,
      preview: {
        boundsMm, sizeMm: { widthMm, lengthMm }, unitCandidate,
        segmentCount: sanitized.segments.length,
        geometryWarnings: [...built.diagnostics, ...sanitized.diagnostics]
          .filter(({ severity }) => severity !== 'info')
          .map(({ message }) => message)
      }
    };
  } catch (error) {
    return previewInvalid(error instanceof Error ? error.message : String(error));
  }
}

function boundsForSegments(segmentBounds: readonly Bounds2[]) {
  if (segmentBounds.length === 0) return null;
  return segmentBounds.reduce((bounds, current) => mergeBounds(bounds, current));
}

function previewInvalid(message: string): DxfImportPreviewResult {
  return { ok: false, error: { code: 'DXF_IMPORT_PREVIEW_INVALID', message } };
}

function jsonSnapshot<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach((entry) => deepFreeze(entry));
  }
  return value;
}
