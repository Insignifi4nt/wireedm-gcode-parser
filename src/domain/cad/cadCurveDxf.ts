import { Type } from '@sinclair/typebox';
import { cadFeatureActive, cadFeatureSuppressionFlag } from './features/cadFeatureActivity';
import { Value } from '@sinclair/typebox/value';
import { dxfUnitsFromInsunitsCode, parseDxf, splitDxfLines } from '@/domain/dxf/parseDxf';
import type { DxfEntity, DxfUnitDeclaration } from '@/domain/dxf/types';
import { pathSegmentsFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import { clusterSegmentEndpoints } from '@/domain/path-intel/endpointClusters';
import { buildChains } from '@/domain/path-intel/chains';
import type { PathSegment } from '@/domain/path-intel/types';
import type { CadCurveFeature, CadDocument, CadPathSegment } from './cadDocument';
import { CadError } from './cadError';
import { resolveCadCurve, resolveCadCurveGeometry } from './cadCurve';
import { assertCompleteCadDxf } from './cadDxfImport';
import { CadDxfImportSourceSchema, CadDxfUnitsSchema, parseCadDxfImportSource, type CadDxfUnits } from './cadDxfSource';
import { CadFeatureSchema, createCadDocument, parseCadDocument } from './cadSchema';
import { cadPathClosureTolerance } from './cadSketchGeometry';
import { isCadImportData } from './cadImportData';
import { cadOrderedCurveEntities, type ResolvedCadPathSegment } from './cadAnalyticSegments';

export interface CadDxfCurveImportInput {
  readonly fileName: string; readonly text: string; readonly units?: CadDxfUnits;
  readonly curveId?: string; readonly name?: string;
}
export interface CadDxfCurveImportResult {
  readonly curve: CadCurveFeature; readonly unitDeclaration: DxfUnitDeclaration;
  readonly scaleToMillimeters: number; readonly sourceEntityCount: number;
}
const scales: Readonly<Record<CadDxfUnits, number>> = { mm: 1, inch: 25.4, cm: 10, m: 1000 };
const strict = { additionalProperties: false };
export const CadDxfCurveImportInputSchema = Type.Object({ fileName: CadDxfImportSourceSchema.properties.fileName, text: CadDxfImportSourceSchema.properties.text,
  units: Type.Optional(CadDxfUnitsSchema), curveId: Type.Optional(Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$' })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160, pattern: '\\S' })) }, strict);
const drawingUnits = Type.Object({ source: Type.Literal('dxf-insunits'), code: Type.Integer(), label: Type.String({ minLength: 1, maxLength: 160 }),
  scaleToMillimeters: Type.Union([Type.Number({ exclusiveMinimum: 0 }), Type.Null()]) }, strict);
const unitDeclarationSchema = Type.Union([
  Type.Object({ status: Type.Literal('missing') }, strict),
  Type.Object({ status: Type.Literal('malformed'), rawValue: Type.Union([Type.String(), Type.Null()]) }, strict),
  Type.Object({ status: Type.Union([Type.Literal('recognized'), Type.Literal('unknown'), Type.Literal('unitless')]), units: drawingUnits }, strict)
]);
const resultSchema = Type.Object({ curve: CadFeatureSchema, unitDeclaration: unitDeclarationSchema,
  scaleToMillimeters: Type.Number({ exclusiveMinimum: 0 }), sourceEntityCount: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) }, strict);

export function parseCadDxfCurveImportInput(value: unknown): CadDxfCurveImportInput {
  if (!isCadImportData(value) || !Value.Check(CadDxfCurveImportInputSchema, value)) throw new CadError('invalid-dxf-source', 'Provide DXF filename, exact text and optional units, Curve ID and name.');
  const source = parseCadDxfImportSource({ format: 'dxf', fileName: value.fileName, text: value.text, ...(value.units === undefined ? {} : { units: value.units }) });
  return Object.freeze({ fileName: source.fileName, text: source.text, ...(source.units === undefined ? {} : { units: source.units }),
    ...(value.curveId === undefined ? {} : { curveId: value.curveId }), ...(value.name === undefined ? {} : { name: value.name }) });
}

/** Detached worker replies are validated without parsing the original file twice. */
export function isCadDxfCurveImportResult(value: unknown): value is CadDxfCurveImportResult {
  try {
    if (!isCadImportData(value) || !Value.Check(resultSchema, value) || value.curve.kind !== 'curve' || !value.curve.source
      || value.curve.plane !== 'XY' || value.curve.offset !== 0 || cadFeatureSuppressionFlag(value.curve) || value.sourceEntityCount > value.curve.segments.length) return false;
    const source = parseCadDxfImportSource(value.curve.source);
    let declared: number | null = null;
    if ('units' in value.unitDeclaration) {
      const units = value.unitDeclaration.units; const canonical = dxfUnitsFromInsunitsCode(units.code);
      if (canonical.label !== units.label || canonical.scaleToMillimeters !== units.scaleToMillimeters
        || value.unitDeclaration.status !== (canonical.code === 0 ? 'unitless' : canonical.scaleToMillimeters === null ? 'unknown' : 'recognized')) return false;
      declared = value.unitDeclaration.status === 'recognized' ? canonical.scaleToMillimeters : null;
    }
    const chosen = source.units === undefined ? null : scales[source.units];
    if (declared !== null && chosen !== null && declared !== chosen || (declared ?? chosen) !== value.scaleToMillimeters) return false;
    parseCadDocument({ ...createCadDocument('Imported Curve', 'cad_import_validation'), features: [value.curve] });
    return true;
  } catch { return false; }
}

function exactSegments(entities: DxfEntity[]): PathSegment[] {
  const built = pathSegmentsFromDxfEntities(entities, { endpointTolerance: 0, coincidenceEpsilon: 0 });
  if (built.diagnostics.length || built.segments.some(segment => !segment.source.exact || segment.kind === 'circle')) {
    throw new CadError('dxf-inexact', 'Curve DXF must contain complete exact lines and circular arcs without discarded edges.');
  }
  return built.segments;
}

/** Classic fit vertices are control/generated points, not an exact line/arc chain. */
function assertExactCurvePolylineModes(text: string): void {
  const lines = splitDxfLines(text.replace(/^\uFEFF/, ''));
  let section: string | null = null; let entity: string | null = null;
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index]); const value = lines[index + 1].trim().toUpperCase();
    if (code === 0) {
      entity = value;
      if (value === 'SECTION') section = lines[index + 3]?.trim().toUpperCase() ?? null;
      else if (value === 'ENDSEC') section = null;
    }
    if (section !== 'ENTITIES' && section !== 'BLOCKS') continue;
    if (code === 70
      && (entity === 'POLYLINE' && (Number(value) & (2 | 4)) !== 0 || entity === 'VERTEX' && Number(value) !== 0)) {
      throw new CadError('dxf-inexact', 'Curve DXF cannot discard fitted/spline polyline modes or generated control vertices. Export an exact line/arc polyline.');
    }
    if ((entity === 'LWPOLYLINE' || entity === 'POLYLINE' || entity === 'VERTEX') && [40,41,43].includes(code)
      && (!value || !Number.isFinite(Number(value)) || Number(value) !== 0)) {
      throw new CadError('dxf-inexact', 'Curve DXF requires zero-width line/arc paths. Nonzero or malformed polyline widths cannot be discarded.');
    }
  }
}

