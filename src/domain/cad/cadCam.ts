import type { DxfEntity } from '@/domain/dxf/types';
import { dxfUnitsFromInsunitsCode } from '@/domain/dxf/parseDxf';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { CadDocument, CadSketchFeature } from './cadDocument';
import { CadError } from './cadError';
import { parseCadDocument } from './cadSchema';
import { cadSketchToEntities } from './cadSketchGeometry';
import { cadEntitiesToDxf } from './cadDxfExport';

function entitiesForSketch(document: CadDocument, sketchId: string): DxfEntity[] {
  parseCadDocument(document);
  const sketch = document.features.find(feature => feature.id === sketchId);
  if (sketch?.kind !== 'sketch') throw new CadError('missing-sketch', 'Choose an existing sketch for CAM.');
  if (sketch.suppressed) throw new CadError('suppressed-sketch', 'A suppressed sketch cannot be transferred to CAM.');
  const entities = cadSketchToEntities(sketch, document.parameters);
  if (entities.length === 0) throw new CadError('empty-sketch', 'Sketch needs at least one non-construction contour for CAM.');
  return entities;
}

/** Sketch-local millimetres, independent of its XY/XZ/YZ display plane and offset. */
export function cadSketchToCam(document: CadDocument, sketchId: string): PathPlanningDocument {
  const result = cadEntitiesToCam(entitiesForSketch(document, sketchId));
  const sketch = document.features.find(feature => feature.id === sketchId);
  if (sketch?.kind !== 'sketch') return result;
  return appendPluginNotes(result, [sketch]);
}

function appendPluginNotes(result: PathPlanningDocument, sketches: readonly CadSketchFeature[]) {
  const seen = new Set<string>();
  for (const sketch of sketches) for (const profile of sketch.profiles) {
    if (profile.construction || profile.geometry.kind !== 'plugin' || !profile.geometry.package.notes) continue;
    const plugin = profile.geometry.package, key = `${plugin.id}@${plugin.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.diagnostics.push({ id: `cad_plugin_import_${seen.size}`, severity: 'warning', code: 'dxf-import-warning',
      message: `${plugin.name} v${plugin.version}: ${plugin.notes}` });
  }
  return result;
}

/** Shared analytic handoff for sketches and validated exact-kernel planar sections. */
export function cadEntitiesToCam(entities: readonly DxfEntity[], sourceDocument?: CadDocument): PathPlanningDocument {
  if (entities.length === 0 || entities.length > 8192 || entities.some(entity => entity.type === 'polyline' || entity.type === 'lwpolyline')) throw new CadError('cam-geometry', 'CAD handoff requires one to 8192 analytic line, arc or circle entities.');
  const units = dxfUnitsFromInsunitsCode(4);
  const result = createPathPlanningDocumentFromDxfEntities([...entities], { endpointTolerance: 1e-7, coincidenceEpsilon: 1e-9 }, {
    units, unitDeclaration: { status: 'recognized', units }, coordinateScaleToMillimeters: 1,
    appliedUnits: { label: units.label, scaleToMillimeters: 1, basis: 'dxf-declared', confirmed: true }
  });
  if (result.segments.length !== entities.length || result.diagnostics.some(diagnostic => diagnostic.severity === 'error') || result.contours.some(contour => !contour.closed)) throw new CadError('cam-geometry', 'Sketch could not form clean closed CAM contours without changing its analytic geometry.');
  // A final-solid section may include modified plugin geometry. Preserve the active
  // document's approximation notes rather than implying those curves became exact.
  return sourceDocument ? appendPluginNotes(result, sourceDocument.features.flatMap(feature => feature.kind === 'sketch' && !feature.suppressed ? [feature] : [])) : result;
}

/** Portable ASCII DXF with an explicit millimetre unit declaration and exact analytic arcs. */
export function cadSketchToDxf(document: CadDocument, sketchId: string): string {
  const entities = entitiesForSketch(document, sketchId);
  const sketch = document.features.find(feature => feature.id === sketchId);
  const notes = sketch?.kind === 'sketch' ? sketch.profiles.flatMap(profile => {
    if (profile.construction || profile.geometry.kind !== 'plugin') return [];
    const plugin = profile.geometry.package;
    return [`${plugin.id}@${plugin.version}: ${plugin.notes}`];
  }) : [];
  return cadEntitiesToDxf(entities, notes);
}