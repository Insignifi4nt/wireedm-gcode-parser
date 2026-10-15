import type { CadDocument } from '@/domain/cad/cadDocument';
import { cadSketchSourceIssue, type CadSketchSourceIssue, type CadSketchSourcePurpose } from '@/domain/cad/cadSketchSources';
import { SelectField } from './CadFields';

const issueLabels: Record<CadSketchSourceIssue, string> = {
  suppressed: 'suppressed', 'no-material': 'no material contours', 'principal-plane-required': 'principal planes only'
};

/** Fields and owned model picking must use exactly the same eligible preceding sketches. */
export function CadSketchSourceField({ document, sketches, purpose, sketchId, onChange }: {
  document: CadDocument;
  sketches: readonly { value: string; label: string; disabled?: boolean }[];
  purpose: CadSketchSourcePurpose;
  sketchId: string;
  onChange(sketchId: string): void;
}) {
  const choices = sketches.filter(option => {
    const source = document.features.find(feature => feature.id === option.value);
    return !option.disabled && source?.kind === 'sketch' && cadSketchSourceIssue(source, purpose) === null;
  });
  const available = choices.some(option => option.value === sketchId);
  const source = document.features.find(feature => feature.id === sketchId);
  const issue = source?.kind === 'sketch' ? cadSketchSourceIssue(source, purpose) : null;
  const options = available ? choices : [{ value: sketchId, label: sketchId ? `${source?.name ?? 'Sketch'} (${issue ? issueLabels[issue] : 'unavailable'})` : 'Choose sketch', disabled: true }, ...choices];
  const description = available ? undefined : purpose === 'pocket'
    ? 'Choose an active sketch with closed material contours on XY, XZ or YZ before this feature.'
    : 'Choose an active sketch with closed material contours before this feature.';
  return <SelectField reference label="Profile sketch" value={sketchId} options={options} description={description} onChange={onChange} />;
}
