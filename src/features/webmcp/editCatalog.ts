import { Type } from '@sinclair/typebox';
import { projectEdit, type ProjectEdit } from './projectEdits';
import { object, siteTool } from './siteTools';

const descriptions: Record<ProjectEdit['kind'], string> = {
  'initial-wire': 'Set the explicit initial wire coordinate in millimeters. This is machining intent, not a camera control.',
  'geometry-basis': 'Declare finished-contour or wire-centre geometry; choose according to the actual drawing and job.',
  translate: 'Translate the entire document or one operation by a precise millimeter delta.',
  rotate: 'Rotate the document by signed degrees around an explicit millimeter origin.',
  mirror: 'Mirror the document about the horizontal x or vertical y axis through the supplied origin.',
  'order-strategy': 'Choose an ordering strategy and rebuild the operation order.',
  'move-operation': 'Move one operation a single position earlier (-1) or later (1). Boundary moves are rejected.',
  reverse: 'Reverse one operation cutting direction, using its current operation ID.',
  classification: 'Set the reviewed contour role. Classification affects manufacturing interpretation.',
  'start-point': 'Snap to the nearest point of a closed contour. May split a segment and change geometry IDs; read geometry again.',
  compensation: 'Set compensation intent. Inside/outside describes kept material, not controller G41/G42 commands.',
  'threading-default': 'Set project-default threading mode and wire separation using reviewed machine/job evidence.',
  threading: 'Override one operation threading transition. null removes its override and restores inheritance.',
  'circle-center-entry': 'Use the center of a circular operation as its reviewed straight entry lead.',
  entry: 'Set a straight entry lead from an explicit millimeter point. null explicitly reviews having no entry lead.',
  exit: 'Set a straight exit lead to an explicit millimeter point. null explicitly reviews having no exit lead.',
  'program-stops': 'Replace the complete user-authored stop list for one operation; [] removes those stops. after-contour is before its exit lead; after-exit is after the lead, before next positioning. after-contour-distance uses travelLengthMm measured from contour end along the exit lead then next positioning, requires one active run, cannot reach/past the next entry or split automatic separating positioning, and promotes to UPID v3. Generated threading pauses remain separate.',
  participation: 'Set a normalized [0,1] range on a source segment to active cut or inactive reference. Read geometry and partial-contour diagnostics again.',
  'partial-compensation': 'Review the compensation side for a partial contour. null clears that review.',
  'partial-lead-review': 'Set whether the specified partial-contour entry or exit lead has been reviewed.'
};

export function editCatalogTool() {
  const kinds = Type.Union(projectEdit.anyOf.map(schema => schema.properties.kind));
  return siteTool('edm_describe_edits', 'Discover precise, undoable UPID edit kinds without changing the draft. With no kind returns a compact catalog; with kind returns that exact JSON schema and its semantics. Use operation/segment IDs from edm_query_geometry and coordinates in millimeters.', object({ kind: Type.Optional(kinds) }), input => {
    const schemas = projectEdit.anyOf.filter(schema => !input.kind || schema.properties.kind.const === input.kind);
    return {
      units: 'mm', angleUnits: 'degrees', maximumBatchSize: 50, atomic: true, savedAutomatically: false,
      edits: schemas.map(schema => ({ kind: schema.properties.kind.const, description: descriptions[schema.properties.kind.const],
        ...(input.kind ? { schema } : { requiredFields: schema.required }) })),
      workflow: ['edm_get_context', 'edm_query_geometry', 'edm_edit_project', 'edm_review_execution', 'edm_save_project']
    };
  });
}