/** Polyline traversal is retained. Separate analytic entities must form one complete open chain. */
export function importCadDxfCurve(input: CadDxfCurveImportInput): CadDxfCurveImportResult {
  input = parseCadDxfCurveImportInput(input);
  const source = parseCadDxfImportSource({ format: 'dxf', fileName: input.fileName, text: input.text, ...(input.units === undefined ? {} : { units: input.units }) });
  assertCompleteCadDxf(source.text);
  assertExactCurvePolylineModes(source.text);
  const parsed = parseDxf(source.text, { mode: 'exact-cad' });
  if (parsed.unsupportedEntities.length || parsed.warnings.length || parsed.entities.some(entity => entity.type === 'circle' || entity.type === 'line' && entity.approximation)) {
    throw new CadError('dxf-inexact', 'Curve DXF requires one complete open line/arc chain without closed, omitted or approximated geometry.');
  }
  const declared = parsed.unitDeclaration.status === 'recognized' ? parsed.unitDeclaration.units.scaleToMillimeters : null;
  const chosen = source.units === undefined ? null : scales[source.units];
  if (declared !== null && chosen !== null && declared !== chosen) throw new CadError('dxf-units-conflict', 'Explicit units conflict with the DXF declaration. Use the declared units or correct the original file.');
  const scale = declared ?? chosen;
  if (scale === null || !Number.isFinite(scale) || scale <= 0) throw new CadError('dxf-units-required', 'DXF does not declare recognized length units. Choose mm, inch, cm or m explicitly.');
  const polylines = parsed.entities.filter(entity => entity.type === 'polyline' || entity.type === 'lwpolyline');
  if (polylines.some(entity => entity.closed) || polylines.length && (polylines.length !== 1 || parsed.entities.length !== 1)) {
    throw new CadError('dxf-open-curve', 'Import one open polyline or one complete connected LINE/ARC chain. Closed or mixed components cannot be discarded.');
  }
  const built = exactSegments(parsed.entities);
  if (!built.length) throw new CadError('dxf-empty', 'DXF has no open Curve geometry.');
  const byId = new Map(built.map(segment => [segment.id, segment]));
  const tolerance = cadPathClosureTolerance(built.flatMap(segment => [
    { x: segment.start.x * scale, y: segment.start.y * scale }, { x: segment.end.x * scale, y: segment.end.y * scale }
  ])) / scale;
  const options = { endpointTolerance: 0, coincidenceEpsilon: tolerance };
  const clusters = clusterSegmentEndpoints(built, options); const chains = buildChains(built, clusters, options);
  const chain = chains.chains[0];
  if (clusters.diagnostics.length || chains.diagnostics.some(diagnostic => diagnostic.code !== 'open-chain') || chains.chains.length !== 1 || !chain || chain.closed || chain.segmentRefs.length !== built.length) {
    throw new CadError('dxf-open-curve', 'DXF must be one connected open chain without branches, closed components or repaired gaps.');
  }
  // A polyline already carries its exact authored direction; do not substitute graph traversal.
  const references = polylines.length ? built.map(segment => ({ segmentId: segment.id, reversed: false })) : chain.segmentRefs;
  const segments: CadPathSegment[] = references.map(reference => {
    const segment = byId.get(reference.segmentId);
    if (!segment || segment.kind === 'circle') throw new CadError('dxf-inexact', 'Curve references missing or closed geometry.');
    const start = reference.reversed ? segment.end : segment.start; const end = reference.reversed ? segment.start : segment.end;
    if (segment.kind === 'line') return { kind: 'line', start: [start.x * scale, start.y * scale], end: [end.x * scale, end.y * scale] };
    const original = parsed.entities[segment.source.sourceEntityIndex];
    const angle = original?.type === 'arc' ? original.startAngle * Math.PI / 180 : segment.startAngleRadians;
    return { kind: 'arc', center: [segment.center.x * scale, segment.center.y * scale], radius: segment.radius * scale,
      startAngle: (reference.reversed ? angle + segment.sweepRadians : angle) * 180 / Math.PI,
      sweep: (reference.reversed ? -segment.sweepRadians : segment.sweepRadians) * 180 / Math.PI };
  });
  const curve: CadCurveFeature = { kind: 'curve', id: input.curveId ?? `curve_${crypto.randomUUID()}`, name: input.name ?? (source.fileName.replace(/\.dxf$/i, '').trim().slice(0,160) || 'Imported Curve'),
    suppressed: false, plane: 'XY', offset: 0, segments, source };
  const validated = parseCadDocument({ ...createCadDocument(curve.name), features: [curve] }).features[0];
  if (validated.kind !== 'curve') throw new CadError('dxf-inexact', 'The DXF import did not produce a Curve.');
  const resolved = resolveCadCurve(validated, {});
  // Stored angles must reproduce the supplied vertices, not merely produce some valid chain.
  for (let index = 0; index < references.length; ++index) {
    const reference = references[index]; const original = byId.get(reference.segmentId); const entity = resolved.entities[index];
    if (!original || !entity || entity.type !== 'line' && entity.type !== 'arc') throw new CadError('dxf-inexact', 'The Curve changed its analytic edge types.');
    const start = reference.reversed ? original.end : original.start; const end = reference.reversed ? original.start : original.end;
    const expectedStart = { x: start.x * scale, y: start.y * scale }; const expectedEnd = { x: end.x * scale, y: end.y * scale };
    const allowance = cadPathClosureTolerance([expectedStart, expectedEnd]);
    if (Math.hypot(entity.start.x - expectedStart.x, entity.start.y - expectedStart.y) > allowance
      || Math.hypot(entity.end.x - expectedEnd.x, entity.end.y - expectedEnd.y) > allowance) {
      throw new CadError('dxf-arc-precision', 'DXF circular angles cannot retain the supplied endpoints at CAD precision. Preserve the original file.');
    }
  }
  return { curve: validated, unitDeclaration: parsed.unitDeclaration, scaleToMillimeters: scale, sourceEntityCount: parsed.entities.length };
}

