import { Type } from '@sinclair/typebox';
import { CadError } from '../../cadError';
import { CadSketchRegionSelectionSchema, validateCadSketchRegionSelection, type CadSketchRegionSelection } from '../../cadSketchRegionSelection';
import type { CadFeatureChoice } from '../cadFeatureDefinitionTypes';
import { cadFeatureField, cadFeatureOptionalReference, cadFeatureReference } from '../cadFeatureFields';

// Fields that several kinds store alike.

const operationChoices: readonly CadFeatureChoice<'new' | 'join' | 'cut'>[] = [
  { value: 'new', label: 'New body' }, { value: 'join', label: 'Join to body' }, { value: 'cut', label: 'Cut from body' }];
/** Whether a sketch-based solid makes a new body or joins or cuts its target. */
const solidOperation = Type.Union([Type.Literal('new'), Type.Literal('join'), Type.Literal('cut')]);
export const cadSolidOperationField = cadFeatureField<typeof solidOperation, 'new' | 'join' | 'cut'>(solidOperation, { choices: operationChoices });
/** The body a join or cut replaces, null for a new body. */
export const cadSolidTargetField = cadFeatureOptionalReference({ role: 'target', accepts: ['body'] },
  { field: 'operation', absentWhen: 'new', refusal: 'New bodies have no target; join and cut require a target body.' });
/** The body a feature replaces. */
export const cadTargetBodyField = cadFeatureReference({ role: 'target', accepts: ['body'] });
/** The body a feature takes as its source. */
export const cadSourceBodyField = cadFeatureReference({ role: 'source', accepts: ['body'] });
/** The sketch whose regions a feature uses. */
export const cadProfileSketchField = cadFeatureReference({ role: 'profile', accepts: ['sketch'] });
/** The sketch areas a Pad or Pocket uses, absent for the whole sketch's automatic regions. */
const optionalRegionSelection = Type.Optional(CadSketchRegionSelectionSchema);
export const cadRegionSelectionField = cadFeatureField<typeof optionalRegionSelection, CadSketchRegionSelection>(optionalRegionSelection, {
    check(selection, context) {
      validateCadSketchRegionSelection(selection);
      if (!Array.isArray(selection) && context.document.schemaVersion !== 2)
        throw new CadError('unsupported-sketch-format', 'Graph cell area selections require CAD schema 2. Preserve the schema 1 original when saving an upgrade.');
    }
  });
