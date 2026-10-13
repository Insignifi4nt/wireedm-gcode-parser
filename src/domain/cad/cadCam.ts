import type { DxfEntity } from '@/domain/dxf/types';
import { dxfUnitsFromInsunitsCode } from '@/domain/dxf/parseDxf';
import { createPathPlanningDocumentFromDxfEntities } from '@/domain/path-intel/fromDxfEntities';
import type { PathPlanningDocument } from '@/domain/path-intel/types';
import type { CadDocument } from './cadDocument';
import { CadError } from './cadError';
import { parseCadDocument } from './cadSchema';
import { cadSketchToEntities } from './cadSketchGeometry';

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
  return cadEntitiesToCam(entitiesForSketch(document, sketchId));
}

/** Shared analytic handoff for sketches and validated exact-kernel planar sections. */
export function cadEntitiesToCam(entities: readonly DxfEntity[]): PathPlanningDocument {
  if (entities.length === 0 || entities.length > 8192 || entities.some(entity => entity.type === 'polyline' || entity.type === 'lwpolyline')) throw new CadError('cam-geometry', 'CAD handoff requires one to 8192 analytic line, arc or circle entities.');
  const units = dxfUnitsFromInsunitsCode(4);
  const result = createPathPlanningDocumentFromDxfEntities([...entities], { endpointTolerance: 1e-7, coincidenceEpsilon: 1e-9 }, {
    units, unitDeclaration: { status: 'recognized', units }, coordinateScaleToMillimeters: 1,
    appliedUnits: { label: units.label, scaleToMillimeters: 1, basis: 'dxf-declared', confirmed: true }
  });
  if (result.segments.length !== entities.length || result.diagnostics.some(diagnostic => diagnostic.severity === 'error') || result.contours.some(contour => !contour.closed)) throw new CadError('cam-geometry', 'Sketch could not form clean closed CAM contours without changing its analytic geometry.');
  return result;
}

/** Portable ASCII DXF with an explicit millimetre unit declaration and exact analytic arcs. */
export function cadSketchToDxf(document: CadDocument, sketchId: string): string {
  const entities = entitiesForSketch(document, sketchId);
  const lines = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const pair = (code: number, value: string | number) => lines.push(String(code), String(value));
  for (const entity of entities) {
    pair(0, entity.type.toUpperCase()); pair(8, entity.layer ?? 'CAD');
    switch (entity.type) {
      case 'line': pair(10, entity.start.x); pair(20, entity.start.y); pair(30, 0); pair(11, entity.end.x); pair(21, entity.end.y); pair(31, 0); break;
      case 'circle': pair(10, entity.center.x); pair(20, entity.center.y); pair(30, 0); pair(40, entity.radius); break;
      case 'arc': pair(10, entity.center.x); pair(20, entity.center.y); pair(30, 0); pair(40, entity.radius); pair(50, entity.startAngle * 180 / Math.PI); pair(51, entity.endAngle * 180 / Math.PI); break;
      case 'polyline': case 'lwpolyline': throw new CadError('unsupported-entity', 'CAD exports analytic line, arc and circle entities.');
      default: { const exhaustive: never = entity; throw exhaustive; }
    }
  }
  lines.push('0', 'ENDSEC', '0', 'EOF');
  return `${lines.join('\n')}\n`;
}