/** Standard ordered OPEN LWPOLYLINE; local millimetres, no extra closure or proprietary metadata. */
export function exportCadCurveDxf(curve: CadCurveFeature, parameters: Readonly<Record<string,number>>): string {
  const resolved = resolveCadCurveGeometry(curve, parameters);
  if (!cadFeatureActive(curve, { parameters })) throw new CadError('suppressed-curve', 'Unsuppress the Curve before exporting its geometry.');
  const vertices: { x: number; y: number; bulge: number }[] = resolved.entities.map((entity, index) => {
    if (entity.type !== 'line' && entity.type !== 'arc') throw new CadError('dxf-inexact', 'Curve exports require ordered analytic line/arc edges.');
    const segment = resolved.segments[index];
    return { ...entity.start, bulge: segment.kind === 'arc' ? Math.tan(segment.sweep * Math.PI / 720) : 0 };
  });
  const last = resolved.entities[resolved.entities.length - 1];
  if (!last || last.type !== 'line' && last.type !== 'arc') throw new CadError('empty-curve', 'Curve needs at least one exact edge.');
  vertices.push({ ...last.end, bulge: 0 });
  const polyline: DxfEntity = { type: 'lwpolyline', layer: 'CAD', closed: false, vertices };
  const decoded = exactSegments([polyline]);
  if (decoded.length !== resolved.segments.length) throw new CadError('dxf-arc-precision', 'DXF bulges cannot retain the complete Curve.');
  const encodedSegments: ResolvedCadPathSegment[] = decoded.map(segment => {
    if (segment.kind === 'circle') throw new CadError('dxf-arc-precision', 'An open polyline cannot contain a full circle.');
    return segment.kind === 'line' ? { kind: 'line', start: [segment.start.x, segment.start.y], end: [segment.end.x, segment.end.y] }
      : { kind: 'arc', center: [segment.center.x, segment.center.y], radius: segment.radius, startAngle: segment.startAngleRadians * 180 / Math.PI, sweep: segment.sweepRadians * 180 / Math.PI };
  });
  const encodedEntities = cadOrderedCurveEntities(encodedSegments);
  for (let index = 0; index < decoded.length; ++index) {
    const actual = decoded[index]; const expected = resolved.entities[index]; const segment = resolved.segments[index];
    if (expected.type !== 'line' && expected.type !== 'arc' || actual.kind !== expected.type) throw new CadError('dxf-arc-precision', 'DXF bulges changed an analytic edge.');
    const encoded = encodedEntities[index]; const endpointTolerance = cadPathClosureTolerance([expected.start, expected.end]);
    if (Math.hypot(encoded.start.x - expected.start.x, encoded.start.y - expected.start.y) > endpointTolerance
      || Math.hypot(encoded.end.x - expected.end.x, encoded.end.y - expected.end.y) > endpointTolerance) {
      throw new CadError('dxf-arc-precision', 'The signed DXF bulge cannot retain the authored endpoints at CAD precision.');
    }
    if (segment.kind === 'arc' && actual.kind === 'arc' && expected.type === 'arc') {
      const midpointAngle = (segment.startAngle + segment.sweep / 2) * Math.PI / 180;
      const midpoint = { x: segment.center[0] + segment.radius * Math.cos(midpointAngle), y: segment.center[1] + segment.radius * Math.sin(midpointAngle) };
      const tolerance = cadPathClosureTolerance([expected.start, expected.end, midpoint]);
      if (!Number.isFinite(vertices[index].bulge) || Math.hypot(actual.center.x - expected.center.x, actual.center.y - expected.center.y) > tolerance
        || Math.abs(actual.radius - segment.radius) > tolerance || Math.abs(actual.sweepRadians - segment.sweep * Math.PI / 180) * segment.radius > tolerance) {
        throw new CadError('dxf-arc-precision', 'The signed DXF bulge cannot retain this circle and sweep at CAD precision. Keep the CAD document or use a better-conditioned arc.');
      }
    }
  }
  const lines = ['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC','0','SECTION','2','ENTITIES',
    '0','LWPOLYLINE','8','CAD','90',String(vertices.length),'70','0'];
  for (const vertex of vertices) lines.push('10',String(vertex.x),'20',String(vertex.y),'42',String(vertex.bulge));
  lines.push('0','ENDSEC','0','EOF');
  return `${lines.join('\n')}\n`;
}

export function cadCurveToDxf(document: CadDocument, curveId: string): string {
  const validated = parseCadDocument(document); const curve = validated.features.find(feature => feature.id === curveId);
  if (curve?.kind !== 'curve') throw new CadError('missing-curve', 'Choose an existing Curve for DXF export.');
  return exportCadCurveDxf(curve, validated.parameters);
}
